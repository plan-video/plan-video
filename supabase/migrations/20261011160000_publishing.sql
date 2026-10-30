-- Publishing from the server. Scheduled posts used to go out only from an open
-- tab; the publisher service (services/publisher) now sends them at their time.
-- Apply once in the SQL editor, like the earlier migrations.
--
-- Its tables are written only by the publisher, with the service role:
--
--   social_tokens     each connected account's login, sealed with a key that
--                     only the publisher holds, so the database alone can't
--                     read it. Browsers never see these rows.
--   post_deliveries   how sending each post went, one row per run, network and
--                     account. A row is made before anything is sent, so a post
--                     never goes out twice. Its owner reads it to show status.

create table public.social_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The connection's id in the account's list of connected accounts.
  connection_id text not null check (connection_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  platform text not null check (platform ~ '^[a-z]{1,20}$'),
  -- AES-256-GCM: version, iv, ciphertext and tag, base64.
  sealed text not null check (char_length(sealed) <= 32768),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id)
);

alter table public.social_tokens enable row level security;
revoke all on table public.social_tokens from anon, authenticated;

-- "Sign in with Bluesky" sessions the publisher holds, one per Bluesky
-- account, sealed like social_tokens. A connection names its account in
-- social_tokens; the session itself is here.
create table public.bluesky_sessions (
  did text primary key check (did ~ '^did:[a-z]+:[A-Za-z0-9._:%-]{1,256}$'),
  sealed text not null check (char_length(sealed) <= 32768),
  updated_at timestamptz not null default now()
);

alter table public.bluesky_sessions enable row level security;
revoke all on table public.bluesky_sessions from anon, authenticated;

create table public.post_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id text not null check (char_length(workspace_id) <= 100),
  post_id text not null check (post_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- `once` for a post that goes out once; the day, `YYYY-MM-DD`, for a run of a repeating one.
  occurrence text not null check (occurrence = 'once' or occurrence ~ '^\d{4}-\d{2}-\d{2}$'),
  platform text not null check (platform ~ '^[a-z]{1,20}$'),
  connection_id text not null check (connection_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- queued: waiting its turn. sending: being uploaded. processing: the network
  -- has it and is still working on it. sent, failed: done, one way or the other.
  state text not null check (state in ('queued', 'sending', 'processing', 'sent', 'failed')),
  error text check (char_length(error) <= 1000),
  -- The network's id for the upload or the post, once it has one.
  publish_id text check (char_length(publish_id) <= 500),
  -- Where the post can be seen, when the network says.
  url text check (char_length(url) <= 1000),
  attempts integer not null default 0,
  -- Asked for with "Post now", rather than come due on the calendar.
  requested boolean not null default false,
  -- When the run was due, so a post moved after it failed is tried again at its new time.
  due_at timestamptz not null,
  -- When the publisher looks at the row again.
  next_at timestamptz not null default now(),
  -- Plugs: how many of a sent post's checks have run, and which plugs are done.
  plug_checks integer not null default 0,
  plugs_done text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, post_id, occurrence, platform, connection_id)
);

create index post_deliveries_due on public.post_deliveries (next_at) where state in ('queued', 'sending', 'processing');
create index post_deliveries_plugs on public.post_deliveries (next_at) where state = 'sent' and plug_checks < 3;
create index post_deliveries_post on public.post_deliveries (user_id, post_id);

alter table public.post_deliveries enable row level security;
revoke all on table public.post_deliveries from anon, authenticated;
grant select on table public.post_deliveries to authenticated;

create policy "Users read their deliveries"
  on public.post_deliveries
  for select
  to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.post_deliveries;

-- A workspace's connected accounts, as id and network only.
create or replace function public.publisher_connections(slice jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c ->> 'id', 'platform', c ->> 'platform')), '[]'::jsonb)
  from jsonb_array_elements(coalesce(slice -> 'connections', '[]'::jsonb)) c
  where c ->> 'id' is not null;
$$;

-- The posts the publisher may have to send: scheduled, not paused, and on a
-- network it publishes to, with the account's zone and the ids of the
-- workspace's connected accounts. Thumbnails are left out, since they can be
-- large and the publisher has no use for them.
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
    and coalesce(e -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x'];
$$;

-- One post, whatever its status, for "Post now" and for checking a post again
-- just before it's sent.
create or replace function public.publisher_post(owner uuid, post text)
returns table (workspace_id text, time_zone text, connections jsonb, post jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select w.key, s.payload ->> 'timeZone', public.publisher_connections(w.value), e - 'thumbnail'
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'events', '[]'::jsonb)) e
  where s.user_id = owner and e ->> 'id' = post
  limit 1;
$$;

-- An account's plugs in one workspace, for a sent post's checks.
create or replace function public.publisher_plugs(owner uuid, workspace text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(payload -> 'slices' -> workspace -> 'plugs', '[]'::jsonb)
  from public.account_state
  where user_id = owner;
$$;

-- Logins still saved in account_state by browsers from before they moved to
-- social_tokens. The publisher keeps any it doesn't have yet. Never a "Sign in
-- with Bluesky" one: those only name an account, which anyone could write here.
create or replace function public.publisher_legacy_logins()
returns table (user_id uuid, connection_id text, platform text, session jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, c ->> 'id', c ->> 'platform', c -> (c ->> 'platform')
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'connections', '[]'::jsonb)) c
  where c ->> 'platform' in ('tiktok', 'youtube', 'linkedin', 'bluesky', 'x')
    and c ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    and coalesce(c -> (c ->> 'platform') ->> 'oauth', 'false') <> 'true'
    and coalesce(c -> (c ->> 'platform') ->> 'refreshToken', c -> (c ->> 'platform') ->> 'accessToken', c -> (c ->> 'platform') ->> 'refreshJwt', '') <> '';
$$;

revoke all on function public.publisher_legacy_logins() from public, anon, authenticated;
grant execute on function public.publisher_legacy_logins() to service_role;
revoke all on function public.publisher_connections(jsonb) from public, anon, authenticated;
revoke all on function public.publisher_posts() from public, anon, authenticated;
revoke all on function public.publisher_post(uuid, text) from public, anon, authenticated;
revoke all on function public.publisher_plugs(uuid, text) from public, anon, authenticated;
grant execute on function public.publisher_connections(jsonb) to service_role;
grant execute on function public.publisher_posts() to service_role;
grant execute on function public.publisher_post(uuid, text) to service_role;
grant execute on function public.publisher_plugs(uuid, text) to service_role;
