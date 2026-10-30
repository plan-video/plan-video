-- Team members. A workspace's owner, or one of its admins, asks someone in by
-- email; once they accept, they work in that one workspace beside the owner:
-- its accounts, posts, calendar, library and the rest. Pro and Agency include
-- them. Apply once in the SQL editor, like the earlier migrations.
--
-- The workspace itself stays in its owner's account_state, where the publisher
-- reads it. A member never reads that row: the functions below hand them their
-- workspace's slice of it, and take their changes back, after checking who
-- they are. Roles:
--
--   owner    the account the workspace belongs to. Everything, and the only
--            one who pays, renames, or deletes it.
--   admin    everything in the workspace: posts, accounts, settings, and who
--            else is in it.
--   member   writes, schedules and posts from the workspace's accounts. Can't
--            connect or disconnect accounts, or invite anyone.

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  email text not null
    check (email = lower(email) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Set when they accept. Until then the invite waits for whoever signs in with `email`.
  user_id uuid references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (owner_id, workspace_id, email)
);

create index workspace_members_user on public.workspace_members (user_id) where user_id is not null;
create index workspace_members_waiting on public.workspace_members (email) where user_id is null;
-- Someone in a workspace is in it once, even after their email changed and they were asked again.
create unique index workspace_members_once on public.workspace_members (owner_id, workspace_id, user_id) where user_id is not null;

-- Every invite sent, kept a day, so taking invites back doesn't make room for more.
create table public.workspace_invite_log (
  owner_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);

create index workspace_invite_log_recent on public.workspace_invite_log (owner_id, at);
alter table public.workspace_invite_log enable row level security;
revoke all on table public.workspace_invite_log from anon, authenticated;

-- When a shared workspace last changed, so its members' browsers know to read
-- it again. Written by the trigger on account_state below, never by people.
create table public.workspace_versions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  workspace_id text not null,
  revision text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Who may do what

-- Whether an account's plan includes team members: Pro (3) and Agency (4).
create or replace function public.team_plan(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select access_level from public.user_data where id = owner), 1) >= 3;
$$;

-- Whether the owner still has the workspace.
create or replace function public.owner_has_workspace(owner uuid, workspace text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.account_state where user_id = owner and payload -> 'slices' ? workspace);
$$;

-- The signed-in person's role in one of an owner's workspaces: owner, admin or
-- member. Null when they have none, or the owner's plan no longer includes a
-- team, or the workspace is gone.
create or replace function public.workspace_role(owner uuid, workspace text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or owner is null or workspace is null then null
    when owner = auth.uid() then 'owner'
    else (
      select m.role
      from public.workspace_members m
      where m.owner_id = owner
        and m.workspace_id = workspace
        and m.user_id = auth.uid()
        and public.team_plan(owner)
        and public.owner_has_workspace(owner, workspace)
    )
  end;
$$;

-- For the publisher and the storage signer, asked with the person's own
-- token: their role in the workspace and the owner's plan, whose limits apply
-- there. Null when they're not in it.
create or replace function public.team_access(owner uuid, workspace text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when r.role is null then null else jsonb_build_object('role', r.role, 'level', r.level) end
  from (
    select public.workspace_role(owner, workspace) as role,
      coalesce((select access_level from public.user_data where id = owner), 1) as level
  ) r;
$$;

-- A person's name as the app shows it: the one set in Profile, else the one
-- their sign-in gave, else the start of their email.
create or replace function public.person_name(person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'last_name')), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(u.email, '@', 1)
  )
  from auth.users u
  where u.id = person;
$$;

-- The signed-in person's email, once it's confirmed: what an invite is matched on.
create or replace function public.my_confirmed_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null;
$$;

