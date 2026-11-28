-- The welcome email someone gets after signing in for the first time. The
-- publisher sends it and notes it here, so each person gets it once. Apply
-- once in the SQL editor; until then the publisher logs that the function is
-- missing and sends none.
--
-- Written only by the publisher, with the service role.

create table public.welcome_emails (
  user_id uuid primary key references auth.users (id) on delete cascade,
  attempts integer not null default 0,
  -- When it was emailed, or let go after too many tries.
  sent_at timestamptz
);

alter table public.welcome_emails enable row level security;
revoke all on table public.welcome_emails from anon, authenticated;
grant select, insert, update on table public.welcome_emails to service_role;

-- People who made their account since `since`, have signed in, and haven't had
-- their welcome yet. Accounts older than `since` never get one, so applying
-- this doesn't email everyone who signed up before.
create or replace function public.publisher_welcomes_due(since timestamptz, max_attempts integer, size integer)
returns table (user_id uuid, email text, attempts integer)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email, coalesce(w.attempts, 0)
  from auth.users u
  left join public.welcome_emails w on w.user_id = u.id
  where u.created_at >= since
    and u.last_sign_in_at is not null
    and u.deleted_at is null
    and coalesce(u.email, '') <> ''
    and (w.user_id is null or (w.sent_at is null and w.attempts < max_attempts))
  order by u.created_at
  limit size;
$$;

revoke all on function public.publisher_welcomes_due(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.publisher_welcomes_due(timestamptz, integer, integer) to service_role;
