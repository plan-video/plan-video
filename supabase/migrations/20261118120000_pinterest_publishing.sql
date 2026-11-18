-- Pinterest publishes from plan.video too, so the publisher's hourly look
-- over scheduled posts takes in posts going only there.
create or replace function public.publisher_posts()
returns table (user_id uuid, workspace_id text, time_zone text, connections jsonb, post jsonb, version bigint, next_run_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.owner_id, p.workspace_id, a.payload ->> 'timeZone', public.publisher_connections(a.payload -> 'slices' -> p.workspace_id), p.data, p.version, s.next_run_at
  from public.posts p
  left join public.account_state a on a.user_id = p.owner_id
  left join public.post_schedule s on s.owner_id = p.owner_id and s.post_id = p.id
  where p.status = 'scheduled' and p.deleted_at is null
    and coalesce(p.data ->> 'paused', 'false') <> 'true'
    and coalesce(p.data -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x', 'instagram', 'facebook', 'threads', 'pinterest'];
$$;

create or replace function public.publisher_posts_after(
  after_user uuid default null,
  after_workspace text default '',
  after_post text default '',
  size integer default 500
)
returns table (user_id uuid, workspace_id text, time_zone text, connections jsonb, post jsonb, version bigint, next_run_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.owner_id, p.workspace_id, a.payload ->> 'timeZone', public.publisher_connections(a.payload -> 'slices' -> p.workspace_id), p.data, p.version, s.next_run_at
  from public.posts p
  left join public.account_state a on a.user_id = p.owner_id
  left join public.post_schedule s on s.owner_id = p.owner_id and s.post_id = p.id
  where (p.owner_id, p.workspace_id, p.id) > (coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid), after_workspace, after_post)
    and p.status = 'scheduled' and p.deleted_at is null
    and coalesce(p.data ->> 'paused', 'false') <> 'true'
    and coalesce(p.data -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x', 'instagram', 'facebook', 'threads', 'pinterest']
  order by p.owner_id, p.workspace_id, p.id
  limit least(greatest(size, 1), 1000);
$$;