-- How a workspace looks, from its owner's list: name, color, icon and shape, and nothing else of it.
create or replace function public.workspace_look(owner uuid, workspace text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object('name', w -> 'name', 'color', w -> 'color', 'icon', w -> 'icon', 'shape', w -> 'shape'))
  from public.account_state s, jsonb_array_elements(coalesce(s.payload -> 'workspaces' -> 'list', '[]'::jsonb)) w
  where s.user_id = owner and w ->> 'id' = workspace
  limit 1;
$$;

-- The ids another of an account's workspaces uses, apart from `workspace`'s:
-- its posts, their files, its post files and its media library. Someone in
-- `workspace` can't reach any of them, nor make a post of theirs go out with one.
create or replace function public.team_foreign_ids_in(payload jsonb, workspace text)
returns text[]
language sql
immutable
set search_path = public
as $$
  with others as (
    select w.value as slice
    from jsonb_each(coalesce(payload -> 'slices', '{}'::jsonb)) w
    where w.key <> workspace
  ),
  events as (
    select e from others, jsonb_array_elements(case when jsonb_typeof(slice -> 'events') = 'array' then slice -> 'events' else '[]'::jsonb end) e
  )
  select coalesce(array_agg(distinct id) filter (where id is not null), '{}')
  from (
    select e ->> 'id' as id from events
    union all
    select f #>> '{}' from events, jsonb_array_elements(case when jsonb_typeof(e -> 'files') = 'array' then e -> 'files' else '[]'::jsonb end) f
    union all
    select f #>> '{}'
    from events,
      jsonb_each(case when jsonb_typeof(e -> 'ownFiles') = 'object' then e -> 'ownFiles' else '{}'::jsonb end) o,
      jsonb_array_elements(case when jsonb_typeof(o.value) = 'array' then o.value else '[]'::jsonb end) f
    union all
    select m ->> 'id' from others, jsonb_array_elements(case when jsonb_typeof(slice -> 'media') = 'array' then slice -> 'media' else '[]'::jsonb end) m
    union all
    select l ->> 'id' from others, jsonb_array_elements(case when jsonb_typeof(slice -> 'library') = 'array' then slice -> 'library' else '[]'::jsonb end) l
  ) ids;
$$;

