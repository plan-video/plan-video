-- Bounds on the dashboard agent's saved chats, so the table can't be used to
-- store anything large. The server stops a chat well before 300 KB, so the
-- caps below only ever refuse rows written around the app. Each person keeps
-- their 100 most recent chats; older ones are removed as new ones are saved.
-- Apply once in the SQL editor, after 20261007180000_agent_chats.sql.

alter table public.agent_chats
  add constraint agent_chats_title_size check (char_length(title) <= 200),
  add constraint agent_chats_workspace_size check (char_length(workspace) <= 100),
  add constraint agent_chats_messages_size check (jsonb_typeof(messages) = 'array' and octet_length(messages::text) <= 512000),
  add constraint agent_chats_feedback_size check (jsonb_typeof(feedback) = 'object' and octet_length(feedback::text) <= 16000);

create or replace function public.agent_chats_keep_recent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.agent_chats
  where user_id = new.user_id
    and id in (
      select id from public.agent_chats
      where user_id = new.user_id
      order by updated_at desc
      offset 100
    );
  return null;
end;
$$;

create trigger agent_chats_keep_recent
  after insert on public.agent_chats
  for each row execute function public.agent_chats_keep_recent();
