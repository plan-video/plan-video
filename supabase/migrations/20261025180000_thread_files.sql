-- A thread's follow-ups can carry pictures or a video (`thread[].files`, by
-- file id, like `files` and `ownFiles`). Someone in a shared workspace must
-- not reach those of the owner's other workspaces either: they now count
-- among a workspace's foreign ids, for the storage signer, and are taken out
-- of a post a member saves, like the post's own files.

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
    select f #>> '{}'
    from events,
      jsonb_array_elements(case when jsonb_typeof(e -> 'thread') = 'array' then e -> 'thread' else '[]'::jsonb end) t,
      jsonb_array_elements(case when jsonb_typeof(t -> 'files') = 'array' then t -> 'files' else '[]'::jsonb end) f
    union all
    select m ->> 'id' from others, jsonb_array_elements(case when jsonb_typeof(slice -> 'media') = 'array' then slice -> 'media' else '[]'::jsonb end) m
    union all
    select l ->> 'id' from others, jsonb_array_elements(case when jsonb_typeof(slice -> 'library') = 'array' then slice -> 'library' else '[]'::jsonb end) l
  ) ids;
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
  if jsonb_typeof(e -> 'thread') = 'array' then
    cleaned := jsonb_set(cleaned, '{thread}', coalesce((
      select jsonb_agg(case
        when jsonb_typeof(t -> 'files') = 'array' then jsonb_set(t, '{files}', coalesce((
          select jsonb_agg(f order by m)
          from jsonb_array_elements(t -> 'files') with ordinality z(f, m)
          where not coalesce((f #>> '{}') = any(foreign_ids), false)
        ), '[]'::jsonb))
        else t
      end order by n)
      from jsonb_array_elements(e -> 'thread') with ordinality x(t, n)
    ), '[]'::jsonb));
  end if;
  return cleaned;
end;
$$;

revoke all on function public.team_foreign_ids_in(jsonb, text) from public, anon, authenticated;
revoke all on function public.team_clean_event(jsonb, text[]) from public, anon, authenticated;
