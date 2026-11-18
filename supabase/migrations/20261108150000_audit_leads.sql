-- Closes what the November audit's leads left open. Safe to run again, in any order
-- with the services.
--
-- 1. A member can share only a post that's really in their workspace.
-- 2. One account with thousands of posts due can't fill a planning pass.
-- 3. Network tokens never leave the database in a shared workspace, whatever a
--    browser wrote there.
-- 4. A profile picture is one small file per upload, and there can't be many.

create or replace function public.team_post_elsewhere(owner uuid, workspace text, post text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when public.workspace_role(owner, workspace) is null then true
    else not exists (select 1 from public.posts p where p.owner_id = owner and p.workspace_id = workspace and p.id = post and p.deleted_at is null) end;
$$;

-- Each owner's first 50 come before anyone's next 50, then soonest first.
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
  from (
    select due.*, row_number() over (partition by due.owner_id order by due.next_run_at, due.post_id) as turn
    from public.post_schedule due
    where due.next_run_at <= before
  ) s
  join public.posts p on p.owner_id = s.owner_id and p.id = s.post_id
  left join public.account_state a on a.user_id = p.owner_id
  order by (s.turn - 1) / 50, s.next_run_at, s.owner_id, s.post_id
  limit least(greatest(size, 1), 1000);
$$;

create or replace function public.slice_without_secrets(slice jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when jsonb_typeof(slice -> 'connections') <> 'array' then slice else jsonb_set(slice, '{connections}', coalesce((
    select jsonb_agg(case when jsonb_typeof(c.value) <> 'object' then c.value else (
      select jsonb_object_agg(n.key, case when jsonb_typeof(n.value) = 'object'
        then n.value - array['accessToken', 'refreshToken', 'accessJwt', 'refreshJwt', 'ticket'] else n.value end)
      from jsonb_each(c.value) n
    ) end order by c.position)
    from jsonb_array_elements(slice -> 'connections') with ordinality as c(value, position)
  ), '[]'::jsonb)) end;
$$;
revoke all on function public.slice_without_secrets(jsonb) from public, anon, authenticated;

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
  select jsonb_build_object('revision', coalesce(s.payload ->> 'revision', ''), 'slice', public.slice_without_secrets(s.payload -> 'slices' -> workspace), 'role', my_role)
  into found
  from public.account_state s
  where s.user_id = owner;
  if found is null or found -> 'slice' is null or jsonb_typeof(found -> 'slice') = 'null' then
    raise exception 'This workspace is gone.' using errcode = 'P0002';
  end if;
  return found;
end;
$$;

-- A function, as a policy can't read the table it guards. Runs as the person, who can see only their own.
create or replace function public.avatars_kept()
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*) from storage.objects o
  where o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;
revoke all on function public.avatars_kept() from public, anon;
grant execute on function public.avatars_kept() to authenticated;

drop policy if exists "A profile picture is one small file in your folder" on storage.objects;
create policy "A profile picture is one small file in your folder"
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    bucket_id <> 'avatars'
    or (name ~ ('^' || (select auth.uid())::text || '/[0-9]+\.webp$') and public.avatars_kept() < 20)
  );
