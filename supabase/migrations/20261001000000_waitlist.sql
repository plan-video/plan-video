-- The waitlist before launch, and who on it has been let into the app.
-- Apply once in the SQL editor, like the first migration.
--
-- Let someone in:
--   insert into public.waitlist (email, invited_at) values ('name@example.com', now())
--   on conflict (email) do update set invited_at = now();

create table public.waitlist (
  email text primary key
    check (email = lower(email) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  source text check (length(source) <= 32),
  created_at timestamptz not null default now(),
  invited_at timestamptz
);

-- No policies: the table can't be read or written through the API. The two
-- functions below are the only way in, so nobody can list the emails.
alter table public.waitlist enable row level security;

create or replace function public.join_waitlist(address text, origin text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.waitlist (email, source)
  values (lower(trim(address)), left(origin, 32))
  on conflict (email) do nothing;
end;
$$;

revoke all on function public.join_waitlist(text, text) from public;
grant execute on function public.join_waitlist(text, text) to anon, authenticated;

-- Whether the signed-in user's email has been let in.
create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.waitlist
    where email = lower(auth.jwt() ->> 'email')
      and invited_at is not null
  );
$$;

revoke all on function public.has_access() from public;
grant execute on function public.has_access() to authenticated;
