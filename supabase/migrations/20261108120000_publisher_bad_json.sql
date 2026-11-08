-- One account's connections or slices can be any JSON, and these run across every
-- account: a value that isn't a list stopped scheduled posts for everyone. Now it
-- reads as no accounts, for that account alone. Safe to run again.

create or replace function public.publisher_connections(slice jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c ->> 'id', 'platform', c ->> 'platform')), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(slice -> 'connections') = 'array' then slice -> 'connections' else '[]'::jsonb end) c
  where c ->> 'id' is not null;
$$;

create or replace function public.publisher_legacy_logins()
returns table (user_id uuid, connection_id text, platform text, session jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, c ->> 'id', c ->> 'platform', c -> (c ->> 'platform')
  from public.account_state s,
    jsonb_each(case when jsonb_typeof(s.payload -> 'slices') = 'object' then s.payload -> 'slices' else '{}'::jsonb end) w,
    jsonb_array_elements(case when jsonb_typeof(w.value -> 'connections') = 'array' then w.value -> 'connections' else '[]'::jsonb end) c
  where c ->> 'platform' in ('tiktok', 'youtube', 'linkedin', 'bluesky', 'x')
    and c ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    and coalesce(c -> (c ->> 'platform') ->> 'oauth', 'false') <> 'true'
    and coalesce(c -> (c ->> 'platform') ->> 'refreshToken', c -> (c ->> 'platform') ->> 'accessToken', c -> (c ->> 'platform') ->> 'refreshJwt', '') <> '';
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
    jsonb_each(case when jsonb_typeof(s.payload -> 'slices') = 'object' then s.payload -> 'slices' else '{}'::jsonb end) w,
    jsonb_array_elements(case when jsonb_typeof(w.value -> 'connections') = 'array' then w.value -> 'connections' else '[]'::jsonb end) c
  where s.user_id >= coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid)
    and (s.user_id, w.key, c ->> 'id') > (coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid), after_workspace, after_connection)
    and c ->> 'platform' in ('tiktok', 'youtube', 'linkedin', 'bluesky', 'x')
    and c ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    and coalesce(c -> (c ->> 'platform') ->> 'oauth', 'false') <> 'true'
    and coalesce(c -> (c ->> 'platform') ->> 'refreshToken', c -> (c ->> 'platform') ->> 'accessToken', c -> (c ->> 'platform') ->> 'refreshJwt', '') <> ''
  order by s.user_id, w.key, c ->> 'id'
  limit least(greatest(size, 1), 1000);
$$;
