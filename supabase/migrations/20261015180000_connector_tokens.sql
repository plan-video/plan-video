-- Connector tokens are for /mcp only. A token Claude (or any OAuth client)
-- was granted used to be a full sign-in: it could read and change the
-- account's tables, call its functions, and through Supabase Auth itself
-- change the password or email, link another Google account, or delete the
-- account. Anyone can register a client, so one consent click was enough.
--
-- Now:
--   connector_access_token  the Custom Access Token hook. A token issued to an
--                           OAuth client names no real user (`sub` is the nil
--                           id) and carries the person in `plan_user`, so
--                           Supabase Auth, every policy and every service
--                           finds nobody behind it.
--   connector_identity      the one thing such a token can do here: tell the
--                           connector (services/mcp) whose it is, while its
--                           session still exists.
--   refuse_app_tokens       runs before every API request and refuses any
--                           other call made with a client's token, issued
--                           before the hook or not.
--   a restrictive policy    on every table and on storage, for the doors that
--                           don't pass through the API (Realtime, Storage).
--
-- Apply once in the SQL editor, like the earlier migrations. Then deploy
-- services/mcp, and only after that turn the hook on: Authentication → Auth
-- Hooks → Customize Access Token → Postgres, public.connector_access_token.
-- (In that order: an older connector can't read the new tokens.)

-- The hook. Sign-ins of the app itself pass through untouched.
create or replace function public.connector_access_token(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
begin
  if coalesce(claims ->> 'client_id', '') = '' then
    return jsonb_build_object('claims', claims);
  end if;
  return jsonb_build_object(
    'claims',
    claims || jsonb_build_object('sub', '00000000-0000-0000-0000-000000000000', 'plan_user', event ->> 'user_id')
  );
end;
$$;

revoke all on function public.connector_access_token(jsonb) from public, anon, authenticated;
grant execute on function public.connector_access_token(jsonb) to supabase_auth_admin;

-- Whose connector token this is: the person and the client, or null once the
-- session is gone (signed out, the connector removed, the account deleted or
-- banned). Tokens from before the hook name the person in `sub`.
create or replace function public.connector_identity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('user_id', s.user_id, 'client_id', s.oauth_client_id)
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
    and s.user_id = coalesce(nullif(auth.jwt() ->> 'plan_user', ''), auth.jwt() ->> 'sub')::uuid
    and s.oauth_client_id = nullif(auth.jwt() ->> 'client_id', '')::uuid
    and (s.not_after is null or s.not_after > now())
    and (u.banned_until is null or u.banned_until <= now())
    and u.deleted_at is null;
$$;

revoke all on function public.connector_identity() from public, anon;
grant execute on function public.connector_identity() to authenticated;

-- Before every API request (tables, functions, GraphQL): a client's token
-- gets only connector_identity.
create or replace function public.refuse_app_tokens()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'client_id', '') <> ''
    and current_setting('request.path', true) is distinct from '/rpc/connector_identity' then
    raise exception 'This token is only for the plan.video connector.' using errcode = 'PT403';
  end if;
end;
$$;

grant execute on function public.refuse_app_tokens() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.refuse_app_tokens';
notify pgrst, 'reload config';

-- The same rule on every table that has row level security, and on storage.
-- A table added later is still covered by refuse_app_tokens.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists "Only plan.video''s own sign-in" on public.%I', t.relname);
    execute format(
      'create policy "Only plan.video''s own sign-in" on public.%I as restrictive for all '
      'using (coalesce((select auth.jwt() ->> ''client_id''), '''') = '''') '
      'with check (coalesce((select auth.jwt() ->> ''client_id''), '''') = '''')',
      t.relname
    );
  end loop;
end;
$$;

drop policy if exists "Only plan.video's own sign-in" on storage.objects;
create policy "Only plan.video's own sign-in"
  on storage.objects
  as restrictive
  for all
  using (coalesce((select auth.jwt() ->> 'client_id'), '') = '')
  with check (coalesce((select auth.jwt() ->> 'client_id'), '') = '');
