-- Approval for posts. A post can wait for approval, be approved, or come back
-- with changes asked for. Whoever has its preview link (/p/<id>) can decide
-- without an account; in the dashboard, the workspace's owner and admins can.
--
-- The post keeps its state in data.approval: { state, by, at, via, note }.
-- A post waiting for approval is a draft, so the publisher never sends it.
-- Approving schedules it for its time, unless that time has passed: then it
-- stays an approved draft until someone gives it a new time. Every request and
-- decision is kept in the preview's comments, as their `kind`.
--
-- A workspace can also have its members' posts approved (workspace_rules):
-- then a member can't schedule a post or change a scheduled one, only ask.
--
-- Apply once in the SQL editor, before the site and publisher that use it.

-- ---------------------------------------------------------------------------
-- Requests and decisions, in the preview's comments

alter table public.post_preview_comments
  add column if not exists kind text not null default 'comment'
  check (kind in ('comment', 'requested', 'approved', 'changes'));

-- A request or an approval can come without words.
alter table public.post_preview_comments drop constraint if exists post_preview_comments_body_check;
alter table public.post_preview_comments
  add constraint post_preview_comments_body_check
  check (char_length(body) <= 2000 and (kind <> 'comment' or char_length(body) >= 1));

-- ---------------------------------------------------------------------------
-- A workspace's rules

create table if not exists public.workspace_rules (
  owner_id uuid not null references auth.users (id) on delete cascade,
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  members_need_approval boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, workspace_id)
);

alter table public.workspace_rules enable row level security;

revoke all on table public.workspace_rules from anon;
revoke insert, update, delete, truncate, references, trigger on table public.workspace_rules from authenticated;
grant select on table public.workspace_rules to authenticated;
grant select on table public.workspace_rules to service_role;

drop policy if exists "People read their workspaces' rules" on public.workspace_rules;
create policy "People read their workspaces' rules"
  on public.workspace_rules
  for select
  to authenticated
  using (public.workspace_role(owner_id, workspace_id) is not null);

