-- While plan.video is invite-only, the database keeps out anyone who hasn't
-- been let in, rather than only the site doing so (audit M10). Before, an
-- account made by calling Supabase directly, past the site's invite check,
-- could save to its account, posts and thumbnails like anyone let in.
--
-- Two walls:
-- - Saving: every table a signed-in person writes to takes their insert or
--   update only if they've been let in (has_access(): invited from the
--   waitlist, or a member of a workspace whose plan has a team). Reading and
--   deleting stay open, so a shared preview still opens and anyone can clear
--   out what's theirs.
-- - Signing up: public.before_user_created refuses to make an account for an
--   address that hasn't been let in. Supabase calls it only once it is chosen
--   under Authentication → Hooks → "Before User Created" (Postgres function
--   public.before_user_created).
--
-- Both follow public.invite_gate, which is on here. When the app opens to
-- everyone, or for a copy of plan.video run without the waitlist:
--   update public.invite_gate set invite_only = false;
-- alongside VITE_INVITE_ONLY=false for the site and REQUIRE_INVITE=false for
-- the services.
--
-- Apply once in the SQL editor.

-- ---------------------------------------------------------------------------
-- The switch

create table if not exists public.invite_gate (
  only_row boolean primary key default true check (only_row),
  invite_only boolean not null default true
);

insert into public.invite_gate (only_row, invite_only) values (true, true) on conflict (only_row) do nothing;

alter table public.invite_gate enable row level security;
revoke all on table public.invite_gate from public, anon, authenticated;

-- Whether the person asking may save: anyone, once the app is open; until
-- then, only someone let in. A missing row counts as invite-only.
create or replace function public.let_in()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select g.invite_only from public.invite_gate g where g.only_row), true)
    or public.has_access();
$$;

revoke all on function public.let_in() from public, anon;
grant execute on function public.let_in() to authenticated;

-- ---------------------------------------------------------------------------
-- Saving

-- (select …) has Postgres work it out once a statement, not once a row.
-- Comments are added through add_post_preview_comment, by visitors too; owners
-- only change them here (resolving), so they have no rule for adding.
do $$
declare
  t text;
begin
  foreach t in array array['account_state', 'agent_chats', 'posts', 'post_thumbnails', 'post_previews', 'post_preview_comments'] loop
    execute format('drop policy if exists "Only people let in add" on public.%I', t);
    execute format('drop policy if exists "Only people let in change" on public.%I', t);
    if t <> 'post_preview_comments' then
      execute format(
        'create policy "Only people let in add" on public.%I as restrictive for insert to authenticated '
        'with check ((select public.let_in()))',
        t
      );
    end if;
    execute format(
      'create policy "Only people let in change" on public.%I as restrictive for update to authenticated '
      'using ((select public.let_in())) with check ((select public.let_in()))',
      t
    );
  end loop;
end;
$$;

-- Pictures: avatars are the only bucket people upload to themselves, and
-- they can't replace one in place (there's no rule for changing them).
drop policy if exists "Only people let in upload avatars" on storage.objects;
create policy "Only people let in upload avatars"
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (bucket_id <> 'avatars' or (select public.let_in()));

-- Roadmap votes go through their function, which skips the table's rules.
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
  if not public.let_in() then
    raise exception 'Voting opens once you''re let in.' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- Signing up

-- Supabase Auth's "Before User Created" hook: {} lets the account be made,
-- an error turns it down. The site asks is_invited before sending a sign-in
-- link, so someone using it never meets this; it stops the same request made
-- to Supabase directly, and Google or GitHub sign-in, before any account or
-- email exists.
create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  address text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if not coalesce((select g.invite_only from public.invite_gate g where g.only_row), true) then
    return '{}'::jsonb;
  end if;
  if address <> '' and public.is_invited(address) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error',
    jsonb_build_object('http_code', 403, 'message', 'plan.video is invite-only for now. Join the waitlist and we''ll email you when you''re in.')
  );
end;
$$;

revoke all on function public.before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
