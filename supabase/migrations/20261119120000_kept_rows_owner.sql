-- The safety net keeps a copy under the account the row belongs to, not whoever
-- changed it, so the copy goes when that account is deleted. A team member's save
-- updates the owner's account_state, and its copy was kept under the member, where
-- it outlived the owner's deletion. Safe to run again.

create or replace function audit.keep_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := coalesce((to_jsonb(old) ->> 'user_id')::uuid, (to_jsonb(old) ->> 'owner_id')::uuid, auth.uid());
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

revoke all on function audit.keep_row() from public, anon, authenticated;

-- Copies already kept under someone else: an owner's that's gone goes, the rest move to their owner.
delete from audit.kept_rows k
where k.table_name = 'account_state'
  and k.user_id is distinct from (k.row_data ->> 'user_id')::uuid
  and not exists (select 1 from auth.users u where u.id = (k.row_data ->> 'user_id')::uuid);
update audit.kept_rows k
set user_id = (k.row_data ->> 'user_id')::uuid
where k.table_name = 'account_state'
  and k.user_id is distinct from (k.row_data ->> 'user_id')::uuid;
