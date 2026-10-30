-- The dashboard that used to live only in the browser: workspaces, connected
-- accounts, posts, and the lists around them. One row per person, so a second
-- browser signed into the same account shows the same thing. Apply once in
-- the SQL editor, like the earlier migrations.

create table public.account_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.account_state enable row level security;

grant select, insert, update, delete on table public.account_state to authenticated;

create policy "Users read their account state"
  on public.account_state
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users insert their account state"
  on public.account_state
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users update their account state"
  on public.account_state
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users delete their account state"
  on public.account_state
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.account_state;
