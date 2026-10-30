-- Client connect links
--
-- A workspace's owner or an admin makes a link and sends it to a client. The
-- client opens it without a plan.video account, signs in to their own social
-- accounts there, and each one lands in that workspace: its login sealed in
-- social_tokens under the owner, as any login is, and its row in the
-- workspace's connections in the owner's account_state, which the owner's
-- open tabs merge in like any other change (services/publisher/connect-links.mjs).
--
-- The link itself is never stored: it is the row's id with a MAC only the
-- publisher can make, so the owner can copy it again and a leaked table hands
-- out nothing. Only the publisher, with the service role, reads or writes here.

create table public.connect_links (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- What the client is shown, as the person who made the link named it then.
  workspace_name text not null default '' check (char_length(workspace_name) <= 80),
  from_name text not null default '' check (char_length(from_name) <= 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- Accounts connected through it.
  connected integer not null default 0
);

create index connect_links_workspace on public.connect_links (owner_id, workspace_id);

alter table public.connect_links enable row level security;
revoke all on table public.connect_links from public, anon, authenticated;
-- The 2026-10-29 lockdown left new tables and functions with no default grants: the publisher's are given here.
grant select, insert, update, delete on table public.connect_links to service_role;

-- Adds or updates one connection in the link's workspace, if the link is still
-- open and the workspace still there. A row with the same id (the same account
-- connected again) takes the new name, picture and login details and keeps
-- when it was first connected. The account's revision moves on, so the
-- owner's tabs, and the members' through workspace_versions, take it in.
create or replace function public.connect_link_keep(link text, connection jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.connect_links;
  current jsonb;
  list jsonb;
  cid text := connection ->> 'id';
begin
  if jsonb_typeof(connection) is distinct from 'object' or cid is null or cid !~ '^[A-Za-z0-9_-]{1,100}$' then
    return false;
  end if;
  select * into target from public.connect_links l where l.id = link and l.revoked_at is null and l.expires_at > now();
  if target.id is null then
    return false;
  end if;
  select s.payload into current from public.account_state s where s.user_id = target.owner_id for update;
  if current is null or jsonb_typeof(current -> 'slices' -> target.workspace_id) is distinct from 'object' then
    return false;
  end if;
  list := coalesce(current -> 'slices' -> target.workspace_id -> 'connections', '[]'::jsonb);
  if jsonb_typeof(list) <> 'array' then
    list := '[]'::jsonb;
  end if;
  if exists (select 1 from jsonb_array_elements(list) c where c ->> 'id' = cid) then
    select jsonb_agg(case when e.c ->> 'id' = cid then e.c || (connection - 'connectedAt') else e.c end order by e.n)
      into list
      from jsonb_array_elements(list) with ordinality as e(c, n);
  else
    list := list || jsonb_build_array(connection);
  end if;
  update public.account_state
    set payload = jsonb_set(
          jsonb_set(current, array['slices', target.workspace_id, 'connections'], list),
          '{revision}', to_jsonb(gen_random_uuid()::text)
        ),
        updated_at = now()
    where user_id = target.owner_id;
  update public.connect_links set connected = connected + 1 where id = target.id;
  return true;
end;
$$;

revoke all on function public.connect_link_keep(text, jsonb) from public, anon, authenticated;
grant execute on function public.connect_link_keep(text, jsonb) to service_role;
