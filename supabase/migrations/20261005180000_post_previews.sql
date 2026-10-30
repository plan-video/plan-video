-- Shared post previews and the comments left on them. A post's owner shares a
-- link; anyone with it can read the post and comment under a name, without an
-- account. Apply once in the SQL editor, like the earlier migrations.
--
-- The link is the preview's id, a random uuid. Visitors never touch the tables:
-- they go through the functions at the end, which take that id.

create table public.post_previews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The post's id in the owner's calendar, which is also its video's key in cloud storage.
  post_id text not null check (post_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- The post as the owner's app last saw it: caption, platforms, time, media kind.
  snapshot jsonb not null check (pg_column_size(snapshot) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, post_id)
);

create table public.post_preview_comments (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references public.post_previews (id) on delete cascade,
  parent_id uuid references public.post_preview_comments (id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  -- Set when the commenter was signed in, so the owner's replies show as theirs.
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index post_preview_comments_preview on public.post_preview_comments (preview_id, created_at);

alter table public.post_previews enable row level security;
alter table public.post_preview_comments enable row level security;

grant select, insert, update, delete on table public.post_previews to authenticated;
grant select, update, delete on table public.post_preview_comments to authenticated;

create policy "Owners manage their previews"
  on public.post_previews
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners read comments on their previews"
  on public.post_preview_comments
  for select
  to authenticated
  using (exists (select 1 from public.post_previews p where p.id = preview_id and p.owner_id = (select auth.uid())));

-- Resolving and reopening a thread.
create policy "Owners update comments on their previews"
  on public.post_preview_comments
  for update
  to authenticated
  using (exists (select 1 from public.post_previews p where p.id = preview_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.post_previews p where p.id = preview_id and p.owner_id = (select auth.uid())));

create policy "Owners delete comments on their previews"
  on public.post_preview_comments
  for delete
  to authenticated
  using (exists (select 1 from public.post_previews p where p.id = preview_id and p.owner_id = (select auth.uid())));

-- The preview and its comments, for whoever has the link. Null when the link
-- was never made or the owner stopped sharing.
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
    'isOwner', p.owner_id = auth.uid(),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'parentId', c.parent_id,
        'name', c.author_name,
        'byOwner', c.author_id is not null and c.author_id = p.owner_id,
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

revoke all on function public.get_post_preview(uuid) from public;
grant execute on function public.get_post_preview(uuid) to anon, authenticated;

-- Adds a comment, or a reply when `parent` is given. Kept to 30 comments per
-- preview in 10 minutes and 500 in all, so a leaked link can't be flooded.
create or replace function public.add_post_preview_comment(preview uuid, name text, body text, parent uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := left(btrim(coalesce(name, '')), 80);
  clean_body text := btrim(coalesce(body, ''));
  made uuid;
begin
  if not exists (select 1 from public.post_previews where id = preview) then
    raise exception 'This preview is no longer shared.' using errcode = 'P0002';
  end if;
  if clean_name = '' then
    raise exception 'Add your name.' using errcode = '22023';
  end if;
  if clean_body = '' or char_length(clean_body) > 2000 then
    raise exception 'Comments can be up to 2,000 characters.' using errcode = '22023';
  end if;
  if parent is not null and not exists (
    select 1 from public.post_preview_comments where id = parent and preview_id = preview and parent_id is null
  ) then
    raise exception 'That comment is gone.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.post_preview_comments where preview_id = preview and created_at > now() - interval '10 minutes') >= 30
    or (select count(*) from public.post_preview_comments where preview_id = preview) >= 500 then
    raise exception 'Too many comments on this preview. Try again later.' using errcode = '54000';
  end if;

  insert into public.post_preview_comments (preview_id, parent_id, author_name, author_id, body)
  values (preview, parent, clean_name, auth.uid(), clean_body)
  returning id into made;
  return made;
end;
$$;

revoke all on function public.add_post_preview_comment(uuid, text, text, uuid) from public;
grant execute on function public.add_post_preview_comment(uuid, text, text, uuid) to anon, authenticated;

-- Where the shared post's video is kept, for the storage signer, which hands
-- out a short read link for it. Null when the preview isn't shared.
create or replace function public.post_preview_media(preview uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ownerId', owner_id, 'postId', post_id)
  from public.post_previews
  where id = preview and snapshot ->> 'media' is not null;
$$;

revoke all on function public.post_preview_media(uuid) from public;
grant execute on function public.post_preview_media(uuid) to anon, authenticated;
