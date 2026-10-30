-- Posts move out of account_state into a table of their own, one row per post
-- (docs/design/posts-table.md). Until now every post lived in its owner's one
-- JSON record, so each save, Realtime message and focus moved the whole
-- account, and the publisher unpacked every scheduled post on every pass.
--
--   posts            a post as the calendar keeps it, without its thumbnail
--                    and delivery state, one row per post, kept as a deletion
--                    marker once it's deleted so other devices learn of it
--   post_thumbnails  its thumbnail, loaded only for posts on screen
--   post_schedule    the publisher's own: when it next has to look at a post
--
-- One id is one post in one workspace: the key is (owner, id), and a post
-- never moves to another workspace. Browsers write a post only over the
-- version they read, so a lost update can't happen and conflicts are per
-- post. A post's files must be its own workspace's, for its owner and for
-- anyone in a shared workspace alike.
--
-- The publisher reads posts through the functions below, which now read this
-- table. Apply once in the SQL editor, with 20261026090100_posts_copy.sql
-- straight after it, just before the publisher and the site that use them are
-- deployed: until then the old publisher reads the new table, and the old
-- site keeps saving posts into account_state.

-- ---------------------------------------------------------------------------
-- A post's files

-- Every id a post names a file by: its own id (a post saved before posts
-- listed their files keeps its one file under it), `files`, each network's
-- `ownFiles`, each follow-up's `files`, and its file details in `media`.
create or replace function public.post_file_ids(post_id text, data jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct id order by id) filter (where id is not null and id <> ''), '{}'::text[])
  from (
    select post_id as id
    union all
    select f #>> '{}'
    from jsonb_array_elements(case when jsonb_typeof(data -> 'files') = 'array' then data -> 'files' else '[]'::jsonb end) f
    where jsonb_typeof(f) = 'string'
    union all
    select f #>> '{}'
    from jsonb_each(case when jsonb_typeof(data -> 'ownFiles') = 'object' then data -> 'ownFiles' else '{}'::jsonb end) o,
      jsonb_array_elements(case when jsonb_typeof(o.value) = 'array' then o.value else '[]'::jsonb end) f
    where jsonb_typeof(f) = 'string'
    union all
    select f #>> '{}'
    from jsonb_array_elements(case when jsonb_typeof(data -> 'thread') = 'array' then data -> 'thread' else '[]'::jsonb end) t,
      jsonb_array_elements(case when jsonb_typeof(t -> 'files') = 'array' then t -> 'files' else '[]'::jsonb end) f
    where jsonb_typeof(f) = 'string'
    union all
    select m ->> 'id'
    from jsonb_array_elements(case when jsonb_typeof(data -> 'media') = 'array' then data -> 'media' else '[]'::jsonb end) m
    where jsonb_typeof(m) = 'object'
  ) ids;
$$;

-- ---------------------------------------------------------------------------
-- Tables

create table public.posts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- The post as the calendar stores it, without its thumbnail and delivery state. Null once deleted.
  data jsonb check (
    data is null or (
      jsonb_typeof(data) = 'object'
      and data ->> 'id' = id
      and data ->> 'status' in ('draft', 'scheduled', 'posted')
      and octet_length(data::text) <= 262144
    )
  ),
  -- Raised by every change to the post, so a browser writes only over the version it read.
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  -- When the post, its deletion or its thumbnail last changed: what devices read changes since.
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  -- When its thumbnail last changed, so devices know to load it again.
  thumbnail_at timestamptz,
  status text generated always as (data ->> 'status') stored,
  file_ids text[] generated always as (public.post_file_ids(id, data)) stored,
  primary key (owner_id, id),
  check ((deleted_at is null) = (data is not null))
);

-- What a device reads when it comes back: its workspace's changes since it last looked.
create index posts_changes on public.posts (owner_id, workspace_id, updated_at);
-- The publisher's hourly look over every scheduled post.
create index posts_scheduled on public.posts (owner_id, workspace_id, id) where status = 'scheduled' and deleted_at is null;
-- Whether a file belongs to a post of another workspace.
create index posts_files on public.posts using gin (file_ids);

