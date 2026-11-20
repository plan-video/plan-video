-- The admin page: who runs this copy of plan.video, how much of each network's
-- API the publisher uses, and the numbers behind the costs. Apply once in the
-- SQL editor; safe to run again.
--
--   admins          people who may open the admin page. Added by hand:
--                     insert into public.admins (user_id)
--                     select id from auth.users where email = 'you@example.com';
--   api_usage       calls the publisher made to each network, by day. Only
--                   the publisher writes it, through add_api_usage.
--
-- admin_usage_report is the publisher's one read for the page.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;

-- So the dashboard can show the page's link to admins alone. The publisher checks again.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.api_usage (
  day date not null,
  network text not null check (network ~ '^[a-z]{1,20}$'),
  -- What kind of call: post, upload, read, login… (api-usage.mjs).
  kind text not null check (kind ~ '^[a-z]{1,20}$'),
  calls integer not null default 0 check (calls >= 0),
  -- Answered with a 5xx or not at all.
  failed integer not null default 0 check (failed >= 0),
  -- Refused for a rate limit or a used-up quota.
  limited integer not null default 0 check (limited >= 0),
  -- YouTube's quota units, as its quota table prices each call. 0 elsewhere.
  -- YouTube's rows go by its quota day, which starts at midnight Pacific time.
  units bigint not null default 0 check (units >= 0),
  primary key (day, network, kind)
);

alter table public.api_usage enable row level security;
revoke all on table public.api_usage from anon, authenticated;

-- Adds to each row's counts and keeps 90 days. `rows` is a list of
-- {day, network, kind, calls, failed, limited, units}.
create or replace function public.add_api_usage(rows jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.api_usage as u (day, network, kind, calls, failed, limited, units)
  select (r ->> 'day')::date, r ->> 'network', r ->> 'kind',
    coalesce((r ->> 'calls')::int, 0), coalesce((r ->> 'failed')::int, 0),
    coalesce((r ->> 'limited')::int, 0), coalesce((r ->> 'units')::bigint, 0)
  from jsonb_array_elements(rows) r
  on conflict (day, network, kind) do update
    set calls = u.calls + excluded.calls,
        failed = u.failed + excluded.failed,
        limited = u.limited + excluded.limited,
        units = u.units + excluded.units;
  delete from public.api_usage where day < current_date - 90;
$$;

revoke execute on function public.add_api_usage(jsonb) from public, anon, authenticated;
grant execute on function public.add_api_usage(jsonb) to service_role;

-- Everything the admin page counts from the database, in one answer. YouTube's
-- quota day starts at midnight Pacific time; X bills by calendar month.
create or replace function public.admin_usage_report()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as pacific_day,
      date_trunc('month', now() at time zone 'utc') at time zone 'utc' as month_start
  )
  select jsonb_build_object(
    'at', now(),
    'pacific_day', (select pacific_day from bounds),
    'deliveries', coalesce((
      select jsonb_agg(d) from (
        select platform,
          count(*) filter (where state = 'sent' and updated_at > now() - interval '24 hours') as sent_day,
          count(*) filter (where state = 'failed' and attempts > 0 and updated_at > now() - interval '24 hours') as failed_day,
          count(*) filter (where state = 'sent' and updated_at > now() - interval '7 days') as sent_week,
          count(*) filter (where state = 'failed' and attempts > 0 and updated_at > now() - interval '7 days') as failed_week,
          count(*) filter (where state in ('queued', 'sending', 'processing')) as waiting,
          count(*) filter (where state in ('queued', 'processing') and next_at < now() - interval '15 minutes') as overdue
        from public.post_deliveries
        where updated_at > now() - interval '7 days' or state in ('queued', 'sending', 'processing')
        group by platform
      ) d
    ), '[]'::jsonb),
    -- The account that posted most in the last 24 hours, per network: per-account caps bite there first.
    'busiest', coalesce((
      select jsonb_agg(b) from (
        select distinct on (platform) platform, count(*) as posts
        from public.post_deliveries
        where state = 'sent' and updated_at > now() - interval '24 hours' and connection_id <> 'none'
        group by platform, connection_id
        order by platform, count(*) desc
      ) b
    ), '[]'::jsonb),
    'youtube_uploads_today', (select count(*) from public.publisher_uploads, bounds where platform = 'youtube' and at >= pacific_day),
    'x_posts_month', (select count(*) from public.publisher_uploads, bounds where platform = 'x' and at >= month_start),
    'x_links_month', (select count(*) from public.publisher_uploads, bounds where platform = 'xlink' and at >= month_start),
    -- The owners closest to their X caps, over the rolling 30 days the caps use.
    'x_owners', coalesce((
      select jsonb_agg(o) from (
        select u.user_id, coalesce(max(d.access_level), 1) as level,
          count(*) filter (where u.platform = 'x') as posts,
          count(*) filter (where u.platform = 'xlink') as links
        from public.publisher_uploads u
        left join public.user_data d on d.id = u.user_id
        where u.platform in ('x', 'xlink') and u.at > now() - interval '30 days'
        group by u.user_id
        order by count(*) filter (where u.platform = 'x') desc
        limit 5
      ) o
    ), '[]'::jsonb),
    'caption_seconds_month', (
      select coalesce(sum(seconds), 0) from public.caption_usage
      where month = date_trunc('month', now() at time zone 'utc')::date
    ),
    'people', (select count(*) from auth.users where deleted_at is null),
    'people_week', (select count(*) from auth.users where deleted_at is null and created_at > now() - interval '7 days'),
    'plans', coalesce((
      select jsonb_object_agg(level, people) from (
        select least(4, greatest(1, access_level)) as level, count(*) as people
        from public.user_data group by 1
      ) p
    ), '{}'::jsonb),
    'database_bytes', pg_database_size(current_database()),
    'api_usage', coalesce((
      select jsonb_agg(a order by day) from (
        select day, network, kind, calls, failed, limited, units
        from public.api_usage where day > current_date - 30
      ) a
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_usage_report() from public, anon, authenticated;
grant execute on function public.admin_usage_report() to service_role;
