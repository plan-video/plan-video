-- The dashboard agent's chats, listed beside the chat so an earlier one can be
-- opened again. One row per chat, kept per workspace. `messages` is the
-- conversation as the model saw it; `feedback` holds the thumbs given to its
-- answers. Apply once in the SQL editor, like the earlier migrations.

create table public.agent_chats (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace text not null,
  title text not null,
  messages jsonb not null,
  feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_chats_recent on public.agent_chats (user_id, workspace, updated_at desc);

alter table public.agent_chats enable row level security;

grant select, insert, update, delete on table public.agent_chats to authenticated;

create policy "Users read their agent chats"
  on public.agent_chats
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users insert their agent chats"
  on public.agent_chats
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users update their agent chats"
  on public.agent_chats
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users delete their agent chats"
  on public.agent_chats
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
