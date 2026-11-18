-- Limits for when strangers can sign up. Safe to run again: every step checks
-- first or replaces what it changes. Nothing here touches what's already stored.
--
-- 1. The safety net keeps one copy an hour of a deleted account_state (up to
--    2 MB), and at most 100 an hour of a deleted preview or comment, so
--    deleting and saving again can't fill the database.
-- 2. Profile pictures have a size and type limit. The dashboard sends a 256 px
--    square, so 2 MiB is far more than one can be.
-- 3. One owner keeps up to 100,000 posts that aren't deleted, whichever workspace
--    and whoever in it writes them. Deleting posts makes room again.

-- 1. Safety net --------------------------------------------------------------

create or replace function audit.keep_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  allowed int := case when tg_op = 'UPDATE' or tg_table_name = 'account_state' then 1 else 100 end;
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  if (
    select count(*) from (
      select 1 from audit.kept_rows k
      where k.user_id = who and k.table_name = tg_table_name and k.op = lower(tg_op) and k.at > now() - interval '1 hour'
      limit allowed
    ) recent
  ) >= allowed then
    return coalesce(new, old);
  end if;
  insert into audit.kept_rows (table_name, op, row_data, user_id)
  values (tg_table_name, lower(tg_op), to_jsonb(old), who);
  delete from audit.kept_rows where at < now() - interval '30 days';
  return coalesce(new, old);
end $$;

-- 2. Profile pictures --------------------------------------------------------

update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg']
where id = 'avatars';

-- 3. Posts per owner ---------------------------------------------------------

-- Serves the count below from the index alone, deletion markers left out.
create index if not exists posts_live on public.posts (owner_id) where deleted_at is null;

-- As in 20261026090000_posts.sql, with the limit added. A deleted post made
-- live again counts too, or deleting and restoring would get past it. 54000 is
-- a code browsers take as refused, not to be retried; post-sync-core.ts has the
-- same words, to show them translated.
create or replace function public.posts_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed boolean;
begin
  if new.deleted_at is not null then
    new.data := null;
    -- The database's own time, whatever a browser's clock says: markers are pruned by it.
    new.deleted_at := case when tg_op = 'UPDATE' and old.deleted_at is not null then old.deleted_at else clock_timestamp() end;
  end if;
  if tg_op = 'INSERT' then
    -- One id is one post, deleted or not, in whichever workspace: said before anything else is checked.
    if exists (select 1 from public.posts p where p.owner_id = new.owner_id and p.id = new.id) then
      raise exception 'This post already exists.' using errcode = '23505';
    end if;
    new.version := 1;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    new.thumbnail_at := null;
  else
    if new.owner_id <> old.owner_id or new.id <> old.id or new.workspace_id <> old.workspace_id then
      raise exception 'A post stays in the workspace it was made in.' using errcode = '42501';
    end if;
    changed := new.data is distinct from old.data or new.deleted_at is distinct from old.deleted_at;
    new.version := case when changed then old.version + 1 else old.version end;
    new.created_at := old.created_at;
    -- A thumbnail alone moves the post on to the thumbnail's own time, so the tab that saved it knows the change for its own.
    new.updated_at := case
      when changed then clock_timestamp()
      when new.thumbnail_at is distinct from old.thumbnail_at then coalesce(new.thumbnail_at, clock_timestamp())
      else old.updated_at
    end;
  end if;
  if new.data is not null and (tg_op = 'INSERT' or old.data is null) and (
    select count(*) from (
      select 1 from public.posts p where p.owner_id = new.owner_id and p.deleted_at is null limit 100000
    ) live
  ) >= 100000 then
    raise exception 'This account has reached its limit of 100,000 posts. Delete some old posts to make room for new ones.' using errcode = '54000';
  end if;
  if new.data is not null and public.post_files_elsewhere(new.owner_id, new.workspace_id, public.post_file_ids(new.id, new.data)) then
    raise exception 'This post names a file of another workspace.' using errcode = '42501';
  end if;
  return new;
end;
$$;
