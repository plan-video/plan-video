import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";

import { bestSubscription, form, handleBilling, planOfPrice, verifySignature } from "./handler.mjs";

const sub = (status, lookup_key, extra = {}) => ({ id: `sub_${lookup_key}_${status}`, status, items: { data: [{ price: { lookup_key } }] }, ...extra });

test("form encodes nested objects and arrays the way Stripe reads them", () => {
  const body = form({ mode: "subscription", line_items: [{ price: "p_1", quantity: 1 }], expand: ["a", "b"], skip: undefined, meta: { user_id: "u" } }).toString();
  assert.equal(decodeURIComponent(body), "mode=subscription&line_items[0][price]=p_1&line_items[0][quantity]=1&expand[0]=a&expand[1]=b&meta[user_id]=u");
});

test("planOfPrice reads the lookup key, then metadata", () => {
  assert.deepEqual(planOfPrice({ lookup_key: "planvideo_pro_yearly" }), { plan: "pro", billing: "yearly" });
  assert.deepEqual(planOfPrice({ lookup_key: "old", metadata: { plan: "agency" }, recurring: { interval: "month" } }), { plan: "agency", billing: "monthly" });
  assert.equal(planOfPrice({ lookup_key: "something_else" }), null);
});

test("bestSubscription keeps the highest plan still paid for", () => {
  assert.equal(bestSubscription([]), null);
  assert.equal(bestSubscription([sub("canceled", "planvideo_agency_monthly"), sub("incomplete", "planvideo_pro_monthly")]), null);
  const best = bestSubscription([sub("active", "planvideo_creator_yearly"), sub("past_due", "planvideo_pro_monthly"), sub("unpaid", "planvideo_agency_monthly")]);
  assert.equal(best.plan, "pro");
  assert.equal(best.level, 3);
});

test("verifySignature takes Stripe's signature and refuses others", () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  assert.equal(verifySignature(payload, `t=${t},v1=${v1}`, secret, t + 10), true);
  assert.equal(verifySignature(payload, `t=${t},v0=x,v1=${"0".repeat(64)},v1=${v1}`, secret, t), true);
  assert.equal(verifySignature(payload + " ", `t=${t},v1=${v1}`, secret, t), false);
  assert.equal(verifySignature(payload, `t=${t},v1=${v1}`, "whsec_other", t), false);
  assert.equal(verifySignature(payload, `t=${t},v1=${v1}`, secret, t + 3600), false);
  assert.equal(verifySignature(payload, undefined, secret, t), false);
});

test("waitsForRenewal holds back smaller plans and yearly to monthly", async () => {
  const { waitsForRenewal } = await import("./handler.mjs");
  assert.equal(waitsForRenewal({ plan: "pro", billing: "monthly" }, { plan: "creator", billing: "monthly" }), true);
  assert.equal(waitsForRenewal({ plan: "pro", billing: "monthly" }, { plan: "creator", billing: "yearly" }), true);
  assert.equal(waitsForRenewal({ plan: "pro", billing: "yearly" }, { plan: "pro", billing: "monthly" }), true);
  assert.equal(waitsForRenewal({ plan: "pro", billing: "monthly" }, { plan: "pro", billing: "yearly" }), false);
  assert.equal(waitsForRenewal({ plan: "creator", billing: "yearly" }, { plan: "pro", billing: "monthly" }), false);
  assert.equal(waitsForRenewal({ plan: "agency", billing: "monthly" }, { plan: "pro", billing: "yearly" }), true);
});