create or replace function public.set_workspace_rules(owner uuid, workspace text, need_approval boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.workspace_role(owner, workspace), '') not in ('owner', 'admin') then
    raise exception 'Only the workspace''s owner and admins can change this.' using errcode = '42501';
  end if;
  if workspace is null or workspace !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'That isn''t a workspace.' using errcode = '22023';
  end if;
  insert into public.workspace_rules (owner_id, workspace_id, members_need_approval, updated_at)
  values (owner, workspace, coalesce(need_approval, false), now())
  on conflict (owner_id, workspace_id) do update
    set members_need_approval = excluded.members_need_approval, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.members_need_approval(owner uuid, workspace text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.members_need_approval from public.workspace_rules r where r.owner_id = owner and r.workspace_id = workspace
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- What a member may write

-- Named to fire before posts_before_write (triggers go in name order).
-- Members ask for approval; only the owner, admins and whoever has the link
-- decide. Where members need approval, a member can't make a post scheduled
-- or change a scheduled one, though it can still go out (marked posted) or
-- back to drafts. Writes with no signed-in person (the publisher, a visitor's
-- decision through the link) aren't a member's.
create or replace function public.posts_approval_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was jsonb := case when tg_op = 'UPDATE' then old.data end;
begin
  if new.data is null or auth.uid() is null or public.workspace_role(new.owner_id, new.workspace_id) is distinct from 'member' then
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

drop trigger if exists posts_approval_rules on public.posts;
create trigger posts_approval_rules
  before insert or update on public.posts
  for each row execute function public.posts_approval_rules();

-- ---------------------------------------------------------------------------
-- Deciding

-- Whether a post still has a time to go out at: a one-off's time is ahead, or
-- a series hasn't ended. Read in the post's zone, else its owner's, else UTC.
create or replace function public.post_time_ahead(owner uuid, data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  zone text := coalesce(nullif(data ->> 'timeZone', ''), (select s.payload ->> 'timeZone' from public.account_state s where s.user_id = owner), 'UTC');
  clock text := case when (data ->> 'allDay')::boolean is true then '00:00' else data ->> 'start' end;
begin
  if not exists (select 1 from pg_timezone_names where name = zone) then
    zone := 'UTC';
  end if;
  if nullif(data ->> 'recurrence', '') is not null then
    return coalesce(data ->> 'recurrenceEnd', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or (data ->> 'recurrenceEnd') >= to_char(now() at time zone zone, 'YYYY-MM-DD');
  end if;
  return ((data ->> 'day') || ' ' || clock)::timestamp at time zone zone > now();
exception
  when others then
    return false;
end;
$$;

-- `who` decided, `via` the link or the team. Approving a draft schedules it
-- when it still has a time to go out at; asking for changes takes a scheduled
-- post back to drafts. The same decision twice changes nothing (`same`).
create or replace function public.apply_post_review(owner uuid, post text, decision text, who text, via text, note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current public.posts;
  stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  next jsonb;
begin
  if decision is null or decision not in ('approved', 'changes') then
    raise exception 'That isn''t a decision.' using errcode = '22023';
  end if;
  select * into current from public.posts p where p.owner_id = owner and p.id = post for update;
  if not found or current.data is null then
    raise exception 'This post was deleted.' using errcode = 'P0002';
  end if;
  if current.data ->> 'status' = 'posted' then
    raise exception 'This post has already gone out.' using errcode = '22023';
  end if;
  if jsonb_typeof(current.data -> 'approval') is distinct from 'object' then
    raise exception 'This post isn''t waiting for approval.' using errcode = '22023';
  end if;
  if current.data -> 'approval' ->> 'state' = decision then
    return jsonb_build_object('state', decision, 'status', current.data ->> 'status', 'same', true);
  end if;

  next := jsonb_set(current.data, '{approval}', jsonb_strip_nulls(jsonb_build_object(
    'state', decision,
    'by', who,
    'via', via,
    'at', stamp,
    'note', nullif(note, '')
  )));
  if decision = 'approved' and current.data ->> 'status' = 'draft' and public.post_time_ahead(owner, current.data) then
    next := next || jsonb_build_object('status', 'scheduled', 'sendFrom', stamp);
  elsif decision = 'changes' and current.data ->> 'status' = 'scheduled' then
    next := next || jsonb_build_object('status', 'draft', 'sendFrom', stamp);
  end if;

  update public.posts set data = next where owner_id = owner and id = post;
  return jsonb_build_object('state', decision, 'status', next ->> 'status', 'same', false);
end;
$$;

-- Too many requests and decisions on one preview, like comments: 30 in 10 minutes, 500 in all.
create or replace function public.preview_busy(preview uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.post_preview_comments where preview_id = preview and created_at > now() - interval '10 minutes') >= 30
    or (select count(*) from public.post_preview_comments where preview_id = preview) >= 500;
$$;

-- For whoever has the link, signed in or not. A member of the post's
-- workspace can't decide, here or in the dashboard.
create or replace function public.review_post_preview(preview uuid, decision text, name text, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  shared public.post_previews;
  workspace text;
  clean_name text := left(btrim(coalesce(name, '')), 80);
  clean_note text := btrim(coalesce(note, ''));
  result jsonb;
begin
  select * into shared from public.post_previews where id = preview;
  if not found then
    raise exception 'This preview is no longer shared.' using errcode = 'P0002';
  end if;
  if clean_name = '' then
    raise exception 'Add your name.' using errcode = '22023';
  end if;
  if char_length(clean_note) > 2000 then
    raise exception 'Comments can be up to 2,000 characters.' using errcode = '22023';
  end if;
  select p.workspace_id into workspace from public.posts p where p.owner_id = shared.owner_id and p.id = shared.post_id;
  if public.workspace_role(shared.owner_id, workspace) = 'member' then
    raise exception 'Only the workspace''s owner and admins can approve posts.' using errcode = '42501';
  end if;
  if public.preview_busy(preview) then
    raise exception 'Too many comments on this preview. Try again later.' using errcode = '54000';
  end if;

  result := public.apply_post_review(shared.owner_id, shared.post_id, decision, clean_name, 'link', clean_note);
  if not (result ->> 'same')::boolean then
    insert into public.post_preview_comments (preview_id, author_name, author_id, body, kind)
    values (preview, clean_name, auth.uid(), clean_note, decision);
  end if;
  return result - 'same';
end;
$$;

-- For the workspace's owner and admins, from the dashboard. Kept in the
-- post's preview comments when it has a preview.
create or replace function public.review_post(owner uuid, post text, decision text, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace text;
  who text := coalesce(public.person_name(auth.uid()), '');
  clean_note text := btrim(coalesce(note, ''));
  preview uuid;
  result jsonb;
begin
  select p.workspace_id into workspace from public.posts p where p.owner_id = owner and p.id = post and p.deleted_at is null;
  if not found then
    raise exception 'This post was deleted.' using errcode = 'P0002';
  end if;
  if coalesce(public.workspace_role(owner, workspace), '') not in ('owner', 'admin') then
    raise exception 'Only the workspace''s owner and admins can approve posts.' using errcode = '42501';
  end if;
  if char_length(clean_note) > 2000 then
    raise exception 'Comments can be up to 2,000 characters.' using errcode = '22023';
  end if;

  result := public.apply_post_review(owner, post, decision, nullif(left(who, 80), ''), 'team', clean_note);
  select v.id into preview from public.post_previews v where v.owner_id = owner and v.post_id = post;
  if preview is not null and not (result ->> 'same')::boolean and who <> '' then
    insert into public.post_preview_comments (preview_id, author_name, author_id, body, kind)
    values (preview, left(who, 80), auth.uid(), clean_note, decision);
  end if;
  return result - 'same';
end;
$$;

-- Notes in the preview's comments that someone in the workspace asked for
-- approval. Once per request: not again while the last note is a request.
create or replace function public.note_approval_request(preview uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  shared public.post_previews;
  workspace text;
  who text := left(coalesce(public.person_name(auth.uid()), ''), 80);
begin
  select * into shared from public.post_previews where id = preview;
  if not found then
    raise exception 'This preview is no longer shared.' using errcode = 'P0002';
  end if;
  select p.workspace_id into workspace from public.posts p where p.owner_id = shared.owner_id and p.id = shared.post_id;
  if public.workspace_role(shared.owner_id, workspace) is null then
    raise exception 'You''re not in this workspace.' using errcode = '42501';
  end if;
  if who = '' or public.preview_busy(preview) then
    return;
  end if;
  if (
    select c.kind from public.post_preview_comments c
    where c.preview_id = preview and c.kind <> 'comment'
    order by c.created_at desc
    limit 1
  ) is not distinct from 'requested' then
    return;
  end if;
  insert into public.post_preview_comments (preview_id, author_name, author_id, body, kind)
  values (preview, who, auth.uid(), '', 'requested');
end;
$$;

-- ---------------------------------------------------------------------------
-- The preview page

-- As in 20261014200000_team_members.sql, with each comment's kind, the post's
-- live status and approval (the snapshot can be behind), and whether this
-- visitor may decide.
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
    'status', live.data ->> 'status',
    'approval', live.data -> 'approval',
    'canReview', coalesce(public.workspace_role(p.owner_id, live.workspace_id), '') <> 'member',
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
        'kind', c.kind,
        'resolvedAt', c.resolved_at,
        'createdAt', c.created_at
      ) order by c.created_at)
      from public.post_preview_comments c
      where c.preview_id = p.id
    ), '[]'::jsonb)
  )
  from public.post_previews p
  left join public.posts live on live.owner_id = p.owner_id and live.id = p.post_id and live.deleted_at is null
  where p.id = preview;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what

revoke all on function public.members_need_approval(uuid, text) from public, anon, authenticated;
revoke all on function public.posts_approval_rules() from public, anon, authenticated;
revoke all on function public.post_time_ahead(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_post_review(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.preview_busy(uuid) from public, anon, authenticated;
revoke all on function public.set_workspace_rules(uuid, text, boolean) from public, anon;
revoke all on function public.review_post(uuid, text, text, text) from public, anon;
revoke all on function public.note_approval_request(uuid) from public, anon;
revoke all on function public.review_post_preview(uuid, text, text, text) from public;

grant execute on function public.members_need_approval(uuid, text) to service_role;
grant execute on function public.set_workspace_rules(uuid, text, boolean) to authenticated;
grant execute on function public.review_post(uuid, text, text, text) to authenticated;
grant execute on function public.note_approval_request(uuid) to authenticated;
grant execute on function public.review_post_preview(uuid, text, text, text) to anon, authenticated;
grant execute on function public.get_post_preview(uuid) to anon, authenticated;
