-- Outside agents (services/mcp) work without a plan.video tab open. Until now
-- every tool ran in the person's tab; these functions let the connector's own
-- token read the workspace open in their dashboard and save its posts, so
-- the MCP server holds no key of its own. Each one finds the person through
-- connector_identity and checks their place in the workspace itself. The
-- publisher sends what they save as it sends any post.
--
-- Apply in the SQL editor before deploying services/mcp and services/storage
-- that call them. Until then those services answer as before, through a tab.

-- The person a connector's token speaks for, while its session lasts. Null for any other token.
create or replace function public.agent_person()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(public.connector_identity() ->> 'user_id', '')::uuid;
$$;

-- workspace_role for a given person: connector tokens name nobody in auth.uid().
create or replace function public.agent_role(person uuid, owner uuid, workspace text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when person is null or owner is null or workspace is null or not public.owner_has_workspace(owner, workspace) then null
    when owner = person then 'owner'
    else (
      select m.role
      from public.workspace_members m
      where m.owner_id = owner
        and m.workspace_id = workspace
        and m.user_id = person
        and public.team_plan(owner)
    )
  end;
$$;

-- let_in for a given person.
create or replace function public.agent_let_in(person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select g.invite_only from public.invite_gate g where g.only_row), true)
    or exists (
      select 1 from public.waitlist w join auth.users u on w.email = lower(u.email)
      where u.id = person and w.invited_at is not null
    )
    or exists (
      select 1 from public.workspace_members m
      where m.user_id = person and public.team_plan(m.owner_id)
    );
$$;

-- The caller's role in the workspace, or an error. `writing` also needs them let in.
create or replace function public.agent_scope(owner uuid, workspace text, writing boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  person uuid := public.agent_person();
  my_role text;
begin
  if person is null then
    raise exception 'Your plan.video sign-in has ended. Connect again.' using errcode = '28000';
  end if;
  my_role := public.agent_role(person, owner, workspace);
  if my_role is null then
    raise exception 'You''re not in this workspace.' using errcode = '42501';
  end if;
  if writing and not public.agent_let_in(person) then
    raise exception 'This account hasn''t been let in yet.' using errcode = '42501';
  end if;
  return my_role;
end;
$$;

-- The workspace open last in the person's dashboard, as the tab used: its
-- accounts (never their logins), media library, calendar, time zone and the
-- owner's plan. A shared one that's gone or paused falls back to their own.
create or replace function public.agent_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  person uuid := public.agent_person();
  mine jsonb;
  active text;
  owner uuid;
  workspace text;
  theirs jsonb;
  slice jsonb;
  my_role text;
begin
  if person is null then
    raise exception 'Your plan.video sign-in has ended. Connect again.' using errcode = '28000';
  end if;
  select s.payload into mine from public.account_state s where s.user_id = person;
  active := coalesce(mine -> 'workspaces' ->> 'active', 'default');

  -- A shared workspace is open as `shared-<owner>-<workspace>` (lib/workspaces.ts sharedIdOf).
  if active ~ '^shared-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_-]{1,100}$' then
    owner := substr(active, 8, 36)::uuid;
    workspace := substr(active, 45);
    my_role := public.agent_role(person, owner, workspace);
  end if;
  if my_role is null then
    owner := person;
    workspace := case when mine -> 'slices' ? active then active else 'default' end;
    my_role := public.agent_role(person, owner, workspace);
  end if;
  if my_role is null then
    raise exception 'Open plan.video once to set up your workspace, then try again.' using errcode = 'P0002';
  end if;

  select s.payload into theirs from public.account_state s where s.user_id = owner;
  slice := theirs -> 'slices' -> workspace;
  return jsonb_build_object(
    'owner', owner,
    'workspace', workspace,
    'name', coalesce((
      select w ->> 'name'
      from jsonb_array_elements(case when jsonb_typeof(theirs -> 'workspaces' -> 'list') = 'array' then theirs -> 'workspaces' -> 'list' else '[]'::jsonb end) w
      where w ->> 'id' = workspace
    ), ''),
    'role', my_role,
    'level', coalesce((select u.access_level from public.user_data u where u.id = owner), 1),
    'letIn', public.agent_let_in(person),
    'membersNeedApproval', public.members_need_approval(owner, workspace),
    -- The person's own dashboard time zone, as their tab reads days and times in.
    'timeZone', coalesce(nullif(mine ->> 'timeZone', ''), 'UTC'),
    'calendarId', coalesce(slice -> 'calendars' -> 0 ->> 'id', 'posts'),
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c ->> 'id',
        'platform', c ->> 'platform',
        'handle', coalesce(c ->> 'handle', ''),
        'ready', coalesce(jsonb_typeof(c -> (c ->> 'platform')) = 'object', false),
        -- What its login was granted, and for LinkedIn whether it's a company Page: what analytics can read.
        'scope', coalesce(c -> (c ->> 'platform') ->> 'scope', ''),
        'page', coalesce(c -> 'linkedin' ->> 'organizationId', '') <> ''
      ) order by n)
      from jsonb_array_elements(case when jsonb_typeof(slice -> 'connections') = 'array' then slice -> 'connections' else '[]'::jsonb end) with ordinality as x(c, n)
      where c ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    ), '[]'::jsonb),
    'library', case when jsonb_typeof(slice -> 'library') = 'array' then slice -> 'library' else '[]'::jsonb end
  );
