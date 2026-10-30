-- Deleting a workspace now also stops sharing its posts: the preview links of
-- its posts stopped working only if a browser later opened that workspace,
-- which a deleted one never is again. forget_workspace_team, which the
-- dashboard calls when the owner deletes a workspace, deletes them too.
-- Previews saved before they named their workspace have no workspaceId and
-- are left alone.
--
-- Once, it also deletes the previews of workspaces deleted before this: those
-- whose workspace is no longer in the owner's account copy. Only for an owner
-- whose account copy lists their workspaces, so nothing goes for an account
-- that never synced. Apply once in the SQL editor.

create or replace function public.forget_workspace_team(workspace text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.workspace_members where owner_id = auth.uid() and workspace_id = workspace;
  delete from public.workspace_versions where owner_id = auth.uid() and workspace_id = workspace;
  delete from public.post_previews where owner_id = auth.uid() and snapshot->>'workspaceId' = workspace;
$$;

delete from public.post_previews p
using public.account_state a
where a.user_id = p.owner_id
  and jsonb_typeof(p.snapshot->'workspaceId') = 'string'
  and jsonb_typeof(a.payload->'workspaces'->'list') = 'array'
  and jsonb_array_length(a.payload->'workspaces'->'list') > 0
  and not exists (
    select 1
    from jsonb_array_elements(a.payload->'workspaces'->'list') w
    where w->>'id' = p.snapshot->>'workspaceId'
  );
