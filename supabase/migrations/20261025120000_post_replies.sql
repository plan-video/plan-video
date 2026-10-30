-- A post's thread: the follow-ups the publisher posts under a post once it's
-- out, each a while after the one before (services/publisher/replies.mjs).
-- One row per sent post and follow-up, made before the follow-up is sent, so
-- it never goes out twice, the way post_deliveries keeps the post itself.
-- The next follow-up's row is made only once the one before it went out.

create table public.post_replies (
  id uuid primary key default gen_random_uuid(),
  -- The post as it went out on one network and account.
  delivery_id uuid not null references public.post_deliveries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id text not null check (post_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  platform text not null check (platform ~ '^[a-z]{1,20}$'),
  connection_id text not null check (connection_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- Which follow-up of the post's thread, from 0.
  step integer not null check (step >= 0 and step < 25),
  -- queued: waiting for its time. sending: being posted. sent, failed: done.
  state text not null check (state in ('queued', 'sending', 'sent', 'failed')),
  error text check (char_length(error) <= 1000),
  -- The network's id for the follow-up, which the next one replies to.
  publish_id text check (char_length(publish_id) <= 500),
  url text check (char_length(url) <= 1000),
  attempts integer not null default 0,
  next_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, step)
);

create index post_replies_due on public.post_replies (next_at) where state in ('queued', 'sending');
create index post_replies_post on public.post_replies (user_id, post_id);

alter table public.post_replies enable row level security;
revoke all on table public.post_replies from anon, authenticated;
grant select on table public.post_replies to authenticated;

create policy "Users read their replies"
  on public.post_replies
  for select
  to authenticated
  using (user_id = (select auth.uid()));