create table public.post_thumbnails (
  owner_id uuid not null,
  post_id text not null,
  thumbnail text not null check (thumbnail like 'data:image/%' and length(thumbnail) <= 200000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, post_id),
  foreign key (owner_id, post_id) references public.posts (owner_id, id) on delete cascade
);

-- The publisher's: when it next has to look at a post, and how far its runs
-- were looked through for ones missed while it was down. A post changed by
-- anyone is due a look at once.
create table public.post_schedule (
  owner_id uuid not null,
  post_id text not null,
  next_run_at timestamptz,
  planned_through timestamptz,
  primary key (owner_id, post_id),
  foreign key (owner_id, post_id) references public.posts (owner_id, id) on delete cascade
);

create index post_schedule_due on public.post_schedule (next_run_at) where next_run_at is not null;

-- ---------------------------------------------------------------------------
-- Rules a write must keep

-- Whether any of these ids is a post or file of another of the owner's
-- workspaces: a post of another, or its files (all in posts.file_ids, found
-- through its index), or an item of another workspace's media library (in
-- account_state; only the libraries are read, not the whole record).
create or replace function public.post_files_elsewhere(owner uuid, workspace text, ids text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select cardinality(coalesce(ids, '{}'::text[])) > 0 and (
    exists (
      select 1 from public.posts p
      where p.owner_id = owner and p.workspace_id <> workspace and p.file_ids && ids
    )
    or exists (
      select 1
      from public.account_state a,
        jsonb_each(case when jsonb_typeof(a.payload -> 'slices') = 'object' then a.payload -> 'slices' else '{}'::jsonb end) w,
        jsonb_array_elements(case when jsonb_typeof(w.value -> 'library') = 'array' then w.value -> 'library' else '[]'::jsonb end) l
      where a.user_id = owner and w.key <> workspace and l ->> 'id' = any(ids)
    )
  );
$$;

-- Before a post is written: it stays in its workspace, its version and times
-- are the database's, a deleted post keeps nothing, and its files are its
-- own workspace's.
create or replace function public.posts_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed boolean;
begin
  if new.deleted_at is not null then
    new.data := null;
    -- The database's own time, whatever a browser's clock says: markers are pruned by it.
    new.deleted_at := case when tg_op = 'UPDATE' and old.deleted_at is not null then old.deleted_at else clock_timestamp() end;
  end if;
  if tg_op = 'INSERT' then
    -- One id is one post, deleted or not, in whichever workspace: said before anything else is checked.
    if exists (select 1 from public.posts p where p.owner_id = new.owner_id and p.id = new.id) then
      raise exception 'This post already exists.' using errcode = '23505';
    end if;
    new.version := 1;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    new.thumbnail_at := null;
  else
    if new.owner_id <> old.owner_id or new.id <> old.id or new.workspace_id <> old.workspace_id then
      raise exception 'A post stays in the workspace it was made in.' using errcode = '42501';
    end if;
    changed := new.data is distinct from old.data or new.deleted_at is distinct from old.deleted_at;
    new.version := case when changed then old.version + 1 else old.version end;
    new.created_at := old.created_at;
    -- A thumbnail alone moves the post on to the thumbnail's own time, so the tab that saved it knows the change for its own.
    new.updated_at := case
      when changed then clock_timestamp()
      when new.thumbnail_at is distinct from old.thumbnail_at then coalesce(new.thumbnail_at, clock_timestamp())
      else old.updated_at
    end;
  end if;
  if new.data is not null and public.post_files_elsewhere(new.owner_id, new.workspace_id, public.post_file_ids(new.id, new.data)) then
    raise exception 'This post names a file of another workspace.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger posts_before_write
  before insert or update on public.posts
  for each row execute function public.posts_before_write();

-- After a post is made, changed or deleted: the publisher looks at it at once.
create or replace function public.posts_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.post_schedule (owner_id, post_id, next_run_at)
    values (new.owner_id, new.id, clock_timestamp())
    on conflict (owner_id, post_id) do update set next_run_at = excluded.next_run_at;
  end if;
  -- A deleted post keeps nothing, its thumbnail included.
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
    delete from public.post_thumbnails where owner_id = new.owner_id and post_id = new.id;
  end if;
  return null;
end;
$$;

create trigger posts_after_write
  after insert or update on public.posts
  for each row execute function public.posts_after_write();

-- A thumbnail's time is the database's, and its post learns it changed.
create or replace function public.post_thumbnails_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Gone with its post, when the post was deleted: the post's own change says so, once.
    update public.posts set thumbnail_at = clock_timestamp() where owner_id = old.owner_id and id = old.post_id and deleted_at is null;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.owner_id <> old.owner_id or new.post_id <> old.post_id) then
    raise exception 'A thumbnail stays with its post.' using errcode = '42501';
  end if;
  -- A deleted post keeps no picture: said as its post being gone.
  if exists (select 1 from public.posts p where p.owner_id = new.owner_id and p.id = new.post_id and p.deleted_at is not null) then
    raise exception 'This post was deleted.' using errcode = '23503';
  end if;
  new.updated_at := clock_timestamp();
  update public.posts set thumbnail_at = new.updated_at where owner_id = new.owner_id and id = new.post_id;
  return new;
