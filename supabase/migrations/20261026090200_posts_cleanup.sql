-- Takes the posts out of account_state, now that they live in posts
-- (20261026090000_posts.sql, copied by 20261026090100_posts_copy.sql), and
-- caps what's left: the workspaces, their accounts and lists, and settings,
-- which don't grow with every post. This closes audit item M10 (an account
-- record of any size).
--
-- A tab of the site from before posts moved would still save them into the
-- account; the check turns that save down, so the tab says it can't save,
-- rather than keeping posts where nothing reads them.
--
-- Apply once in the SQL editor, only after the publisher and the site that
-- read posts from their own table are deployed and working: until then this
-- copy is the way back.

update public.account_state s
set payload = jsonb_set(
    s.payload,
    '{slices}',
    coalesce((
      select jsonb_object_agg(w.key, case when jsonb_typeof(w.value) = 'object' then w.value - 'events' - 'media' else w.value end)
      from jsonb_each(s.payload -> 'slices') w
    ), '{}'::jsonb)
  ) || jsonb_build_object('revision', gen_random_uuid()::text),
  updated_at = now()
where jsonb_typeof(s.payload -> 'slices') = 'object';

alter table public.account_state
  add constraint account_state_without_posts
    check (not jsonb_path_exists(payload, '$.slices.*.events') and not jsonb_path_exists(payload, '$.slices.*.media')),
  add constraint account_state_size
    check (octet_length(payload::text) <= 2000000);
