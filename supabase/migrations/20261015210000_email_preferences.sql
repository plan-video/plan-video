-- The email switches in the account settings. They called the desktop app's
-- /api/trpc, which nothing answers on plan.video, and people can only read
-- their user_data row (it holds their plan), so every switch said "Action
-- failed". This function changes only the two email columns, only on the
-- signed-in person's own row. Apply once in the SQL editor.

create or replace function public.set_email_preference(preference text, enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if enabled is null then
    raise exception 'Pick on or off.' using errcode = '22023';
  end if;

  if preference = 'product_updates_enabled' then
    update public.user_data set product_updates_enabled = enabled where id = auth.uid();
  elsif preference = 'marketing_announcements_enabled' then
    update public.user_data set marketing_announcements_enabled = enabled where id = auth.uid();
  else
    raise exception 'Unknown email preference.' using errcode = '22023';
  end if;

  -- Accounts made before handle_new_user get their row here.
  if not found then
    insert into public.user_data (id) values (auth.uid()) on conflict (id) do nothing;
    if preference = 'product_updates_enabled' then
      update public.user_data set product_updates_enabled = enabled where id = auth.uid();
    else
      update public.user_data set marketing_announcements_enabled = enabled where id = auth.uid();
    end if;
  end if;
end;
$$;

revoke all on function public.set_email_preference(text, boolean) from public, anon;
grant execute on function public.set_email_preference(text, boolean) to authenticated;
