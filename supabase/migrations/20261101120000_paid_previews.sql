-- Preview links come with paid plans. Only new ones are refused, so a link someone
-- already has keeps working, and can be kept up to date, after a downgrade.
-- A team's previews are its owner's: its own rule already asks for a team plan.
drop policy if exists "New previews need a paid plan" on public.post_previews;
create policy "New previews need a paid plan"
  on public.post_previews
  as restrictive
  for insert
  to authenticated
  with check (
    owner_id <> (select auth.uid())
    or coalesce((select access_level from public.user_data where id = (select auth.uid())), 1) > 1
  );
