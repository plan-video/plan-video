-- Limits for when strangers can sign up. Safe to run again: every step checks
-- first or replaces what it changes. Nothing here touches what's already stored.
--
-- 1. The safety net keeps one copy an hour of a deleted account_state (up to
--    2 MB), and at most 100 an hour of a deleted preview or comment, so
--    deleting and saving again can't fill the database.
-- 2. Profile pictures have a size and type limit. The dashboard sends a 256 px
--    square, so 2 MiB is far more than one can be.

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
