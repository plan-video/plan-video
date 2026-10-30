-- Account data the app reads directly from Supabase. Apply once in the
-- SQL editor. The publishable key cannot create tables.

create table public.user_data (
  id uuid primary key references auth.users (id) on delete cascade,
  lifetime_credit_balance integer not null default 0,
  monthly_credit_balance integer not null default 50,
  monthly_credit_quota integer not null default 50,
  access_level integer not null default 1,
  stripe_customer_id text,
  last_credit_reset_at timestamptz,
  product_updates_enabled boolean not null default true,
  marketing_announcements_enabled boolean not null default true
);

alter table public.user_data enable row level security;

create policy "Users read their own row"
  on public.user_data
  for select
  to authenticated
  using (id = (select auth.uid()));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_data (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

alter publication supabase_realtime add table public.user_data;

-- Generation credit rows. The app looks them up by id.
create table public.usage_records (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  credits integer,
  config jsonb
);

alter table public.usage_records enable row level security;

create policy "Users read their own usage"
  on public.usage_records
  for select
  to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false);

create policy "Users read their own avatars"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own avatars"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
