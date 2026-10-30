-- What each plan allows, kept by the publisher, so writing account_state
-- straight to the database gets no more than the dashboard gives. Apply once in
-- the SQL editor, before the publisher that reads these tables starts.
--
-- Both tables are written only by the publisher, with the service role:
--
--   publisher_waiting   each scheduled post waiting on an account, as the
--                       publisher first saw it. `over` marks one that came in
--                       while a Free account already had its 10 waiting; its
--                       runs fail instead of going out. Posts already waiting
--                       when this is applied are kept as they are.
--   publisher_uploads   every YouTube upload the publisher starts, so one person
--                       can't use up the app's daily YouTube quota for everyone.

create table public.publisher_waiting (
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id text not null check (char_length(workspace_id) <= 100),
  post_id text not null check (post_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  connection_id text not null check (connection_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  over boolean not null default false,
  seen_at timestamptz not null default now(),
  primary key (user_id, workspace_id, post_id, connection_id)
);

alter table public.publisher_waiting enable row level security;
revoke all on table public.publisher_waiting from anon, authenticated;

create table public.publisher_uploads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform ~ '^[a-z]{1,20}$'),
  at timestamptz not null default now()
);

create index publisher_uploads_recent on public.publisher_uploads (user_id, platform, at);

alter table public.publisher_uploads enable row level security;
revoke all on table public.publisher_uploads from anon, authenticated;

-- Everything waiting now stays allowed: the dashboard let it in, or it came in
-- before the Free plan had a limit. Every account of a post's networks in its
-- workspace is kept, which is more than it names; the publisher drops the rest.
insert into public.publisher_waiting (user_id, workspace_id, post_id, connection_id)
select distinct s.user_id, w.key, e ->> 'id', c ->> 'id'
from public.account_state s,
  jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
  jsonb_array_elements(coalesce(w.value -> 'events', '[]'::jsonb)) e,
  jsonb_array_elements(coalesce(w.value -> 'connections', '[]'::jsonb)) c
where e ->> 'status' = 'scheduled'
  and char_length(w.key) <= 100
  and e ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
  and c ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
  and coalesce(e -> 'platforms', '[]'::jsonb) ? (c ->> 'platform')
on conflict do nothing;
