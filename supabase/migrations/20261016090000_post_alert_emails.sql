-- A switch in the account settings for the publisher's emails about posts
-- that didn't go out and logins that run out (20261015200000_publisher_notices.sql).
-- On unless turned off. Apply once in the SQL editor, after that one.

alter table public.user_data
  add column if not exists post_alerts_enabled boolean not null default true;

-- The account settings' email switches, now three.
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
  if preference not in ('product_updates_enabled', 'marketing_announcements_enabled', 'post_alerts_enabled') then
    raise exception 'Unknown email preference.' using errcode = '22023';
  end if;

  -- Accounts made before handle_new_user get their row here.
  insert into public.user_data (id) values (auth.uid()) on conflict (id) do nothing;

  if preference = 'product_updates_enabled' then
    update public.user_data set product_updates_enabled = enabled where id = auth.uid();
  elsif preference = 'marketing_announcements_enabled' then
    update public.user_data set marketing_announcements_enabled = enabled where id = auth.uid();
  else
    update public.user_data set post_alerts_enabled = enabled where id = auth.uid();
  end if;
end;
$$;

revoke all on function public.set_email_preference(text, boolean) from public, anon;
grant execute on function public.set_email_preference(text, boolean) to authenticated;

-- Where a person's notices go, and whether they still want them.
create or replace function public.publisher_recipient(person uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'email', u.email,
    'name', public.person_name(u.id),
    'alerts', coalesce((select d.post_alerts_enabled from public.user_data d where d.id = u.id), true)
  )
  from auth.users u
  where u.id = person and u.deleted_at is null and coalesce(u.email, '') <> '';
$$;

revoke all on function public.publisher_recipient(uuid) from public, anon, authenticated;
grant execute on function public.publisher_recipient(uuid) to service_role;