-- The same, read from the owner's account, for someone in `workspace`. Empty for anyone else.
create or replace function public.team_foreign_ids(owner uuid, workspace text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case when public.workspace_role(owner, workspace) is null then '{}'::text[]
    else coalesce((select public.team_foreign_ids_in(payload, workspace) from public.account_state where user_id = owner), '{}'::text[])
  end;
$$;

-- For the storage signer: whether someone in the workspace may reach these
-- files of its owner's, the ones of no other workspace of theirs. A picture's
-- `-poster` belongs with its item.
create or replace function public.team_files_allowed(owner uuid, workspace text, ids text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_role(owner, workspace) in ('admin', 'member'), false)
    and not (
      array(select regexp_replace(id, '-poster$', '') from unnest(coalesce(ids, '{}'::text[])) id)
      && public.team_foreign_ids(owner, workspace)
    );
$$;

-- A post as saved by someone in a workspace: without the files of another of the owner's workspaces.
create or replace function public.team_clean_event(e jsonb, foreign_ids text[])
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned jsonb := e;
begin
  if jsonb_typeof(e -> 'files') = 'array' then
    cleaned := jsonb_set(cleaned, '{files}', coalesce((
      select jsonb_agg(f order by n)
      from jsonb_array_elements(e -> 'files') with ordinality x(f, n)
      where not coalesce((f #>> '{}') = any(foreign_ids), false)
    ), '[]'::jsonb));
  end if;
  if jsonb_typeof(e -> 'ownFiles') = 'object' then
    cleaned := jsonb_set(cleaned, '{ownFiles}', coalesce((
      select jsonb_object_agg(o.key, case
        when jsonb_typeof(o.value) = 'array' then coalesce((
          select jsonb_agg(f order by n)
          from jsonb_array_elements(o.value) with ordinality y(f, n)
          where not coalesce((f #>> '{}') = any(foreign_ids), false)
        ), '[]'::jsonb)
        else o.value
      end)
      from jsonb_each(e -> 'ownFiles') o
    ), '{}'::jsonb));
  end if;
  return cleaned;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables

alter table public.workspace_members enable row level security;
alter table public.workspace_versions enable row level security;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.workspace_versions from anon, authenticated;
-- Read only, for the live updates below. Every change goes through the functions.
grant select on table public.workspace_members to authenticated;
grant select on table public.workspace_versions to authenticated;

create policy "People see the teams they're in"
  on public.workspace_members
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or user_id = (select auth.uid())
    or (user_id is null and email = (select public.my_confirmed_email()))
    or public.workspace_role(owner_id, workspace_id) in ('admin', 'member')
  );

create policy "Members see when their workspace changes"
  on public.workspace_versions
  for select
  to authenticated
  using (public.workspace_role(owner_id, workspace_id) in ('admin', 'member'));

alter publication supabase_realtime add table public.workspace_members;
alter publication supabase_realtime add table public.workspace_versions;

-- ---------------------------------------------------------------------------
-- Saving the account without losing a change made meanwhile
--
-- A browser saving the account names the revision it merged with as `base`.
-- If the row has moved on since, say a member saved their workspace, the save
-- is refused and the browser merges again. A save without `base`, from a
-- browser running older code, goes through as before.

create or replace function public.account_state_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payload ? 'base' then
    if (new.payload ->> 'base') is distinct from (old.payload ->> 'revision') then
      raise exception 'The account changed while this was being saved.' using errcode = 'PT409';
    end if;
    new.payload := new.payload - 'base';
  end if;
  return new;
end;
$$;

create trigger account_state_base
  before update on public.account_state
  for each row
  execute function public.account_state_base();

-- Notes which shared workspaces changed, for their members' browsers.
create or replace function public.note_workspace_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_versions (owner_id, workspace_id, revision, updated_at)
  select new.user_id, m.workspace_id, coalesce(new.payload ->> 'revision', ''), now()
  from (
    select distinct workspace_id from public.workspace_members where owner_id = new.user_id and user_id is not null
  ) m
  where tg_op = 'INSERT'
    or (old.payload -> 'slices' -> m.workspace_id) is distinct from (new.payload -> 'slices' -> m.workspace_id)
    or (
      select w from jsonb_array_elements(coalesce(old.payload -> 'workspaces' -> 'list', '[]'::jsonb)) w where w ->> 'id' = m.workspace_id limit 1
    ) is distinct from (
      select w from jsonb_array_elements(coalesce(new.payload -> 'workspaces' -> 'list', '[]'::jsonb)) w where w ->> 'id' = m.workspace_id limit 1
    )
  on conflict (owner_id, workspace_id) do update set revision = excluded.revision, updated_at = excluded.updated_at;
  return null;
end;
$$;

create trigger account_state_versions
  after insert or update on public.account_state
  for each row
  execute function public.note_workspace_versions();

-- ---------------------------------------------------------------------------
-- The owner's and admins' side

-- Asks someone into a workspace. Returns the invite.
create or replace function public.invite_workspace_member(owner uuid, workspace text, address text, role text default 'member')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_role text := public.workspace_role(owner, workspace);
  clean text := lower(btrim(coalesce(address, '')));
  made public.workspace_members;
begin
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'Only the workspace''s owner and admins can invite people.' using errcode = '42501';
  end if;
  if not public.team_plan(owner) then
    raise exception 'Team members come with Pro and Agency.' using errcode = 'P0001';
  end if;
  if not public.owner_has_workspace(owner, workspace) then
    raise exception 'This workspace is gone.' using errcode = 'P0002';
  end if;
  if role is null or role not in ('admin', 'member') then
    raise exception 'Pick Admin or Member.' using errcode = '22023';
  end if;
  if length(clean) > 254 or clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter an email address.' using errcode = '22023';
  end if;
  if clean = (select lower(email) from auth.users where id = owner) then
    raise exception 'That''s the workspace''s owner.' using errcode = '23505';
  end if;
  if (select count(*) from public.workspace_invite_log l where l.owner_id = owner and l.at > now() - interval '1 day') >= 200 then
    raise exception 'That''s a lot of invites for one day. Try again tomorrow.' using errcode = '54000';
  end if;
  delete from public.workspace_invite_log l where l.owner_id = owner and l.at < now() - interval '1 day';

  insert into public.workspace_members (owner_id, workspace_id, email, role, invited_by)
  values (owner, workspace, clean, role, me)
  on conflict (owner_id, workspace_id, email) do nothing
  returning * into made;
  if made.id is null then
    raise exception 'That person is already invited.' using errcode = '23505';
  end if;
  insert into public.workspace_invite_log (owner_id) values (owner);

  return jsonb_build_object('id', made.id, 'email', made.email, 'role', made.role, 'invitedAt', made.invited_at);
end;
$$;

-- Makes someone an admin or a member.
create or replace function public.set_workspace_member_role(member uuid, role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found public.workspace_members;
begin
  select * into found from public.workspace_members where id = member;
  if found.id is null then
    raise exception 'That person isn''t in the workspace anymore.' using errcode = 'P0002';
  end if;
  if coalesce(public.workspace_role(found.owner_id, found.workspace_id), '') not in ('owner', 'admin') then
    raise exception 'Only the workspace''s owner and admins can change roles.' using errcode = '42501';
  end if;
  if role is null or role not in ('admin', 'member') then
    raise exception 'Pick Admin or Member.' using errcode = '22023';
  end if;
  update public.workspace_members set role = set_workspace_member_role.role where id = member;
end;
$$;

-- Takes someone out of a workspace, or an invite back. They can do it
-- themselves too: to leave, or to turn an invite down.
create or replace function public.remove_workspace_member(member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found public.workspace_members;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into found from public.workspace_members where id = member;
  if found.id is null then
    return;
  end if;
  if (
    (found.user_id is not null and found.user_id = auth.uid())
    or (found.user_id is null and found.email = coalesce(public.my_confirmed_email(), ''))
    or coalesce(public.workspace_role(found.owner_id, found.workspace_id), '') in ('owner', 'admin')
  ) is not true then
    raise exception 'Only the workspace''s owner and admins can remove people.' using errcode = '42501';
  end if;
  delete from public.workspace_members where id = member;
end;
$$;

-- Everyone in a workspace, for whoever is in it.
create or replace function public.workspace_team(owner uuid, workspace text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.workspace_role(owner, workspace) is null then
    raise exception 'You''re not in this workspace.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'paused', not public.team_plan(owner),
    'owner', (select jsonb_build_object('id', u.id, 'email', u.email, 'name', public.person_name(u.id)) from auth.users u where u.id = owner),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'email', m.email,
        'userId', m.user_id,
        'name', case when m.user_id is null then null else public.person_name(m.user_id) end,
        'role', m.role,
        'invitedAt', m.invited_at,
        'joinedAt', m.joined_at
      ) order by m.joined_at is null, m.invited_at)
      from public.workspace_members m
      where m.owner_id = owner and m.workspace_id = workspace
    ), '[]'::jsonb)
  );
end;
$$;

-- When the owner deletes a workspace, everyone in it goes with it.
create or replace function public.forget_workspace_team(workspace text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.workspace_members where owner_id = auth.uid() and workspace_id = workspace;
  delete from public.workspace_versions where owner_id = auth.uid() and workspace_id = workspace;
$$;

-- ---------------------------------------------------------------------------
-- The member's side

-- The workspaces shared with the signed-in person, and the invites waiting for them.
create or replace function public.my_team()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'owner', m.owner_id,
        'workspace', m.workspace_id,
        'role', m.role,
        'joinedAt', m.joined_at,
        'state', case
          when not public.owner_has_workspace(m.owner_id, m.workspace_id) then 'gone'
          when not public.team_plan(m.owner_id) then 'paused'
          else 'active'
        end,
        'look', public.workspace_look(m.owner_id, m.workspace_id),
        'ownerName', public.person_name(m.owner_id),
        'ownerEmail', (select email from auth.users where id = m.owner_id)
      ) order by m.joined_at)
      from public.workspace_members m
      where m.user_id = auth.uid()
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'owner', m.owner_id,
        'workspace', m.workspace_id,
        'role', m.role,
        'invitedAt', m.invited_at,
        'open', public.team_plan(m.owner_id) and public.owner_has_workspace(m.owner_id, m.workspace_id),
        'look', public.workspace_look(m.owner_id, m.workspace_id),
        'ownerName', public.person_name(m.owner_id),
        'ownerEmail', (select email from auth.users where id = m.owner_id),
        'invitedBy', public.person_name(m.invited_by)
      ) order by m.invited_at)
      from public.workspace_members m
      where m.user_id is null and m.email = public.my_confirmed_email()
    ), '[]'::jsonb)
  );
