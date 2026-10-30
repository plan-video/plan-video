-- The publisher reads every scheduled post, and every login still in account
-- state, in pages. PostgREST answers at most max_rows rows (1000), so reading
-- them in one call left posts past the first 1000 neither sent nor checked
-- against their plan. Each page starts after the last row of the one before,
-- in key order, so a post saved meanwhile doesn't move a page and get skipped.
-- Apply once in the SQL editor; the publisher uses the one-call functions
-- until these exist.

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
    and coalesce(e -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x']
  order by s.user_id, w.key, coalesce(e ->> 'id', '')
  limit least(greatest(size, 1), 1000);
$$;

create or replace function public.publisher_legacy_logins_after(
  after_user uuid default null,
  after_workspace text default '',
  after_connection text default '',
  size integer default 500
)
returns table (user_id uuid, workspace_id text, connection_id text, platform text, session jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, w.key, c ->> 'id', c ->> 'platform', c -> (c ->> 'platform')
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'connections', '[]'::jsonb)) c
  where s.user_id >= coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid)
    and (s.user_id, w.key, c ->> 'id') > (coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid), after_workspace, after_connection)
    and c ->> 'platform' in ('tiktok', 'youtube', 'linkedin', 'bluesky', 'x')
    and c ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    and coalesce(c -> (c ->> 'platform') ->> 'oauth', 'false') <> 'true'
    and coalesce(c -> (c ->> 'platform') ->> 'refreshToken', c -> (c ->> 'platform') ->> 'accessToken', c -> (c ->> 'platform') ->> 'refreshJwt', '') <> ''
  order by s.user_id, w.key, c ->> 'id'
  limit least(greatest(size, 1), 1000);
$$;

revoke all on function public.publisher_posts_after(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.publisher_legacy_logins_after(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.publisher_posts_after(uuid, text, text, integer) to service_role;
grant execute on function public.publisher_legacy_logins_after(uuid, text, text, integer) to service_role;