end;
$$;

-- The workspace's posts, as the calendar keeps them, with each network's
-- latest delivery. Filters cut what crosses the wire for big calendars.
create or replace function public.agent_posts(
  owner uuid,
  workspace text,
  post_id text default null,
  status text default null,
  from_day text default null,
  to_day text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.agent_scope(owner, workspace);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'data', p.data, 'deliveries', coalesce(d.latest, '{}'::jsonb)) order by p.id)
    from public.posts p
    left join lateral (
      select jsonb_object_agg(l.platform, jsonb_strip_nulls(jsonb_build_object('state', l.state, 'error', l.error))) as latest
      from (
        select distinct on (r.platform) r.platform, r.state, r.error
        from public.post_deliveries r
        where r.user_id = p.owner_id and r.workspace_id = p.workspace_id and r.post_id = p.id
        order by r.platform, r.due_at desc, r.created_at desc
      ) l
    ) d on true
    where p.owner_id = agent_posts.owner
      and p.workspace_id = agent_posts.workspace
      and p.deleted_at is null
      and (agent_posts.post_id is null or p.id = agent_posts.post_id)
      and (agent_posts.status is null or p.status = agent_posts.status)
      and (from_day is null or p.data ->> 'day' >= from_day)
      and (to_day is null or p.data ->> 'day' <= to_day)
  ), '[]'::jsonb);
end;
$$;

