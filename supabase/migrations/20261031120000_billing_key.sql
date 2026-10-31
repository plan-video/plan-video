-- Billing writes each person's plan through these three functions, unlocked by
-- its own key, instead of holding the secret key that can write every table.
-- A stolen billing key can change plans and Stripe links, nothing else.
--
-- Not in a migration, as the key is secret: run
--   node services/billing/scripts/db-key.mjs
-- put its BILLING_DB_KEY line in billing.env, and its SQL in the SQL editor,
-- which stores only the key's SHA-256 in private.service_keys.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.service_keys (
  name text primary key,
  hash bytea not null
);
revoke all on table private.service_keys from public, anon, authenticated;

create or replace function private.check_billing_key(key text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if key is null or not exists (
    select 1 from private.service_keys k
    where k.name = 'billing' and k.hash = sha256(convert_to(key, 'UTF8'))
  ) then
    raise exception 'Wrong billing key.' using errcode = '42501';
  end if;
end $$;

create or replace function public.billing_user(key text, person uuid)
returns table (stripe_customer_id text, access_level integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.check_billing_key(key);
  return query select u.stripe_customer_id, u.access_level from public.user_data u where u.id = person;
end $$;

-- Links a customer only over the one read before it was made (null for none),
-- so two tabs at once keep the first. True when it was linked.
create or replace function public.billing_link_customer(key text, person uuid, previous text, customer text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_billing_key(key);
  if coalesce(customer, '') = '' then
    raise exception 'A customer is needed.' using errcode = '22023';
  end if;
  insert into public.user_data (id) values (person) on conflict (id) do nothing;
  update public.user_data u set stripe_customer_id = customer
    where u.id = person and u.stripe_customer_id is not distinct from previous;
  return found;
end $$;

-- Sets the plan of whoever has this customer, or with a person, of that person,
-- linking the customer to them. True when a row changed.
create or replace function public.billing_set_plan(key text, customer text, level integer, extras integer, person uuid default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_billing_key(key);
  if coalesce(customer, '') = '' or level is null or level not between 1 and 4 or extras is null or extras < 0 then
    raise exception 'Not a plan.' using errcode = '22023';
  end if;
  if person is null then
    update public.user_data u set access_level = level, extra_accounts = extras
      where u.stripe_customer_id = customer;
  else
    update public.user_data u set access_level = level, extra_accounts = extras, stripe_customer_id = customer
      where u.id = person;
  end if;
  return found;
end $$;

revoke execute on function private.check_billing_key(text) from public, anon, authenticated;
revoke execute on function public.billing_user(text, uuid),
  public.billing_link_customer(text, uuid, text, text),
  public.billing_set_plan(text, text, integer, integer, uuid) from public, anon, authenticated;
-- Billing calls them with the publishable key; the billing key is what lets it in.
grant execute on function public.billing_user(text, uuid),
  public.billing_link_customer(text, uuid, text, text),
  public.billing_set_plan(text, text, integer, integer, uuid) to anon;
