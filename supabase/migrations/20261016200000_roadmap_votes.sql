-- The public side of /roadmap (apps/web/src/lib/roadmap.ts): upvotes on the
-- board's cards. Anyone can read them; only someone signed in can add their
-- own. The table is closed: the functions below go round it.
-- Apply once in the SQL editor.

-- One vote per person per card.
create table if not exists public.roadmap_votes (
  item text not null check (item ~ '^[a-z0-9-]{1,60}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item, user_id)
);

alter table public.roadmap_votes enable row level security;
revoke all on table public.roadmap_votes from public, anon, authenticated;

-- Every card's votes, and whether the person asking has voted on it.
create or replace function public.roadmap_vote_counts()
returns table (item text, votes integer, voted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select v.item, count(*)::integer, coalesce(bool_or(v.user_id = auth.uid()), false)
  from public.roadmap_votes v
  group by v.item;
$$;

revoke all on function public.roadmap_vote_counts() from public;
grant execute on function public.roadmap_vote_counts() to anon, authenticated;

-- Votes for a card, or takes the vote back if it was already given. Answers
-- with the card's count afterwards and whether the person has voted.
create or replace function public.toggle_roadmap_vote(card text)
returns table (votes integer, voted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_voted boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to vote.' using errcode = '42501';
  end if;
  if card is null or card !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'Unknown roadmap card.' using errcode = '22023';
  end if;

  delete from public.roadmap_votes where item = card and user_id = auth.uid();
  if found then
    now_voted := false;
  else
    insert into public.roadmap_votes (item, user_id) values (card, auth.uid());
    now_voted := true;
  end if;

  return query select count(*)::integer, now_voted from public.roadmap_votes where item = card;
end;
$$;

revoke all on function public.toggle_roadmap_vote(text) from public, anon;
grant execute on function public.toggle_roadmap_vote(text) to authenticated;
