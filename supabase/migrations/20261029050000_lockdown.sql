-- The lockdown of 2026-10-29, as pasted into the live project's SQL editor
-- that day, so a database built from these migrations matches it. Safe to run
-- again on the live project: every step checks first.
--
-- 1. Leftovers that were made by hand and never in a migration: the roadmap's
--    comments and team, and the changelog's reactions.
-- 2. The publishable key keeps no rights on the tables it never needs, and
--    signed-in users only read the ones that functions and the server write.
--    New tables and functions start locked: each needs its own grant.
-- 3. A safety net: a copy of what a browser deletes (and an hourly copy of a
--    dashboard before a browser overwrites it), kept 30 days in a schema the
--    API can't reach, and a cap on how many rows one request may delete.
--
-- Not SQL, set in the dashboard: Authentication → Providers → Email →
-- "Prevent use of leaked passwords" is on.

-- 1. Leftovers ---------------------------------------------------------------

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.has_access() from anon;

drop function if exists public.add_roadmap_comment(text, text, uuid);
drop function if exists public.delete_roadmap_comment(uuid);
drop function if exists public.roadmap_card_comments(text);
drop function if exists public.changelog_reaction_counts();
drop function if exists public.toggle_changelog_reaction(text, text);
drop table if exists public.roadmap_comments, public.roadmap_team, public.changelog_reactions;

-- 2. Rights ------------------------------------------------------------------

-- The publishable key keeps no rights on these 9 tables.
revoke all on table public.user_data, public.usage_records, public.waitlist, public.account_state,
  public.post_previews, public.post_preview_comments, public.agent_chats, public.caption_usage,
  public.newsletter from anon;

-- Signed-in users only read these; functions and the server write them.
revoke insert, update, delete, truncate on table public.user_data, public.usage_records,
  public.caption_usage, public.waitlist, public.newsletter from authenticated;

-- Nobody outside the server can truncate (TRUNCATE skips row security).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Preview owners can only resolve or reopen comments, not rewrite them.
revoke update on table public.post_preview_comments from authenticated;
grant update (resolved_at) on table public.post_preview_comments to authenticated;

-- New tables and functions start locked instead of open.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;

-- 3. Safety net --------------------------------------------------------------

create schema if not exists audit;
revoke all on schema audit from public, anon, authenticated;

create table if not exists audit.kept_rows (
  id bigint generated always as identity primary key,
  table_name text not null,
  op text not null check (op in ('delete', 'update')),
  row_data jsonb not null,
  user_id uuid references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists kept_rows_at on audit.kept_rows (at);
create index if not exists kept_rows_user on audit.kept_rows (user_id, table_name, at desc);

-- Keeps the old row when a browser deletes it, or (account_state) an hourly copy before it's overwritten.
create or replace function audit.keep_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from audit.kept_rows k
    where k.user_id = who and k.table_name = tg_table_name and k.op = 'update' and k.at > now() - interval '1 hour'
  ) then
    return new;
  end if;
  insert into audit.kept_rows (table_name, op, row_data, user_id)
  values (tg_table_name, lower(tg_op), to_jsonb(old), who);
  delete from audit.kept_rows where at < now() - interval '30 days';
  return coalesce(new, old);
end $$;

-- Refuses a browser deleting more than tg_argv[0] rows in one request.
create or replace function audit.cap_deletes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated')
     and (select count(*) from gone) > tg_argv[0]::int then
    raise exception 'Too many rows deleted at once.' using errcode = '54000';
  end if;
  return null;
end $$;

revoke all on all functions in schema audit from public, anon, authenticated;

drop trigger if exists keep_row on public.account_state;
create trigger keep_row before delete on public.account_state for each row execute function audit.keep_row();
drop trigger if exists keep_row_update on public.account_state;
create trigger keep_row_update before update on public.account_state for each row execute function audit.keep_row();
drop trigger if exists keep_row on public.post_previews;
create trigger keep_row before delete on public.post_previews for each row execute function audit.keep_row();
drop trigger if exists keep_row on public.post_preview_comments;
create trigger keep_row before delete on public.post_preview_comments for each row execute function audit.keep_row();

drop trigger if exists cap_deletes on public.account_state;
create trigger cap_deletes after delete on public.account_state
  referencing old table as gone for each statement execute function audit.cap_deletes('1');
drop trigger if exists cap_deletes on public.post_previews;
create trigger cap_deletes after delete on public.post_previews
  referencing old table as gone for each statement execute function audit.cap_deletes('100');