$$;

-- Joins a workspace someone asked you into.
create or replace function public.accept_workspace_invite(invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found public.workspace_members;
  mine text := public.my_confirmed_email();
begin
  select * into found from public.workspace_members where id = invite for update;
  if found.id is null or found.user_id is not null or mine is null or found.email <> mine then
    raise exception 'This invite isn''t open anymore.' using errcode = 'P0002';
  end if;
  if found.owner_id = auth.uid() then
    raise exception 'This is your own workspace.' using errcode = '23505';
  end if;
  if not public.owner_has_workspace(found.owner_id, found.workspace_id) then
    raise exception 'This workspace is gone.' using errcode = 'P0002';
  end if;
  if not public.team_plan(found.owner_id) then
    raise exception 'This workspace''s plan doesn''t include team members right now.' using errcode = 'P0001';
  end if;
  -- Already in it, under the email they had before: the extra invite goes.
  if exists (select 1 from public.workspace_members m where m.owner_id = found.owner_id and m.workspace_id = found.workspace_id and m.user_id = auth.uid()) then
    delete from public.workspace_members where id = invite;
    return jsonb_build_object('owner', found.owner_id, 'workspace', found.workspace_id, 'role', found.role);
  end if;
  update public.workspace_members set user_id = auth.uid(), joined_at = now() where id = invite;
  -- So the new member's browser hears of later changes from now on.
  insert into public.workspace_versions (owner_id, workspace_id, revision)
  select found.owner_id, found.workspace_id, coalesce(s.payload ->> 'revision', '')
  from public.account_state s where s.user_id = found.owner_id
  on conflict (owner_id, workspace_id) do nothing;
  return jsonb_build_object('owner', found.owner_id, 'workspace', found.workspace_id, 'role', found.role);
end;
$$;

-- A shared workspace as its owner's account has it now.
create or replace function public.team_workspace(owner uuid, workspace text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  my_role text := public.workspace_role(owner, workspace);
  found jsonb;
begin
  if my_role is null or my_role = 'owner' then
    raise exception 'You''re not in this workspace.' using errcode = '42501';
  end if;
  select jsonb_build_object('revision', coalesce(s.payload ->> 'revision', ''), 'slice', s.payload -> 'slices' -> workspace, 'role', my_role)
  into found
  from public.account_state s
  where s.user_id = owner;
  if found is null or found -> 'slice' is null or jsonb_typeof(found -> 'slice') = 'null' then
    raise exception 'This workspace is gone.' using errcode = 'P0002';
  end if;
  return found;
end;
$$;

-- Saves a member's changes to a shared workspace, if nobody saved the account
-- since `base`: otherwise says so, and their browser merges again. A member's
-- copy can't change the workspace's connected accounts; an admin's can.
create or replace function public.save_team_workspace(owner uuid, workspace text, slice jsonb, base text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  my_role text := public.workspace_role(owner, workspace);
  current jsonb;
  given jsonb := slice;
  foreign_ids text[];
  next_revision text := gen_random_uuid()::text;
begin
  if my_role is null or my_role = 'owner' then
    raise exception 'You''re not in this workspace.' using errcode = '42501';
  end if;
  if slice is null or jsonb_typeof(slice) <> 'object' then
    raise exception 'That isn''t a workspace.' using errcode = '22023';
  end if;
  if pg_column_size(slice) > 20000000 then
    raise exception 'This workspace is too large to save.' using errcode = '54000';
  end if;

  select s.payload into current from public.account_state s where s.user_id = owner for update;
  if current is null or not (current -> 'slices' ? workspace) then
    raise exception 'This workspace is gone.' using errcode = 'P0002';
  end if;
  if (current ->> 'revision') is distinct from base then
    return jsonb_build_object('conflict', true);
  end if;

  if my_role = 'member' then
    slice := jsonb_set(slice, '{connections}', coalesce(current -> 'slices' -> workspace -> 'connections', '[]'::jsonb));
  end if;
  -- Nor can an admin's name an account another of the owner's workspaces has: its login belongs there.
  slice := jsonb_set(slice, '{connections}', coalesce((
    select jsonb_agg(c.value order by c.position)
    from jsonb_array_elements(coalesce(slice -> 'connections', '[]'::jsonb)) with ordinality as c(value, position)
    where not exists (
      select 1
      from jsonb_each(coalesce(current -> 'slices', '{}'::jsonb)) w,
        jsonb_array_elements(coalesce(w.value -> 'connections', '[]'::jsonb)) o
      where w.key <> workspace and o ->> 'id' = c.value ->> 'id'
    )
  ), '[]'::jsonb));
  -- Nor can anyone's copy take a post, file or library item of another of the owner's workspaces.
  foreign_ids := public.team_foreign_ids_in(current, workspace);
  if cardinality(foreign_ids) > 0 then
    slice := jsonb_set(slice, '{events}', coalesce((
      select jsonb_agg(public.team_clean_event(e.value, foreign_ids) order by e.position)
      from jsonb_array_elements(case when jsonb_typeof(slice -> 'events') = 'array' then slice -> 'events' else '[]'::jsonb end) with ordinality as e(value, position)
      where not coalesce((e.value ->> 'id') = any(foreign_ids), false)
    ), '[]'::jsonb));
    slice := jsonb_set(slice, '{media}', coalesce((
      select jsonb_agg(m.value order by m.position)
      from jsonb_array_elements(case when jsonb_typeof(slice -> 'media') = 'array' then slice -> 'media' else '[]'::jsonb end) with ordinality as m(value, position)
      where not coalesce((m.value ->> 'id') = any(foreign_ids), false)
    ), '[]'::jsonb));
    if jsonb_typeof(slice -> 'library') = 'array' then
      slice := jsonb_set(slice, '{library}', coalesce((
        select jsonb_agg(l.value order by l.position)
        from jsonb_array_elements(slice -> 'library') with ordinality as l(value, position)
        where not coalesce((l.value ->> 'id') = any(foreign_ids), false)
      ), '[]'::jsonb));
    end if;
  end if;

  update public.account_state
  set payload = jsonb_set(jsonb_set(current - 'base', array['slices', workspace], slice), '{revision}', to_jsonb(next_revision)),
    updated_at = now()
  where user_id = owner;

  -- `same` is false when something was left out, so the browser takes the copy as saved.
  return jsonb_build_object('revision', next_revision, 'same', slice = given);
end;
$$;

-- ---------------------------------------------------------------------------
-- Getting in while the app is invite-only: an invite to a workspace lets its
-- person in, as long as the workspace's plan includes a team.

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
  ) or exists (
    select 1
    from public.workspace_members
    where email = lower(trim(address))
      and public.team_plan(owner_id)
  );
$$;

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
  ) or exists (
    select 1
    from public.workspace_members
    where (user_id = auth.uid() or email = lower(auth.jwt() ->> 'email'))
      and public.team_plan(owner_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- What members read of the rest

create policy "Team reads its workspaces' deliveries"
  on public.post_deliveries
  for select
  to authenticated
  using (public.workspace_role(user_id, workspace_id) in ('admin', 'member'));

create policy "Team manages its workspaces' previews"
  on public.post_previews
  for all
  to authenticated
  using (public.workspace_role(owner_id, snapshot ->> 'workspaceId') in ('admin', 'member'))
  with check (
    public.workspace_role(owner_id, snapshot ->> 'workspaceId') in ('admin', 'member')
    and not (post_id = any(public.team_foreign_ids(owner_id, snapshot ->> 'workspaceId')))
  );

-- A preview stays the post it was made for, under the account it was made in.
create or replace function public.post_preview_fixed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.post_id is distinct from old.post_id then
    raise exception 'A preview can''t be moved to another post.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger post_preview_fixed
  before update on public.post_previews
  for each row
  execute function public.post_preview_fixed();

create policy "Team reads comments on its workspaces' previews"
  on public.post_preview_comments
  for select
  to authenticated
  using (exists (
    select 1 from public.post_previews p
    where p.id = preview_id and public.workspace_role(p.owner_id, p.snapshot ->> 'workspaceId') in ('admin', 'member')
  ));

create policy "Team updates comments on its workspaces' previews"
  on public.post_preview_comments
  for update
  to authenticated
  using (exists (
    select 1 from public.post_previews p
    where p.id = preview_id and public.workspace_role(p.owner_id, p.snapshot ->> 'workspaceId') in ('admin', 'member')
  ))
  with check (exists (
    select 1 from public.post_previews p
    where p.id = preview_id and public.workspace_role(p.owner_id, p.snapshot ->> 'workspaceId') in ('admin', 'member')
  ));

create policy "Team deletes comments on its workspaces' previews"
  on public.post_preview_comments
  for delete
  to authenticated
  using (exists (
    select 1 from public.post_previews p
    where p.id = preview_id and public.workspace_role(p.owner_id, p.snapshot ->> 'workspaceId') in ('admin', 'member')
  ));

-- The preview page treats the workspace's team like its owner: they can
-- resolve threads, and their replies show as the brand's.
create or replace function public.get_post_preview(preview uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'snapshot', p.snapshot,
    'updatedAt', p.updated_at,
    'isOwner', p.owner_id = auth.uid() or coalesce(public.workspace_role(p.owner_id, p.snapshot ->> 'workspaceId'), '') in ('admin', 'member'),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'parentId', c.parent_id,
        'name', c.author_name,
        'byOwner', c.author_id is not null and (
          c.author_id = p.owner_id
          or exists (
            select 1 from public.workspace_members m
            where m.owner_id = p.owner_id and m.workspace_id = p.snapshot ->> 'workspaceId' and m.user_id = c.author_id
          )
        ),
        'body', c.body,
        'resolvedAt', c.resolved_at,
        'createdAt', c.created_at
      ) order by c.created_at)
      from public.post_preview_comments c
      where c.preview_id = p.id
    ), '[]'::jsonb)
  )
  from public.post_previews p
  where p.id = preview;