test("bestSubscription finds the plan whichever line comes first, and counts Agency's extra accounts", async () => {
  const { isAccountsPrice } = await import("./handler.mjs");
  const lines = (...items) => ({ id: "sub_x", status: "active", items: { data: items } });
  const extra = { price: { lookup_key: "planvideo_accounts_monthly" }, quantity: 25 };
  const agency = { price: { lookup_key: "planvideo_agency_monthly" }, quantity: 1 };
  assert.equal(isAccountsPrice(extra.price), true);
  assert.equal(isAccountsPrice({ lookup_key: "old", metadata: { addon: "accounts" } }), true);
  assert.equal(isAccountsPrice(agency.price), false);
  assert.equal(planOfPrice(extra.price), null);

  const best = bestSubscription([lines(extra, agency)]);
  assert.equal(best.plan, "agency");
  assert.equal(best.extraAccounts, 25);
  assert.equal(bestSubscription([lines(agency)]).extraAccounts, 0);
  // Only Agency sells them; a stray line elsewhere doesn't count.
  assert.equal(bestSubscription([lines(extra, { price: { lookup_key: "planvideo_pro_yearly" } })]).extraAccounts, 0);
});

test("extrasFor turns the accounts asked for into the ones past Agency's 100", async () => {
  const { extrasFor } = await import("./handler.mjs");
  assert.equal(extrasFor(100), 0);
  assert.equal(extrasFor(40), 0);
  assert.equal(extrasFor(150), 50);
  assert.equal(extrasFor(150.7), 50);
  assert.equal(extrasFor(5000), 900);
  assert.equal(extrasFor("150"), undefined);
  assert.equal(extrasFor(Number.NaN), undefined);
  assert.equal(extrasFor(undefined), undefined);
});

test("end, for a deleted account, expires open checkouts and cancels every subscription not over yet, on every page", async (t) => {
  const calls = [];
  const subscriptions = [
    [sub("active", "planvideo_pro_monthly"), sub("canceled", "planvideo_creator_monthly")],
    [sub("unpaid", "planvideo_agency_monthly"), sub("paused", "planvideo_creator_yearly"), sub("incomplete_expired", "planvideo_pro_yearly")],
  ];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? "GET";
    calls.push(`${method} ${pathname}`);
    if (pathname === "/auth/v1/user") return Response.json({ id: "user-1", email: "a@b.test" });
    if (pathname === "/rest/v1/rpc/billing_user") return Response.json([{ stripe_customer_id: "cus_1", access_level: 3 }]);
    if (pathname === "/rest/v1/rpc/billing_set_plan") return Response.json(true);
    if (pathname === "/v1/customers/cus_1") return Response.json({ id: "cus_1" });
    if (pathname === "/v1/checkout/sessions" && method === "GET") {
      assert.equal(searchParams.get("status"), "open");
      return Response.json({ data: [{ id: "cs_1" }, { id: "cs_done" }], has_more: false });
    }
    if (pathname === "/v1/checkout/sessions/cs_done/expire") return Response.json({ error: { message: "Only open sessions can be expired." } }, { status: 400 });
    if (pathname === "/v1/subscriptions" && method === "GET") {
      if (searchParams.get("status") === "all") return Response.json({ data: [], has_more: false });
      assert.equal(searchParams.get("status"), null);
      const page = searchParams.get("starting_after") ? 1 : 0;
      return Response.json({ data: subscriptions[page], has_more: page === 0 });
    }
    return Response.json({});
  });
  t.mock.method(console, "error", () => undefined);

  const req = Object.assign(Readable.from([Buffer.from("{}")]), { method: "POST", headers: { authorization: `Bearer x.${Buffer.from("{}").toString("base64url")}.y` } });
  let status = 0;
  let answer = "";
  const res = { writableEnded: false, writeHead: (code) => (status = code), end: (text) => (answer = text) };
  await handleBilling(req, res, "/api/billing/end", { stripeKey: "sk", webhookSecret: "wh", supabaseUrl: "https://db.test", supabaseAnonKey: "anon", databaseKey: "billing" });

  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(answer), { ended: 3 });
  assert.deepEqual(calls.filter((call) => call.startsWith("POST /v1/checkout") || call.startsWith("DELETE")), [
    "POST /v1/checkout/sessions/cs_1/expire",
    "POST /v1/checkout/sessions/cs_done/expire",
    "DELETE /v1/subscriptions/sub_planvideo_pro_monthly_active",
    "DELETE /v1/subscriptions/sub_planvideo_agency_monthly_unpaid",
    "DELETE /v1/subscriptions/sub_planvideo_creator_yearly_paused",
  ]);
});
