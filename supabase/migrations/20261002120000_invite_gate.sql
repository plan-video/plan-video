-- While the app is closed, a sign-in link is only sent to an email that has
-- already been let in. The first link creates the account, so this check has
-- to happen before that. Apply once in the SQL editor, like the earlier
-- migrations.

create or replace function public.is_invited(address text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.waitlist
    where email = lower(trim(address))
      and invited_at is not null
  );
$$;

revoke all on function public.is_invited(text) from public;
grant execute on function public.is_invited(text) to anon, authenticated;
