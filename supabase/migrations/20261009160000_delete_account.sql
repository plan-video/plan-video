-- Lets a signed-in person delete their own account from Settings. Every table
-- of theirs cascades from auth.users, so their rows go with it. Files in cloud
-- storage are erased by the storage service first, and the profile photo by
-- the app, which is what the delete policy is for. Apply once in the SQL
-- editor, like the earlier migrations.
--
-- Since replaced: the server deletes accounts, and delete_my_account is
-- dropped (see delete_account_on_server).

create policy "Users delete their own avatars"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to delete your account.' using errcode = '42501';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
