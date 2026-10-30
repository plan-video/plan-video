-- Copies every post out of account_state into posts (20261026090000_posts.sql),
-- once. Each post keeps everything but its thumbnail, which goes to
-- post_thumbnails, and its delivery state, which the publisher keeps in
-- post_deliveries. The file details its workspace kept beside the posts
-- (`media`) go with the post they belong to.
--
-- It checks itself: every post with a usable id and status is copied, no id
-- is used twice by one owner, and every thumbnail made it. Anything else
-- stops it and nothing is kept. account_state is left as it is, so the old
-- copy stays until 20261026090200_posts_cleanup.sql.
--
-- Apply once in the SQL editor, straight after 20261026090000_posts.sql.

do $$
declare
  found integer;
  copied integer;
  twice integer;
  skipped integer;
  pictures integer;
  kept integer;
begin
  create temporary table copying on commit drop as
  select
    s.user_id as owner_id,
    w.key as workspace_id,
    e.value ->> 'id' as id,
    e.value as event,
    case when jsonb_typeof(w.value -> 'media') = 'array' then w.value -> 'media' else '[]'::jsonb end as media
  from public.account_state s,
    jsonb_each(case when jsonb_typeof(s.payload -> 'slices') = 'object' then s.payload -> 'slices' else '{}'::jsonb end) w,
    jsonb_array_elements(case when jsonb_typeof(w.value -> 'events') = 'array' then w.value -> 'events' else '[]'::jsonb end) e;

  select count(*) into found from copying;
  select count(*) into skipped from copying
  where not (
    jsonb_typeof(event) = 'object'
    and coalesce(id, '') ~ '^[A-Za-z0-9_-]{1,100}$'
    and workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'
    and event ->> 'status' in ('draft', 'scheduled', 'posted')
  );
  delete from copying
  where not (
    jsonb_typeof(event) = 'object'
    and coalesce(id, '') ~ '^[A-Za-z0-9_-]{1,100}$'
    and workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'
    and event ->> 'status' in ('draft', 'scheduled', 'posted')
  );

  select count(*) into twice from (select 1 from copying group by owner_id, id having count(*) > 1) d;
  if twice > 0 then
    raise exception 'Not copied: % post ids are used more than once by one owner.', twice;
  end if;

  insert into public.posts (owner_id, id, workspace_id, data)
  select
    c.owner_id,
    c.id,
    c.workspace_id,
    (c.event - 'thumbnail' - 'deliveries' - 'media') || coalesce((
      select case when count(*) > 0 then jsonb_build_object('media', jsonb_agg(m order by m ->> 'id')) end
      from jsonb_array_elements(c.media) m
      where jsonb_typeof(m) = 'object' and m ->> 'id' = any(public.post_file_ids(c.id, c.event - 'media'))
    ), '{}'::jsonb)
  from copying c;
  get diagnostics copied = row_count;

  insert into public.post_thumbnails (owner_id, post_id, thumbnail)
  select c.owner_id, c.id, c.event ->> 'thumbnail'
  from copying c
  where c.event ->> 'thumbnail' like 'data:image/%' and length(c.event ->> 'thumbnail') <= 200000;
  get diagnostics kept = row_count;
  select count(*) into pictures from copying c where c.event ->> 'thumbnail' is not null;

  if copied <> found - skipped then
    raise exception 'Not copied: % posts found, % copied.', found - skipped, copied;
  end if;
  if kept <> pictures then
    raise exception 'Not copied: % thumbnails found, % kept.', pictures, kept;
  end if;
  raise notice 'Copied % posts and % thumbnails; % left behind as unusable.', copied, kept, skipped;
end;
$$;
