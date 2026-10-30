-- Instagram, Facebook Pages and Threads publish from plan.video too, so the
-- publisher reads scheduled posts on them. Only the list of networks changes.
-- Apply once in the SQL editor, before the publisher that sends to them starts:
-- until then a post on those networks alone is never picked up.

create or replace function public.publisher_posts()
returns table (user_id uuid, workspace_id text, time_zone text, connections jsonb, post jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, w.key, s.payload ->> 'timeZone', public.publisher_connections(w.value), e - 'thumbnail'
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'events', '[]'::jsonb)) e
  where e ->> 'status' = 'scheduled'
    and coalesce(e ->> 'paused', 'false') <> 'true'
    and coalesce(e -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x', 'instagram', 'facebook', 'threads'];
$$;

create or replace function public.publisher_posts_after(
  after_user uuid default null,
  after_workspace text default '',
  after_post text default '',
  size integer default 500
)
returns table (user_id uuid, workspace_id text, time_zone text, connections jsonb, post jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, w.key, s.payload ->> 'timeZone', public.publisher_connections(w.value), e - 'thumbnail'
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'events', '[]'::jsonb)) e
  where s.user_id >= coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid)
    and (s.user_id, w.key, coalesce(e ->> 'id', '')) > (coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid), after_workspace, after_post)
    and e ->> 'status' = 'scheduled'
    and coalesce(e ->> 'paused', 'false') <> 'true'
    and coalesce(e -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x', 'instagram', 'facebook', 'threads']
  order by s.user_id, w.key, coalesce(e ->> 'id', '')
  limit least(greatest(size, 1), 1000);
$$;

revoke all on function public.publisher_posts() from public, anon, authenticated;
revoke all on function public.publisher_posts_after(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.publisher_posts() to service_role;
grant execute on function public.publisher_posts_after(uuid, text, text, integer) to service_role;
