-- What a deleted workspace or a departing admin leaves behind. Apply this before
-- updating the publisher, which writes the new column. Safe to run again.
--
-- 1. Deleting a workspace unshares all its previews, however many: a browser can
--    delete at most 100 in one statement, and this runs as the browser.
-- 2. When an admin's rights end, the workspace's live client links end too: any
--    admin could have copied any of them. Someone who was only invited never could.
-- 3. An admin can list a new account only if its login isn't one kept for somewhere
--    else, so a login left by a half-finished deletion can't be picked up.

create or replace function public.forget_workspace_team(workspace text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.workspace_members where owner_id = auth.uid() and workspace_id = workspace;
  delete from public.workspace_versions where owner_id = auth.uid() and workspace_id = workspace;
  loop
    delete from public.post_previews where id in (
      select p.id from public.post_previews p where p.owner_id = auth.uid() and p.snapshot ->> 'workspaceId' = workspace limit 100
    );
    get diagnostics deleted = row_count;
    exit when deleted = 0;
  end loop;
  delete from public.posts where owner_id = auth.uid() and workspace_id = workspace and not public.owner_has_workspace(auth.uid(), workspace);
end;
$$;

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
  if found.role = 'admin' and found.user_id is not null and role = 'member' then
    update public.connect_links set revoked_at = now()
    where owner_id = found.owner_id and workspace_id = found.workspace_id and revoked_at is null;
  end if;
  update public.workspace_members set role = set_workspace_member_role.role where id = member;
end;
$$;

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
  if found.role = 'admin' and found.user_id is not null then
    update public.connect_links set revoked_at = now()
    where owner_id = found.owner_id and workspace_id = found.workspace_id and revoked_at is null;
  end if;
  delete from public.workspace_members where id = member;
end;
$$;

-- The workspace an admin connected this login in. Empty for the owner's own.
alter table public.social_tokens add column if not exists workspace_id text;

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
    -- One already here stays. A new one's login, if there is one yet, has to be from this workspace.
    and (
      exists (
        select 1 from jsonb_array_elements(coalesce(current -> 'slices' -> workspace -> 'connections', '[]'::jsonb)) o
        where o ->> 'id' = c.value ->> 'id'
      )
      or not exists (
        select 1 from public.social_tokens t
        where t.user_id = owner and t.connection_id = c.value ->> 'id' and t.workspace_id is distinct from workspace
      )
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
