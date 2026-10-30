-- Social accounts bought past the ones Agency includes. The billing service
-- writes it from the Stripe subscription, next to access_level; the publisher
-- and the app add it to the plan's own accounts. People only read their row.
-- Apply once in the SQL editor, like the earlier migrations.

alter table public.user_data
  add column if not exists extra_accounts integer not null default 0
  check (extra_accounts >= 0);