end;
$$;

create trigger post_thumbnails_write
  before insert or update or delete on public.post_thumbnails
  for each row execute function public.post_thumbnails_write();

-- ---------------------------------------------------------------------------
-- Who reads and writes what

-- Whether the signed-in person may reach the owner's posts in `workspace`: their own, or a shared workspace they're an admin or member of.
create or replace function public.post_reachable(owner uuid, workspace text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = auth.uid() or coalesce(public.workspace_role(owner, workspace) in ('admin', 'member'), false);
$$;

-- The same for a thumbnail, by its post.
create or replace function public.post_thumbnail_reachable(owner uuid, post text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.posts p where p.owner_id = owner and p.id = post and p.deleted_at is null and public.post_reachable(p.owner_id, p.workspace_id));
$$;

alter table public.posts enable row level security;
alter table public.post_thumbnails enable row level security;
alter table public.post_schedule enable row level security;

revoke all on public.posts from anon, authenticated;
revoke all on public.post_thumbnails from anon, authenticated;
revoke all on public.post_schedule from anon, authenticated;

-- Browsers make and change posts and mark them deleted; the rest is the database's.
grant select on public.posts to authenticated;
grant insert (owner_id, id, workspace_id, data, deleted_at) on public.posts to authenticated;
grant update (data, deleted_at) on public.posts to authenticated;
-- A thumbnail is saved by upsert, which names every column; the trigger keeps it with its post and sets its time.
grant select, insert, update, delete on public.post_thumbnails to authenticated;

create policy "People reach their workspaces' posts"
  on public.posts
  for select
  to authenticated
  using (public.post_reachable(owner_id, workspace_id));

create policy "People make posts in their workspaces"
  on public.posts
  for insert
  to authenticated
  with check (public.post_reachable(owner_id, workspace_id));

create policy "People change their workspaces' posts"
  on public.posts
  for update
  to authenticated
  using (public.post_reachable(owner_id, workspace_id))
  with check (public.post_reachable(owner_id, workspace_id));

create policy "People reach their posts' thumbnails"
  on public.post_thumbnails
  for all
  to authenticated
  using (public.post_thumbnail_reachable(owner_id, post_id))
  with check (public.post_thumbnail_reachable(owner_id, post_id));

-- A connector's token (an outside AI agent's) reaches none of it, here or over Realtime, which skips refuse_app_tokens.
-- post_replies, made after the connector migration, gets the same rule.
do $$
declare
  t text;
begin
  foreach t in array array['posts', 'post_thumbnails', 'post_schedule', 'post_replies'] loop
    execute format('drop policy if exists "Only plan.video''s own sign-in" on public.%I', t);
    execute format(
      'create policy "Only plan.video''s own sign-in" on public.%I as restrictive for all '
      'using (coalesce((select auth.jwt() ->> ''client_id''), '''') = '''') '
      'with check (coalesce((select auth.jwt() ->> ''client_id''), '''') = '''')',
      t
    );
  end loop;
