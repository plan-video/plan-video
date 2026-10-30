-- The newsletter the site's footer signs people up to. Apply once in the SQL
-- editor, like the waitlist.
--
-- Everyone to send to:
--   select email from public.newsletter where unsubscribed_at is null order by created_at;
--
-- Take someone off it:
--   update public.newsletter set unsubscribed_at = now() where email = 'name@example.com';

create table public.newsletter (
  email text primary key
    check (email = lower(email) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  source text check (length(source) <= 32),
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- No policies: the table can't be read or written through the API, so nobody
-- can list the emails. The function below is the only way in.
alter table public.newsletter enable row level security;

-- Subscribing twice is not an error. Someone who unsubscribed and signs up
-- again is back on the list.
create or replace function public.subscribe_newsletter(address text, origin text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.newsletter (email, source)
  values (lower(trim(address)), left(origin, 32))
  on conflict (email) do update set unsubscribed_at = null
  where public.newsletter.unsubscribed_at is not null;
end;
$$;

revoke all on function public.subscribe_newsletter(text, text) from public;
grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;
