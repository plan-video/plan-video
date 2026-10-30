-- Seconds of audio each person has sent to Auto-Captions, by calendar month
-- (UTC), so services/transcribe can hold each plan to its monthly hours.
-- People read their own rows; only add_caption_seconds writes, and only ever
-- adds. Apply once in the SQL editor.

create table public.caption_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  seconds numeric not null default 0 check (seconds >= 0),
  primary key (user_id, month)
);

alter table public.caption_usage enable row level security;

create policy "Users read their own caption usage"
  on public.caption_usage
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Adds to the caller's count for this month and returns the new total. One
-- request carries at most about an hour of audio, so more than two is refused.
create or replace function public.add_caption_seconds(amount numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  total numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.';
  end if;
  if amount is null or amount <= 0 or amount > 7200 then
    raise exception 'That amount of audio can''t be counted.';
  end if;

  insert into public.caption_usage (user_id, month, seconds)
  values ((select auth.uid()), date_trunc('month', now() at time zone 'utc')::date, amount)
  on conflict (user_id, month)
    do update set seconds = public.caption_usage.seconds + excluded.seconds
  returning seconds into total;

  return total;
end;
$$;

revoke execute on function public.add_caption_seconds(numeric) from public, anon;
grant execute on function public.add_caption_seconds(numeric) to authenticated;
