-- The site no longer has a newsletter form, but subscribe_newsletter was still
-- open to anyone through the API. Anyone could put any address on the list,
-- and put back people who had unsubscribed. Nothing in the app calls it now,
-- so only the database owner (the SQL editor) can. Apply once in the SQL
-- editor. The list itself stays as it is.

revoke execute on function public.subscribe_newsletter(text, text) from public, anon, authenticated;
