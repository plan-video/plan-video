-- The files each delivery carried, kept as it goes out: a post can still be edited
-- afterwards, so only these count as what went out. Empty for earlier deliveries.
-- Apply this before updating the publisher, which writes it. Safe to run again.

alter table public.post_deliveries add column if not exists files text[];