$$;

-- One post, whatever its status, for "Post now" and for checking a post again
-- just before it's sent: now in the workspace its run was made for, when one
-- is named, so a post of the same id in another workspace is never sent in its place.
drop function if exists public.publisher_post(uuid, text);

create or replace function public.publisher_post(owner uuid, post text, workspace text default null)
returns table (workspace_id text, time_zone text, connections jsonb, post jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select w.key, s.payload ->> 'timeZone', public.publisher_connections(w.value), e - 'thumbnail'
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'events', '[]'::jsonb)) e
  where s.user_id = owner and e ->> 'id' = post and (workspace is null or w.key = workspace)
  limit 1;
$$;

revoke all on function public.publisher_post(uuid, text, text) from public, anon, authenticated;
grant execute on function public.publisher_post(uuid, text, text) to service_role;

-- For the publisher: which of an owner's workspaces lists each connected account.
create or replace function public.publisher_workspace_connections(owner uuid)
returns table (workspace_id text, connection_id text)
language sql
stable
security definer
set search_path = public
as $$
  select w.key, c ->> 'id'
  from public.account_state s,
    jsonb_each(coalesce(s.payload -> 'slices', '{}'::jsonb)) w,
    jsonb_array_elements(coalesce(w.value -> 'connections', '[]'::jsonb)) c
  where s.user_id = owner and c ->> 'id' is not null;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what

