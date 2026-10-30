-- A local Supabase, after its migrations: open to everyone, as the dev server
-- is unless VITE_INVITE_ONLY=true. Supabase runs this only locally (supabase
-- start on a new database, or supabase db reset), never on a hosted project.
update public.invite_gate set invite_only = false;