end;
$$;

-- Each post's changes reach the tabs that may see it, checked against the rules above.
alter publication supabase_realtime add table public.posts;

-- ---------------------------------------------------------------------------
-- Shared workspaces read posts from here now

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
    and not public.post_files_elsewhere(owner, workspace, array(select regexp_replace(id, '-poster$', '') from unnest(coalesce(ids, '{}'::text[])) id));
$$;

-- For a shared preview: whether this post id is another of the owner's
-- workspaces', for someone in `workspace`. True (so refused) for anyone else.
create or replace function public.team_post_elsewhere(owner uuid, workspace text, post text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when public.workspace_role(owner, workspace) is null then true
    else public.post_files_elsewhere(owner, workspace, array[post]) end;
$$;

drop policy "Team manages its workspaces' previews" on public.post_previews;
create policy "Team manages its workspaces' previews"
  on public.post_previews
  for all
  to authenticated
  using (public.workspace_role(owner_id, snapshot ->> 'workspaceId') in ('admin', 'member'))
  with check (
    public.workspace_role(owner_id, snapshot ->> 'workspaceId') in ('admin', 'member')
    and not public.team_post_elsewhere(owner_id, snapshot ->> 'workspaceId', post_id)
  );

-- A shared workspace's slice no longer carries its posts or their file
-- details: a member saves those as posts. The rest is as before.
create or replace function public.save_team_workspace(owner uuid, workspace text, slice jsonb, base text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  my_role text := public.workspace_role(owner, workspace);
  current jsonb;
  given jsonb;
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
  slice := slice - 'events' - 'media';
  given := slice;

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
  -- Nor can anyone's copy take a library item named like a post or file of another of the owner's workspaces.
  if jsonb_typeof(slice -> 'library') = 'array' then
    foreign_ids := public.team_foreign_ids_in(current, workspace)
      || coalesce((select array_agg(f) from public.posts p, unnest(p.file_ids) f where p.owner_id = owner and p.workspace_id <> workspace), '{}'::text[]);
    slice := jsonb_set(slice, '{library}', coalesce((
      select jsonb_agg(l.value order by l.position)
      from jsonb_array_elements(slice -> 'library') with ordinality as l(value, position)
      where not coalesce((l.value ->> 'id') = any(foreign_ids), false)
    ), '[]'::jsonb));
  end if;

  update public.account_state
  set payload = jsonb_set(jsonb_set(current - 'base', array['slices', workspace], slice), '{revision}', to_jsonb(next_revision)),
    updated_at = now()
  where user_id = owner;

  -- `same` is false when something was left out, so the browser takes the copy as saved.
  return jsonb_build_object('revision', next_revision, 'same', slice = given);
end;
$$;

-- Deleting a workspace takes its posts with it, once the workspace is gone from the owner's account.
create or replace function public.forget_workspace_team(workspace text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.workspace_members where owner_id = auth.uid() and workspace_id = workspace;
  delete from public.workspace_versions where owner_id = auth.uid() and workspace_id = workspace;
  delete from public.post_previews where owner_id = auth.uid() and snapshot->>'workspaceId' = workspace;
  delete from public.posts where owner_id = auth.uid() and workspace_id = workspace and not public.owner_has_workspace(auth.uid(), workspace);
$$;

-- ---------------------------------------------------------------------------
-- The publisher

-- One post, whatever its status, in the workspace its run was made for when one is named.
create or replace function public.publisher_post(owner uuid, post text, workspace text default null)
returns table (workspace_id text, time_zone text, connections jsonb, post jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select p.workspace_id, a.payload ->> 'timeZone', public.publisher_connections(a.payload -> 'slices' -> p.workspace_id), p.data
  from public.posts p
  left join public.account_state a on a.user_id = p.owner_id
  where p.owner_id = owner and p.id = post and p.deleted_at is null and (workspace is null or p.workspace_id = workspace);
$$;

-- Every scheduled post, unpaused, on a network the publisher sends to, with
-- its version and next look: for the publisher's hourly look over them all.
drop function public.publisher_posts();
drop function public.publisher_posts_after(uuid, text, text, integer);

create or replace function public.publisher_posts()
returns table (user_id uuid, workspace_id text, time_zone text, connections jsonb, post jsonb, version bigint, next_run_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.owner_id, p.workspace_id, a.payload ->> 'timeZone', public.publisher_connections(a.payload -> 'slices' -> p.workspace_id), p.data, p.version, s.next_run_at
  from public.posts p
  left join public.account_state a on a.user_id = p.owner_id
  left join public.post_schedule s on s.owner_id = p.owner_id and s.post_id = p.id
  where p.status = 'scheduled' and p.deleted_at is null
    and coalesce(p.data ->> 'paused', 'false') <> 'true'
    and coalesce(p.data -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x', 'instagram', 'facebook', 'threads'];
$$;

create or replace function public.publisher_posts_after(
  after_user uuid default null,
  after_workspace text default '',
  after_post text default '',
  size integer default 500
)
returns table (user_id uuid, workspace_id text, time_zone text, connections jsonb, post jsonb, version bigint, next_run_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.owner_id, p.workspace_id, a.payload ->> 'timeZone', public.publisher_connections(a.payload -> 'slices' -> p.workspace_id), p.data, p.version, s.next_run_at
  from public.posts p
  left join public.account_state a on a.user_id = p.owner_id
  left join public.post_schedule s on s.owner_id = p.owner_id and s.post_id = p.id
  where (p.owner_id, p.workspace_id, p.id) > (coalesce(after_user, '00000000-0000-0000-0000-000000000000'::uuid), after_workspace, after_post)
    and p.status = 'scheduled' and p.deleted_at is null
    and coalesce(p.data ->> 'paused', 'false') <> 'true'
    and coalesce(p.data -> 'platforms', '[]'::jsonb) ?| array['tiktok', 'youtube', 'bluesky', 'linkedin', 'x', 'instagram', 'facebook', 'threads']
  order by p.owner_id, p.workspace_id, p.id
  limit least(greatest(size, 1), 1000);
$$;

-- The posts due a look by `before`, soonest first: changed ones, and ones
-- whose next run has come. Deleted ones too, so what's kept for them goes.
create or replace function public.publisher_due(before timestamptz, size integer default 500)
returns table (
  user_id uuid,
  workspace_id text,
  post_id text,
  version bigint,
  next_run_at timestamptz,
  planned_through timestamptz,
  time_zone text,
  connections jsonb,
  post jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select p.owner_id, p.workspace_id, p.id, p.version, s.next_run_at, s.planned_through,
    a.payload ->> 'timeZone', public.publisher_connections(a.payload -> 'slices' -> p.workspace_id), p.data
  from public.post_schedule s
  join public.posts p on p.owner_id = s.owner_id and p.id = s.post_id
  left join public.account_state a on a.user_id = p.owner_id
  where s.next_run_at <= before
  order by s.next_run_at, s.owner_id, s.post_id
  limit least(greatest(size, 1), 1000);
$$;

-- When the soonest look is due, so the publisher can wake for it.
create or replace function public.publisher_next_due()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(next_run_at) from public.post_schedule;
$$;

-- Keeps when the publisher next looks at each post, for the posts not
-- changed since it read them (`version`): a post changed meanwhile is due
-- a look at once, and stays so. `items` is a list of
-- {user_id, post_id, version, next_run_at, planned_through}; a planned_through
-- left out keeps the one before. Returns how many were kept.
create or replace function public.publisher_schedule(items jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with given as (
    select * from jsonb_to_recordset(coalesce(items, '[]'::jsonb))
      as i(user_id uuid, post_id text, version bigint, next_run_at timestamptz, planned_through timestamptz)
  ),
  kept as (
    update public.post_schedule s
    set next_run_at = g.next_run_at, planned_through = coalesce(g.planned_through, s.planned_through)
    from given g, public.posts p
    where s.owner_id = g.user_id and s.post_id = g.post_id
      and p.owner_id = g.user_id and p.id = g.post_id and p.version = g.version
    returning 1
  )
  select count(*)::integer from kept;
$$;

-- Marks a one-off post as posted once every network has it, so it no longer
-- depends on a browser being open: a scheduled one, or a draft sent with
-- Post now. Never a series, which goes on.
create or replace function public.publisher_mark_posted(owner uuid, post text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with marked as (
    update public.posts
    set data = jsonb_set(data, '{status}', '"posted"')
    where owner_id = owner and id = post and deleted_at is null
      and data ->> 'status' in ('scheduled', 'draft')
      and coalesce(data ->> 'recurrence', '') = ''
    returning 1
  )
  select exists (select 1 from marked);
$$;

-- Every post of an owner due a look at once: for one who had posts over the
-- Free limit and pays now, so those runs go out after all.
create or replace function public.publisher_look_again(owner uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with looked as (
    update public.post_schedule set next_run_at = clock_timestamp() where owner_id = owner returning 1
  )
  select count(*)::integer from looked;
$$;

-- Deletion markers past their use: devices away longer than this learn of a deletion by their own rule (docs/design).
create or replace function public.publisher_prune_deleted(before timestamptz)
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.posts where deleted_at < before returning 1
  )
  select count(*)::integer from gone;
$$;

-- The Free plan's waiting posts are now counted a post at a time, as each is
-- looked at: each kept post says until when it waits, so the others count
-- as they were last seen. Null while a series has no end, and for rows from
-- before this, until their post is next looked at.
alter table public.publisher_waiting add column until timestamptz;

-- ---------------------------------------------------------------------------
-- Who may call what

revoke all on function public.post_file_ids(text, jsonb) from public, anon;
revoke all on function public.post_files_elsewhere(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.posts_before_write() from public, anon, authenticated;
revoke all on function public.posts_after_write() from public, anon, authenticated;
revoke all on function public.post_thumbnails_write() from public, anon, authenticated;
revoke all on function public.post_reachable(uuid, text) from public, anon;
revoke all on function public.post_thumbnail_reachable(uuid, text) from public, anon;
revoke all on function public.team_post_elsewhere(uuid, text, text) from public, anon;
revoke all on function public.publisher_post(uuid, text, text) from public, anon, authenticated;
revoke all on function public.publisher_posts() from public, anon, authenticated;
revoke all on function public.publisher_posts_after(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.publisher_due(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.publisher_next_due() from public, anon, authenticated;
revoke all on function public.publisher_schedule(jsonb) from public, anon, authenticated;
revoke all on function public.publisher_mark_posted(uuid, text) from public, anon, authenticated;
revoke all on function public.publisher_prune_deleted(timestamptz) from public, anon, authenticated;
revoke all on function public.publisher_look_again(uuid) from public, anon, authenticated;
-- No browser reads another workspace's ids any more: previews ask team_post_elsewhere, the signer team_files_allowed.
revoke all on function public.team_foreign_ids(uuid, text) from public, anon, authenticated;

-- The file-id column is worked out as whoever writes the post.
grant execute on function public.post_file_ids(text, jsonb) to authenticated;
grant execute on function public.post_reachable(uuid, text) to authenticated;
grant execute on function public.post_thumbnail_reachable(uuid, text) to authenticated;
grant execute on function public.team_post_elsewhere(uuid, text, text) to authenticated;
grant execute on function public.publisher_post(uuid, text, text) to service_role;
grant execute on function public.publisher_posts() to service_role;
grant execute on function public.publisher_posts_after(uuid, text, text, integer) to service_role;
grant execute on function public.publisher_due(timestamptz, integer) to service_role;
grant execute on function public.publisher_next_due() to service_role;
grant execute on function public.publisher_schedule(jsonb) to service_role;
grant execute on function public.publisher_mark_posted(uuid, text) to service_role;
grant execute on function public.publisher_prune_deleted(timestamptz) to service_role;
grant execute on function public.publisher_look_again(uuid) to service_role;
