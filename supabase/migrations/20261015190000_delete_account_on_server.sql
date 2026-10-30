-- Deleting an account moves to the server: the publisher (services/publisher,
-- account/delete) ends the plan in Stripe, erases the files in cloud storage
-- and the profile photo, and ends access at each connected network, and only
-- then deletes the user. Called straight from a browser, this function skipped
-- all of that, so someone could delete their account and still be charged.
-- Apply once in the SQL editor, after the publisher with account/delete is
-- deployed, like the earlier migrations.

drop function if exists public.delete_my_account();