-- Makes a post (`base` null) or changes one over the version read, as a
-- browser does. A changed post comes back as a conflict, never overwritten.
create or replace function public.agent_save_post(owner uuid, workspace text, post jsonb, base bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved bigint;
begin
  perform public.agent_scope(owner, workspace, true);
  if post is null or jsonb_typeof(post) <> 'object' or coalesce(post ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'That isn''t a post.' using errcode = '22023';
  end if;
  if base is null then
    insert into public.posts (owner_id, id, workspace_id, data)
    values (owner, post ->> 'id', workspace, post)
    returning version into saved;
  else
    update public.posts p
    set data = post
    where p.owner_id = agent_save_post.owner and p.id = post ->> 'id' and p.workspace_id = agent_save_post.workspace
      and p.version = base and p.deleted_at is null
    returning p.version into saved;
    if saved is null then
      return jsonb_build_object('conflict', true);
    end if;
  end if;
  return jsonb_build_object('version', saved);
end;
$$;

create or replace function public.agent_delete_post(owner uuid, workspace text, post_id text, base bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.agent_scope(owner, workspace, true);
  update public.posts p
  set deleted_at = clock_timestamp()
  where p.owner_id = agent_delete_post.owner and p.id = agent_delete_post.post_id and p.workspace_id = agent_delete_post.workspace
    and p.version = base and p.deleted_at is null;
  if not found then
    return jsonb_build_object('conflict', true);
  end if;
  return jsonb_build_object('deleted', true);
end;
$$;

-- Holds a post for approval and shares its link, as the tab's ask for
-- approval does: off the schedule until it's approved, with a note in its
-- comments that it was asked for. `snapshot` is what the link shows. New
-- links come with paid plans, as post_previews' own rule says.
create or replace function public.agent_ask_approval(owner uuid, workspace text, post_id text, base bigint, snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  person uuid := public.agent_person();
  current public.posts;
  saved bigint;
  preview uuid;
  who text;
begin
  perform public.agent_scope(owner, workspace, true);
  if snapshot is null or jsonb_typeof(snapshot) <> 'object' or snapshot ->> 'workspaceId' is distinct from workspace then
    raise exception 'That isn''t a preview.' using errcode = '22023';
  end if;
  select * into current from public.posts p
  where p.owner_id = agent_ask_approval.owner and p.id = agent_ask_approval.post_id and p.workspace_id = agent_ask_approval.workspace and p.deleted_at is null;
  if not found then
    raise exception 'This post no longer exists.' using errcode = 'P0002';
  end if;
  if current.version <> base then
    return jsonb_build_object('conflict', true);
  end if;
  if current.data ->> 'status' = 'posted' then
    raise exception 'This post has already gone out.' using errcode = '22023';
  end if;
  select v.id into preview from public.post_previews v where v.owner_id = agent_ask_approval.owner and v.post_id = agent_ask_approval.post_id;
  if preview is null and coalesce((select u.access_level from public.user_data u where u.id = owner), 1) <= 1 then
    raise exception 'Approval links come with a paid plan.' using errcode = '42501';
  end if;
  who := left(coalesce(public.person_name(person), ''), 80);

  saved := current.version;
  if current.data -> 'approval' ->> 'state' is distinct from 'pending' then
    update public.posts p
    set data = current.data || jsonb_build_object(
      'approval', jsonb_strip_nulls(jsonb_build_object('state', 'pending', 'at', to_jsonb(now()), 'by', nullif(who, ''))),
      'status', case when current.data ->> 'status' = 'scheduled' then 'draft' else current.data ->> 'status' end,
      'sendFrom', to_jsonb(now())
    )
    where p.owner_id = current.owner_id and p.id = current.id and p.version = base
    returning p.version into saved;
    if saved is null then
      return jsonb_build_object('conflict', true);
    end if;
  end if;

  insert into public.post_previews as v (owner_id, post_id, snapshot, updated_at)
  values (owner, post_id, snapshot, now())
  on conflict (owner_id, post_id) do update set snapshot = excluded.snapshot, updated_at = excluded.updated_at
  returning v.id into preview;

  if who <> '' and not public.preview_busy(preview) and (
    select c.kind from public.post_preview_comments c
    where c.preview_id = preview and c.kind <> 'comment'
    order by c.created_at desc
    limit 1
  ) is distinct from 'requested' then
    insert into public.post_preview_comments (preview_id, author_name, author_id, body, kind)
    values (preview, who, person, '', 'requested');
  end if;
  return jsonb_build_object('version', saved, 'preview', preview);
end;
$$;

-- As in 20261126120000_post_approvals.sql, with an agent working for a member
-- counted as that member: its token names nobody in auth.uid().
create or replace function public.posts_approval_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was jsonb := case when tg_op = 'UPDATE' then old.data end;
  agent uuid := public.agent_person();
  my_role text;
begin
  if new.data is null then
    return new;
  end if;
  if agent is not null then
    my_role := public.agent_role(agent, new.owner_id, new.workspace_id);
  elsif auth.uid() is not null then
    my_role := public.workspace_role(new.owner_id, new.workspace_id);
  end if;
  if my_role is distinct from 'member' then
    return new;
  end if;
  if new.data -> 'approval' ->> 'state' in ('approved', 'changes') and (new.data -> 'approval') is distinct from (was -> 'approval') then
    raise exception 'Only the workspace''s owner and admins can approve posts.' using errcode = '42501';
  end if;
  if new.data ->> 'status' = 'scheduled'
    and public.members_need_approval(new.owner_id, new.workspace_id)
    and not coalesce(was ->> 'status' = 'scheduled' and (new.data - 'status' - 'sendFrom') = (was - 'status' - 'sendFrom'), false)
  then
    raise exception 'Posts in this workspace need approval before they go out. Ask for approval instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.posts_approval_rules() from public, anon, authenticated;

-- For services/storage, asked with the connector's token before it copies
-- files onto a post: each source is `media/<id>`, a file of this workspace's
-- media library, or `posts/<id>`, a file of one of its posts; each new id is
-- no other workspace's. Answers the owner's plan, whose space it takes.
create or replace function public.agent_copy_files(owner uuid, workspace text, sources text[], files text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  library jsonb;
begin
  perform public.agent_scope(owner, workspace, true);
  if cardinality(coalesce(sources, '{}')) = 0 or cardinality(sources) <> cardinality(coalesce(files, '{}')) or cardinality(sources) > 35
    or (select count(distinct f) from unnest(files) f) <> cardinality(files) then
    raise exception 'Name each file once.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(files) f where f is null or f !~ '^[A-Za-z0-9_-]{1,100}$')
    or exists (select 1 from unnest(sources) s where s is null or s !~ '^(media|posts)/[A-Za-z0-9_-]{1,100}$') then
    raise exception 'That file can''t be stored.' using errcode = '22023';
  end if;
  select a.payload -> 'slices' -> workspace -> 'library' into library from public.account_state a where a.user_id = owner;
  if exists (
    select 1 from unnest(sources) s
    where case split_part(s, '/', 1)
      when 'media' then not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(library) = 'array' then library else '[]'::jsonb end) l
        where l ->> 'id' = split_part(s, '/', 2) and l -> 'cloud' ->> 'key' = format('media/%s/%s', owner, split_part(s, '/', 2))
      )
      else not exists (
        select 1 from public.posts p
        where p.owner_id = agent_copy_files.owner and p.workspace_id = agent_copy_files.workspace and p.deleted_at is null
          and p.file_ids @> array[split_part(s, '/', 2)]
      )
    end
  ) then
    raise exception 'That file is no longer in this workspace.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.posts p where p.owner_id = agent_copy_files.owner and p.file_ids && files)
    or public.post_files_elsewhere(owner, workspace, files) then
    raise exception 'That file is already taken.' using errcode = '42501';
  end if;
  return jsonb_build_object('level', coalesce((select u.access_level from public.user_data u where u.id = owner), 1));
end;
$$;

revoke all on function public.agent_person() from public, anon, authenticated;
revoke all on function public.agent_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.agent_let_in(uuid) from public, anon, authenticated;
revoke all on function public.agent_scope(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.agent_context() from public, anon;
revoke all on function public.agent_posts(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.agent_save_post(uuid, text, jsonb, bigint) from public, anon;
revoke all on function public.agent_delete_post(uuid, text, text, bigint) from public, anon;
revoke all on function public.agent_ask_approval(uuid, text, text, bigint, jsonb) from public, anon;
revoke all on function public.agent_copy_files(uuid, text, text[], text[]) from public, anon;
grant execute on function public.agent_context() to authenticated;
grant execute on function public.agent_posts(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.agent_save_post(uuid, text, jsonb, bigint) to authenticated;
grant execute on function public.agent_delete_post(uuid, text, text, bigint) to authenticated;
grant execute on function public.agent_ask_approval(uuid, text, text, bigint, jsonb) to authenticated;
grant execute on function public.agent_copy_files(uuid, text, text[], text[]) to authenticated;

-- A connector's token still reaches nothing else: tables, Storage and every other function stay refused.
create or replace function public.refuse_app_tokens()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'client_id', '') <> ''
    and coalesce(current_setting('request.path', true), '') not in (
      '/rpc/connector_identity',
      '/rpc/agent_context',
      '/rpc/agent_posts',
      '/rpc/agent_save_post',
      '/rpc/agent_delete_post',
      '/rpc/agent_ask_approval',
      '/rpc/agent_copy_files'
    ) then
    raise exception 'This token is only for the plan.video connector.' using errcode = 'PT403';
  end if;
end;
$$;

notify pgrst, 'reload config';
