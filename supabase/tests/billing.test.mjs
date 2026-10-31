// Run as helpers.mjs says.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";

import { ANON, makeUser, refuses, rpc, sql } from "./helpers.mjs";

const KEY = randomBytes(32).toString("base64url");
const hashOf = (key) => createHash("sha256").update(key).digest("hex");
const store = (hex) =>
  sql(`insert into private.service_keys (name, hash) values ('billing', decode('${hex}', 'hex')) on conflict (name) do update set hash = excluded.hash;`);

// A stack's own billing key is put back after.
let kept = "";
before(() => {
  kept = sql("select encode(hash, 'hex') from private.service_keys where name = 'billing';");
  store(hashOf(KEY));
});
after(() => (kept ? store(kept) : sql("delete from private.service_keys where name = 'billing';")));

const billing = (name, args, token = ANON) => rpc(token, name, { key: KEY, ...args });
const planOf = (id) => sql(`select coalesce(stripe_customer_id, '-') || ' ' || access_level || ' ' || extra_accounts from public.user_data where id = '${id}';`);

test("billing's key links a customer once and sets the plan", async () => {
  const person = await makeUser("billing");
  assert.deepEqual(await billing("billing_user", { person: person.id }), [{ stripe_customer_id: null, access_level: 1 }]);

  assert.equal(await billing("billing_link_customer", { person: person.id, previous: null, customer: "cus_first" }), true);
  assert.equal(await billing("billing_link_customer", { person: person.id, previous: null, customer: "cus_second" }), false);

  assert.equal(await billing("billing_set_plan", { customer: "cus_first", level: 3, extras: 0 }), true);
  assert.equal(await billing("billing_set_plan", { customer: "cus_nobody", level: 4, extras: 0 }), false);
  assert.equal(planOf(person.id), "cus_first 3 0");

  assert.equal(await billing("billing_set_plan", { customer: "cus_agency", level: 4, extras: 25, person: person.id }), true);
  assert.deepEqual(await billing("billing_user", { person: person.id }), [{ stripe_customer_id: "cus_agency", access_level: 4 }]);
  assert.equal(planOf(person.id), "cus_agency 4 25");
});

test("without billing's key, or signed in as a person, nothing is read or changed", async () => {
  const person = await makeUser("billing-refused");
  const calls = [
    ["billing_user", { person: person.id }],
    ["billing_link_customer", { person: person.id, previous: null, customer: "cus_thief" }],
    ["billing_set_plan", { customer: "cus_thief", level: 4, extras: 900, person: person.id }],
  ];
  for (const [name, args] of calls) {
    await refuses(rpc(ANON, name, { ...args, key: "wrong" }), "42501");
    await refuses(rpc(ANON, name, { ...args, key: null }), "42501");
    await refuses(billing(name, args, person.token), "42501");
  }
  assert.equal(planOf(person.id), "- 1 0");
});

test("a plan is a level from 1 to 4 with no fewer than 0 extra accounts", async () => {
  const person = await makeUser("billing-levels");
  await billing("billing_link_customer", { person: person.id, previous: null, customer: "cus_levels" });
  await refuses(billing("billing_set_plan", { customer: "cus_levels", level: 9, extras: 0 }), "22023");
  await refuses(billing("billing_set_plan", { customer: "cus_levels", level: 0, extras: 0 }), "22023");
  await refuses(billing("billing_set_plan", { customer: "cus_levels", level: 2, extras: -1 }), "22023");
  assert.equal(planOf(person.id), "cus_levels 1 0");
});
