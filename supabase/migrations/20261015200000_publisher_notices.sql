-- Emails about what went wrong while nobody had plan.video open: a scheduled
-- post that didn't go out, and a LinkedIn login that runs out. The publisher
-- notes each one here when it happens and emails them a few minutes later,
-- several in one email, so a notice survives a restart and is never sent
-- twice. Apply once in the SQL editor; until then the publisher logs that the
-- table is missing and sends no emails.
--
-- Written only by the publisher, with the service role.

create table public.publisher_notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What it's about, so the same thing is noted once: a failed send, or one login running out.
  key text not null check (char_length(key) <= 300),
  -- failed: a post didn't go out. login: an account's login ran out. login-soon: it runs out soon.
  kind text not null check (kind in ('failed', 'login', 'login-soon')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- When it was emailed, or let go: the thing was fixed meanwhile, or there's no one to email.
  sent_at timestamptz,
  attempts integer not null default 0,
  unique (user_id, key)
);

create index publisher_notices_unsent on public.publisher_notices (created_at) where sent_at is null;

alter table public.publisher_notices enable row level security;
revoke all on table public.publisher_notices from anon, authenticated;

-- Where a person's notices go: their sign-in email, and the name to greet them by.
create or replace function public.publisher_recipient(person uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('email', u.email, 'name', public.person_name(u.id))
  from auth.users u
  where u.id = person and u.deleted_at is null and coalesce(u.email, '') <> '';
$$;

-- A connected account's name, as its workspace lists it. Null once it's been removed.
create or replace function public.publisher_account(owner uuid, connection text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('handle', coalesce(c ->> 'handle', ''), 'platform', c ->> 'platform')
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'connections', '[]'::jsonb)) c
  where s.user_id = owner and c ->> 'id' = connection
  limit 1;
$$;

revoke all on function public.publisher_recipient(uuid) from public, anon, authenticated;
revoke all on function public.publisher_account(uuid, text) from public, anon, authenticated;
grant execute on function public.publisher_recipient(uuid) to service_role;
grant execute on function public.publisher_account(uuid, text) to service_role;