revoke all on function public.team_plan(uuid) from public, anon, authenticated;
revoke all on function public.owner_has_workspace(uuid, text) from public, anon, authenticated;
revoke all on function public.team_foreign_ids_in(jsonb, text) from public, anon, authenticated;
revoke all on function public.team_clean_event(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.team_foreign_ids(uuid, text) from public, anon;
revoke all on function public.team_files_allowed(uuid, text, text[]) from public, anon;
revoke all on function public.post_preview_fixed() from public, anon, authenticated;
revoke all on function public.workspace_role(uuid, text) from public, anon;
revoke all on function public.team_access(uuid, text) from public, anon;
revoke all on function public.person_name(uuid) from public, anon, authenticated;
revoke all on function public.my_confirmed_email() from public, anon;
revoke all on function public.workspace_look(uuid, text) from public, anon, authenticated;
revoke all on function public.account_state_base() from public, anon, authenticated;
revoke all on function public.note_workspace_versions() from public, anon, authenticated;
revoke all on function public.invite_workspace_member(uuid, text, text, text) from public, anon;
revoke all on function public.set_workspace_member_role(uuid, text) from public, anon;
revoke all on function public.remove_workspace_member(uuid) from public, anon;
revoke all on function public.workspace_team(uuid, text) from public, anon;
revoke all on function public.forget_workspace_team(text) from public, anon;
revoke all on function public.my_team() from public, anon;
revoke all on function public.accept_workspace_invite(uuid) from public, anon;
revoke all on function public.team_workspace(uuid, text) from public, anon;
revoke all on function public.save_team_workspace(uuid, text, jsonb, text) from public, anon;
revoke all on function public.publisher_workspace_connections(uuid) from public, anon, authenticated;

grant execute on function public.team_foreign_ids(uuid, text) to authenticated;
grant execute on function public.team_files_allowed(uuid, text, text[]) to authenticated;
grant execute on function public.workspace_role(uuid, text) to authenticated;
grant execute on function public.team_access(uuid, text) to authenticated;
grant execute on function public.my_confirmed_email() to authenticated;
grant execute on function public.invite_workspace_member(uuid, text, text, text) to authenticated;
grant execute on function public.set_workspace_member_role(uuid, text) to authenticated;
grant execute on function public.remove_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_team(uuid, text) to authenticated;
grant execute on function public.forget_workspace_team(text) to authenticated;
grant execute on function public.my_team() to authenticated;
grant execute on function public.accept_workspace_invite(uuid) to authenticated;
grant execute on function public.team_workspace(uuid, text) to authenticated;
grant execute on function public.save_team_workspace(uuid, text, jsonb, text) to authenticated;
grant execute on function public.publisher_workspace_connections(uuid) to service_role;
-- The publisher names the inviter and the workspace in the invite email.
grant execute on function public.person_name(uuid) to service_role;
grant execute on function public.workspace_look(uuid, text) to service_role;
