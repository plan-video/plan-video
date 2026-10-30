-- "Sign in with Bluesky" sessions, one per person and Bluesky account. They
-- were one per Bluesky account, so two people who connected the same Bluesky
-- account shared a session: either signing in ended the other's session, and
-- either disconnecting ended both. Apply once in the SQL editor, like the
-- earlier migrations.
--
-- A session kept until now doesn't say whose it is, so it goes, and its account
-- signs in with Bluesky again.

drop table if exists public.bluesky_sessions;

create table public.bluesky_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  did text not null check (did ~ '^did:[a-z]+:[A-Za-z0-9._:%-]{1,256}$'),
  -- Sealed like social_tokens, bound to the person and the account.
  sealed text not null check (char_length(sealed) <= 32768),
  updated_at timestamptz not null default now(),
  primary key (user_id, did)
);

alter table public.bluesky_sessions enable row level security;
revoke all on table public.bluesky_sessions from anon, authenticated;
