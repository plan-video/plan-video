// Paying for plans, through Stripe. Checkout starts a subscription, Stripe's
// billing portal changes or ends it, and every change Stripe tells us about
// is written onto user_data.access_level: 1 Free, 2 Creator, 3 Pro, 4 Agency,
// which storage, X and the app read. The plan is always worked out afresh
// from the customer's subscriptions in Stripe, so webhooks that arrive late,
// twice or out of order still leave the right plan.
//
// Prices are found by lookup key (planvideo_<plan>_<billing>), which
// scripts/setup-stripe.mjs gives them, so no price ids live in config.
//
// Agency includes 100 social accounts; more are a second line on the same
// subscription (planvideo_accounts_<billing>, $1 a month each), and how many
// is written onto user_data.extra_accounts, which the publisher counts against.

import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_URL = "https://api.stripe.com/v1";
/** The paid plans and the access level each gives. */
export const LEVELS = { creator: 2, pro: 3, agency: 4 };
export const BILLINGS = ["monthly", "yearly"];
/** Subscriptions that keep their plan. past_due keeps it while Stripe retries the card. */
const LIVE = new Set(["active", "trialing", "past_due"]);
const JSON_MAX = 16 * 1024;
const WEBHOOK_MAX = 1024 * 1024;
const SIGNATURE_TOLERANCE = 5 * 60;

export const lookupKey = (plan, billing) => `planvideo_${plan}_${billing}`;
/** The price of one social account past the ones a plan includes, billed with the plan. */
export const accountsKey = (billing) => `planvideo_accounts_${billing}`;
/** The plan that sells more social accounts, how many it includes, and the most it goes to. */
export const ACCOUNTS_PLAN = "agency";
export const INCLUDED_ACCOUNTS = 100;
export const MAX_ACCOUNTS = 1000;

/** Extra accounts for a total asked for, or undefined when it isn't a number. */
export function extrasFor(total) {
  if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
  return Math.max(0, Math.min(MAX_ACCOUNTS, Math.trunc(total)) - INCLUDED_ACCOUNTS);
}

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class StripeError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `Stripe answered ${status}`);
    this.status = status;
    this.code = payload?.error?.code;
  }
}

export function json(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

const WINDOWS = new Map();

function limit(name, max, seconds) {
  const now = Date.now();
  const entry = WINDOWS.get(name);
  if (!entry || entry.reset <= now) {
    if (WINDOWS.size > 10_000) WINDOWS.clear();
    WINDOWS.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, "Too many billing requests. Wait a minute and try again.");
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Refused(413, "That request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, JSON_MAX);
  if (!raw.length) return {};
  try {
    const body = JSON.parse(raw.toString("utf8"));
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new Refused(400, "That request isn't valid JSON.");
  }
}

/** Stripe's form encoding: nested objects as a[b], arrays as a[0]. */
export function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") form(item, `${name}[${index}]`, out);
        else out.append(`${name}[${index}]`, String(item));
      });
    } else if (typeof value === "object") form(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripe(env, method, path, params = {}) {
  const body = form(params).toString();
  let response;
  try {
    response = await fetch(method === "GET" && body ? `${STRIPE_URL}${path}?${body}` : `${STRIPE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.stripeKey}`,
        ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: method === "GET" ? undefined : body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Refused(502, "Stripe didn't answer. Try again in a moment.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`billing: Stripe ${method} ${path} answered ${response.status}: ${payload?.error?.message ?? ""}`);
    throw new StripeError(response.status, payload);
  }
  return payload;
}

/** PostgREST with the service role: user_data can only be written from here. */
async function db(env, method, path, body, prefer = "") {
  let response;
  try {
    response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: ["return=representation", prefer].filter(Boolean).join(","),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Refused(502, "The database didn't answer. Try again in a moment.");
  }
  const text = await response.text();
  if (!response.ok) {
    console.error(`billing: database ${method} ${path.split("?")[0]} answered ${response.status}: ${text.slice(0, 300)}`);
    throw new Refused(502, "The database didn't answer. Try again in a moment.");
  }
  return text ? JSON.parse(text) : [];
}

/**
 * Whether a token was granted to an outside app (Claude's connector, say)
 * instead of signed in here. Those carry the OAuth client's `client_id` and
 * are only good at /mcp. One that can't be read isn't a token Supabase made,
 * and Supabase turns it away.
 */
function grantedToApp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.client_id != null;
  } catch {
    return false;
  }
}

const SESSIONS = new Map();

/** The signed-in person: their id and email. */
async function userFor(req, env) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to manage your plan.");

  const cached = SESSIONS.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  let res;
  try {
    res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Refused(502, "Sign-in couldn't be checked. Try again in a moment.");
  }
  const user = res.ok ? await res.json().catch(() => null) : null;
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to manage your plan.");

  if (SESSIONS.size > 5000) SESSIONS.clear();
  const found = { id: user.id, email: typeof user.email === "string" ? user.email : "" };
  SESSIONS.set(token, { user: found, until: Date.now() + 60_000 });
  return found;
}

async function rowOf(env, userId) {
  const rows = await db(env, "GET", `user_data?select=stripe_customer_id,access_level&id=eq.${encodeURIComponent(userId)}`);
  return rows[0] ?? null;
}

/** The person's Stripe customer, or undefined when they've never had one (or it's gone from Stripe). */
async function existingCustomer(env, userId) {
  return liveCustomer(env, (await rowOf(env, userId))?.stripe_customer_id);
}

/** The customer id, unless it's empty or gone from Stripe. */
async function liveCustomer(env, id) {
  if (!id) return undefined;
  try {
    const customer = await stripe(env, "GET", `/customers/${encodeURIComponent(id)}`);
    return customer.deleted ? undefined : id;
  } catch (error) {
    // Made in test mode, or deleted in the dashboard: start over with a new one.
    if (error instanceof StripeError && error.status === 404) return undefined;
    throw error;
  }
}

async function customerFor(env, user) {
  // Read once, before making a customer: the guarded write below must compare
  // against this, not against what another request may have written since.
  const row = await rowOf(env, user.id);
  const existing = await liveCustomer(env, row?.stripe_customer_id);
  if (existing) return existing;

  const customer = await stripe(env, "POST", "/customers", {
    email: user.email || undefined,
    metadata: { user_id: user.id },
  });
  // Two requests at once (two tabs, say) each make a customer; the one written first is kept.
  // A missing row is made empty first, so both go through the same guarded write.
  if (!row) await db(env, "POST", "user_data?on_conflict=id", { id: user.id }, "resolution=ignore-duplicates");
  const previous = row?.stripe_customer_id;
  const filter = previous ? `stripe_customer_id=eq.${encodeURIComponent(previous)}` : "stripe_customer_id=is.null";
  const updated = await db(env, "PATCH", `user_data?id=eq.${encodeURIComponent(user.id)}&${filter}`, { stripe_customer_id: customer.id });
  if (updated.length) return customer.id;
  await stripe(env, "DELETE", `/customers/${customer.id}`).catch(() => undefined);
  const kept = (await rowOf(env, user.id))?.stripe_customer_id;
  if (!kept) throw new Refused(409, "Try again in a moment.");
  return kept;
}

let priceCache;

/** The plans' prices in Stripe, by lookup key. */
async function prices(env) {
  if (priceCache && priceCache.until > Date.now()) return priceCache.map;
  const keys = [...Object.keys(LEVELS).flatMap((plan) => BILLINGS.map((billing) => lookupKey(plan, billing))), ...BILLINGS.map(accountsKey)];
  const list = await stripe(env, "GET", "/prices", { active: true, lookup_keys: keys, limit: 100 });
  const map = new Map(list.data.map((price) => [price.lookup_key, price]));
  priceCache = { map, until: Date.now() + 10 * 60_000 };
  return map;
}

/** Which plan and billing a price is for, from its lookup key or its metadata. */
export function planOfPrice(price) {
  const match = /^planvideo_(creator|pro|agency)_(monthly|yearly)$/.exec(price?.lookup_key ?? "");
  if (match) return { plan: match[1], billing: match[2] };
  const plan = price?.metadata?.plan ?? price?.product?.metadata?.plan;
  if (!(plan in LEVELS)) return null;
  return { plan, billing: price?.recurring?.interval === "year" ? "yearly" : "monthly" };
}

/** Whether a price is for extra social accounts rather than a plan. */
export function isAccountsPrice(price) {
  return /^planvideo_accounts_(monthly|yearly)$/.test(price?.lookup_key ?? "") || price?.metadata?.addon === "accounts";
}

/** A subscription's (or a schedule phase's) line for its plan, and for its extra accounts. */
const planItem = (items) => items?.find((item) => planOfPrice(item.price));
const accountsItem = (items) => items?.find((item) => isAccountsPrice(item.price));

/** A subscription's period end in ms. Newer API versions keep it on the item. */
const periodEnd = (sub) => (sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? 0) * 1000;

/** The highest plan among the subscriptions that are still paid for, with its extra accounts, or null for Free. */
export function bestSubscription(subscriptions) {
  let best = null;
  for (const sub of subscriptions) {
    if (!LIVE.has(sub.status)) continue;
    const found = planOfPrice(planItem(sub.items?.data)?.price);
    if (!found) continue;
    const level = LEVELS[found.plan];
    const extraAccounts = found.plan === ACCOUNTS_PLAN ? accountsItem(sub.items.data)?.quantity ?? 0 : 0;
    if (!best || level > best.level) best = { sub, level, extraAccounts, ...found };
  }
  return best;
}

/**
 * Whether a switch waits for the renewal instead of being charged now: a lower
 * plan, or the same plan billed monthly instead of yearly. Everything else is
 * an upgrade, charged (with credit for the time left) straight away.
 */
export function waitsForRenewal(from, to) {
  if (LEVELS[to.plan] !== LEVELS[from.plan]) return LEVELS[to.plan] < LEVELS[from.plan];
  return from.billing === "yearly" && to.billing === "monthly";
}

const idOf = (value) => (value && typeof value === "object" ? value.id : value);

/** The switch a subscription's schedule holds for its renewal, or null. Times in ms. */
async function scheduledChange(env, sub) {
  const scheduleId = idOf(sub.schedule);
  if (!scheduleId) return null;
  const schedule = await stripe(env, "GET", `/subscription_schedules/${encodeURIComponent(scheduleId)}`, { expand: ["phases.items.price"] });
  if (schedule.status !== "active" && schedule.status !== "not_started") return null;
  const now = Date.now() / 1000;
  const next = schedule.phases?.find((phase) => phase.start_date > now);
  const found = next && planOfPrice(planItem(next.items)?.price);
  return found ? { ...found, at: next.start_date * 1000 } : null;
}

/** Drops any switch waiting on the subscription; it carries on as it is. */
async function releaseSchedule(env, sub) {
  const scheduleId = idOf(sub.schedule);
  if (scheduleId) await stripe(env, "POST", `/subscription_schedules/${encodeURIComponent(scheduleId)}/release`);
}

/**
 * Sets the subscription to move to `price` at its renewal: the current period
 * stays as it is and paid for, the next starts on the new price, nothing is
 * charged or credited now. Replaces any switch set before. `extras` carries
 * extra accounts over, on `extrasPrice`, when the next plan sells them.
 */
async function scheduleSwitch(env, sub, price, extras = 0, extrasPrice) {
  await releaseSchedule(env, sub);
  // Switching to a smaller plan means carrying on, so a pending end is dropped.
  if (sub.cancel_at || sub.cancel_at_period_end) await stripe(env, "POST", `/subscriptions/${sub.id}`, { cancel_at: "" });
  const schedule = await stripe(env, "POST", "/subscription_schedules", { from_subscription: sub.id });
  const current = schedule.phases[0];
  const updated = await stripe(env, "POST", `/subscription_schedules/${schedule.id}`, {
    end_behavior: "release",
    proration_behavior: "none",
    metadata: { app: "planvideo" },
    phases: [
      {
        // Stripe drops whatever the update leaves out, so the current phase is passed back whole.
        items: current.items.map((item) => ({ price: idOf(item.price), quantity: item.quantity ?? 1 })),
        start_date: current.start_date,
        end_date: current.end_date,
        discounts: current.discounts?.length
          ? current.discounts.map((discount) => (discount.discount ? { discount: idOf(discount.discount) } : { coupon: idOf(discount.coupon) }))
          : undefined,
        metadata: current.metadata,
      },
      {
        items: [{ price: price.id, quantity: 1 }, ...(extras > 0 && extrasPrice ? [{ price: extrasPrice.id, quantity: extras }] : [])],
        duration: { interval: price.recurring?.interval ?? "month", interval_count: 1 },
        proration_behavior: "none",
        metadata: { plan: planOfPrice(price)?.plan },
      },
    ],
  });
  return updated.phases[1].start_date * 1000;
}

async function subscriptionsOf(env, customer) {
  const list = await stripe(env, "GET", "/subscriptions", {
    customer,
    status: "all",
    limit: 20,
    expand: ["data.default_payment_method"],
  });
  return list.data;
}

/**
 * Reads the customer's subscriptions from Stripe and writes the plan they pay
 * for onto user_data. Safe to run any number of times, in any order.
 */
export async function syncCustomer(env, customer, knownUserId) {
  const best = bestSubscription(await subscriptionsOf(env, customer));
  const level = best?.level ?? 1;

  const updated = await db(env, "PATCH", `user_data?stripe_customer_id=eq.${encodeURIComponent(customer)}`, { access_level: level });
  if (updated.length) {
    await writeExtras(env, `stripe_customer_id=eq.${encodeURIComponent(customer)}`, best?.extraAccounts ?? 0);
    return level;
  }

  // Not linked yet (or linked to a since-deleted customer): find the person through the customer.
  let userId = knownUserId;
  if (!userId) {
    const found = await stripe(env, "GET", `/customers/${encodeURIComponent(customer)}`).catch(() => null);
    userId = typeof found?.metadata?.user_id === "string" ? found.metadata.user_id : undefined;
  }
  if (!userId) {
    console.error(`billing: customer ${customer} belongs to nobody on plan.video`);
    return level;
  }
  // Only a paying customer takes over the link; a lapsed one leaves the current one alone.
  if (best) {
    await db(env, "PATCH", `user_data?id=eq.${encodeURIComponent(userId)}`, { access_level: level, stripe_customer_id: customer });
    await writeExtras(env, `id=eq.${encodeURIComponent(userId)}`, best.extraAccounts);
  }
  return level;
}

/**
 * Writes the extra accounts paid for. Apart from the plan, so that before the
 * extra_accounts column exists the plan is still written.
 */
async function writeExtras(env, filter, extras) {
  await db(env, "PATCH", `user_data?${filter}`, { extra_accounts: extras }).catch(() => undefined);
}

async function liveSubscription(env, customer) {
  return bestSubscription(await subscriptionsOf(env, customer));
}

let portalCache;

/** The portal configuration setup-stripe.mjs made (plan switching on), or undefined for the account's default. */
async function portalConfiguration(env) {
  if (portalCache && portalCache.until > Date.now()) return portalCache.id;
  const list = await stripe(env, "GET", "/billing_portal/configurations", { active: true, limit: 100 });
  const id = list.data.find((config) => config.metadata?.app === "planvideo")?.id;
  portalCache = { id, until: Date.now() + 10 * 60_000 };
  return id;
}

const billingUrl = (env, extra = "") => `${env.publicUrl}/dashboard?dashboard=billing${extra}`;

function text(body, key) {
  return typeof body[key] === "string" ? body[key] : "";
}

async function portalSession(env, customer, flow) {
  const session = await stripe(env, "POST", "/billing_portal/sessions", {
    customer,
    return_url: billingUrl(env),
    configuration: await portalConfiguration(env),
    flow_data: flow,
  });
  return { url: session.url };
}

/** Card declines and the like, which Stripe words for the person paying, are passed on as they are. */
async function charging(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StripeError && error.status === 402) throw new Refused(402, error.message);
    throw error;
  }
}

async function checkout(env, user, body) {
  const plan = text(body, "plan");
  const billing = text(body, "billing");
  if (!(plan in LEVELS) || !BILLINGS.includes(billing)) throw new Refused(400, "Pick a plan to buy.");
  const all = await prices(env);
  const price = all.get(lookupKey(plan, billing));
  if (!price) throw new Refused(503, "That plan can't be bought yet.");
  // Accounts past the ones Agency includes, when it's bought: the stepper on the pricing page.
  const extras = plan === ACCOUNTS_PLAN ? extrasFor(body.accounts) ?? 0 : 0;
  const extrasPrice = all.get(accountsKey(billing));
  if (extras > 0 && !extrasPrice) throw new Refused(503, "Extra social accounts can't be bought yet.");

  const customer = await customerFor(env, user);
  const current = await liveSubscription(env, customer);
  if (current) {
    // By plan rather than price: someone on an older price of the same plan keeps it.
    if (current.plan === plan && current.billing === billing) throw new Refused(409, "You're on this plan already.");
    // Staying on Agency keeps the extra accounts; billed the other way, they're billed that way too.
    const kept = plan === ACCOUNTS_PLAN ? current.extraAccounts : 0;
    // A smaller plan waits for the renewal: what's paid for now runs out first.
    if (waitsForRenewal(current, { plan, billing })) {
      const at = await scheduleSwitch(env, current.sub, price, kept, extrasPrice);
      return { scheduled: { plan, billing, at } };
    }
    // An upgrade replaces any switch waiting.
    await releaseSchedule(env, current.sub);
    // Agency with extra accounts, to yearly: both lines move at once, since one subscription bills
    // one way. Stripe's confirm page takes one line only, so it's charged here, as the Plans tab
    // said it would be before asking.
    const extrasLine = accountsItem(current.sub.items.data);
    if (extrasLine) {
      if (!extrasPrice) throw new Refused(503, "Extra social accounts can't be bought yet.");
      await charging(() =>
        stripe(env, "POST", `/subscriptions/${current.sub.id}`, {
          items: [
            { id: planItem(current.sub.items.data).id, price: price.id },
            { id: extrasLine.id, price: extrasPrice.id },
          ],
          proration_behavior: "always_invoice",
          payment_behavior: "error_if_incomplete",
        }),
      );
      await syncCustomer(env, customer, user.id);
      return { updated: true };
    }
    // Otherwise Stripe's own page shows what the upgrade costs today and confirms it.
    return portalSession(env, customer, {
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: current.sub.id,
        items: [{ id: planItem(current.sub.items.data).id, price: price.id, quantity: 1 }],
      },
      after_completion: { type: "redirect", redirect: { return_url: billingUrl(env, "&checkout=success") } },
    });
  }

  const session = await stripe(env, "POST", "/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: price.id, quantity: 1 }, ...(extras > 0 ? [{ price: extrasPrice.id, quantity: extras }] : [])],
    success_url: billingUrl(env, "&checkout=success"),
    cancel_url: billingUrl(env),
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    automatic_tax: env.automaticTax ? { enabled: true } : undefined,
    subscription_data: { metadata: { user_id: user.id, plan } },
    metadata: { user_id: user.id },
  });
  return { url: session.url };
}

async function portal(env, user, body) {
  const customer = await existingCustomer(env, user.id);
  if (!customer) throw new Refused(404, "There's no billing to manage yet. Pick a plan first.");
  const flow = text(body, "flow");
  if (flow === "cancel") {
    const current = await liveSubscription(env, customer);
    if (!current) throw new Refused(409, "You're on Free already.");
    // Ending the plan replaces any smaller plan waiting for the renewal.
    await releaseSchedule(env, current.sub);
    return portalSession(env, customer, {
      type: "subscription_cancel",
      subscription_cancel: { subscription: current.sub.id },
      after_completion: { type: "redirect", redirect: { return_url: billingUrl(env) } },
    });
  }
  if (flow === "payment") return portalSession(env, customer, { type: "payment_method_update" });
  return portalSession(env, customer);
}

function cardOf(method) {
  const card = method && typeof method === "object" ? method.card : null;
  return card ? { brand: card.brand ?? "", last4: card.last4 ?? "", expMonth: card.exp_month, expYear: card.exp_year } : null;
}

/** The plan being paid for and the details on the invoices, for the Billing tab. */
async function account(env, user) {
  const customerId = await existingCustomer(env, user.id);
  if (!customerId) return { summary: null, info: null };
  const [customer, subscriptions] = await Promise.all([
    stripe(env, "GET", `/customers/${encodeURIComponent(customerId)}`, {
      expand: ["invoice_settings.default_payment_method", "tax_ids"],
    }),
    subscriptionsOf(env, customerId),
  ]);
  const best = bestSubscription(subscriptions);
  const items = best?.sub.items.data ?? [];
  const summary = best
    ? {
        plan: best.plan,
        billingPeriod: best.billing === "yearly" ? "year" : "month",
        // The plan and its extra accounts together: what each bill is.
        amount: items.reduce((sum, item) => sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1), 0),
        currency: planItem(items).price.currency,
        extraAccounts: best.extraAccounts,
        currentPeriodEnd: periodEnd(best.sub),
        cancelAtPeriodEnd: !!(best.sub.cancel_at_period_end || best.sub.cancel_at),
        status: best.sub.status,
        scheduled: await scheduledChange(env, best.sub),
      }
    : null;

  const address = customer.address;
  const info = {
    email: customer.email ?? "",
    address: address
      ? {
          legalName: customer.name ?? "",
          line1: address.line1 ?? "",
          line2: address.line2 ?? "",
          city: address.city ?? "",
          state: address.state ?? "",
          postalCode: address.postal_code ?? "",
          country: address.country ?? "",
        }
      : null,
    taxId: customer.tax_ids?.data?.[0]?.value ?? null,
    paymentMethod: cardOf(best?.sub.default_payment_method) ?? cardOf(customer.invoice_settings?.default_payment_method),
    billingPeriod: summary?.billingPeriod ?? null,
  };
  return { summary, info };
}

async function invoices(env, user) {
  const customer = await existingCustomer(env, user.id);
  if (!customer) return [];
  const list = await stripe(env, "GET", "/invoices", { customer, limit: 50 });
  return list.data
    .filter((invoice) => invoice.status !== "void" && invoice.status !== "draft")
    .map((invoice) => ({
      id: invoice.number || invoice.id,
      status: invoice.status,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: (invoice.due_date ?? invoice.status_transitions?.paid_at ?? invoice.created) * 1000,
      hostedUrl: invoice.hosted_invoice_url ?? null,
    }));
}

/**
 * Sets how many social accounts an Agency plan has, 100 included. More are
 * charged now for the rest of the period; fewer are credited on the next bill.
 */
async function setAccounts(env, user, body) {
  const extras = extrasFor(body.accounts);
  if (extras === undefined) throw new Refused(400, "Say how many social accounts you need.");
  const customer = await existingCustomer(env, user.id);
  const current = customer ? await liveSubscription(env, customer) : null;
  if (current?.plan !== ACCOUNTS_PLAN) throw new Refused(409, "More social accounts come with Agency. Move up to Agency first.");
  // A schedule would put the old count back at the renewal.
  if (idOf(current.sub.schedule)) throw new Refused(409, "Your plan changes at the renewal. Keep your plan to change your accounts.");

  const line = accountsItem(current.sub.items.data);
  const had = line?.quantity ?? 0;
  if (extras === had) return { extraAccounts: had };
  const more = extras > had;
  const charge = more ? { proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" } : { proration_behavior: "create_prorations" };
  await charging(async () => {
    if (!extras) await stripe(env, "DELETE", `/subscription_items/${line.id}`, { proration_behavior: "create_prorations" });
    else if (line) await stripe(env, "POST", `/subscription_items/${line.id}`, { quantity: extras, ...charge });
    else {
      const price = (await prices(env)).get(accountsKey(current.billing));
      if (!price) throw new Refused(503, "Extra social accounts can't be bought yet.");
      await stripe(env, "POST", "/subscription_items", { subscription: current.sub.id, price: price.id, quantity: extras, ...charge });
    }
  });
  await syncCustomer(env, customer, user.id);
  return { extraAccounts: extras };
}

/** Keeps the plan as it is: drops a switch waiting for the renewal, and a pending end. */
async function keep(env, user) {
  const customer = await existingCustomer(env, user.id);
  const current = customer ? await liveSubscription(env, customer) : null;
  if (!current) throw new Refused(409, "There's no plan to keep. Pick one first.");
  await releaseSchedule(env, current.sub);
  if (current.sub.cancel_at || current.sub.cancel_at_period_end) await stripe(env, "POST", `/subscriptions/${current.sub.id}`, { cancel_at: "" });
  return { kept: true };
}

/** Every page of a Stripe list. */
async function listAll(env, path, params) {
  const found = [];
  let after;
  do {
    const page = await stripe(env, "GET", path, { ...params, limit: 100, starting_after: after });
    found.push(...page.data);
    after = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (after);
  return found;
}

/**
 * Ends every subscription now, for an account being deleted (the publisher
 * calls this before it deletes one). Checkouts still open go first, so none
 * can start a plan afterwards; then every subscription that isn't over yet,
 * unpaid and paused ones too. Cancelling also stops Stripe collecting the
 * customer's open invoices, so nothing is charged later.
 */
async function endAll(env, user) {
  const customer = await existingCustomer(env, user.id);
  if (!customer) return { ended: 0 };
  for (const session of await listAll(env, "/checkout/sessions", { customer, status: "open" })) {
    // One finished meanwhile: its subscription is listed below.
    await stripe(env, "POST", `/checkout/sessions/${session.id}/expire`).catch((error) => {
      if (!(error instanceof StripeError)) throw error;
    });
  }
  // Without a status, Stripe lists every subscription not cancelled yet.
  const live = (await listAll(env, "/subscriptions", { customer })).filter((sub) => sub.status !== "canceled" && sub.status !== "incomplete_expired");
  for (const sub of live) await stripe(env, "DELETE", `/subscriptions/${sub.id}`, { prorate: false });
  await syncCustomer(env, customer, user.id);
  return { ended: live.length };
}

/** Checks a Stripe-Signature header against the raw body. */
export function verifySignature(payload, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  let timestamp = 0;
  const signatures = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || Math.abs(now - timestamp) > SIGNATURE_TOLERANCE) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex"));
  return signatures.some((signature) => {
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

async function webhook(req, res, env) {
  const raw = await readBody(req, WEBHOOK_MAX);
  if (!verifySignature(raw.toString("utf8"), req.headers["stripe-signature"], env.webhookSecret)) {
    json(res, 400, { error: "Bad signature." });
    return;
  }
  const event = JSON.parse(raw.toString("utf8"));
  const object = event?.data?.object ?? {};
  const customer = typeof object.customer === "string" ? object.customer : object.object === "customer" ? object.id : null;
  if (customer) {
    const userId = object.metadata?.user_id || object.client_reference_id || undefined;
    await syncCustomer(env, customer, typeof userId === "string" ? userId : undefined);
  }
  json(res, 200, { received: true });
}

export async function handleBilling(req, res, path, env) {
  if (!env.stripeKey || !env.supabaseUrl || !env.serviceKey) throw new Refused(503, "Payments aren't set up yet.");

  if (path === "/api/billing/webhook" && req.method === "POST") return webhook(req, res, env);

  const user = await userFor(req, env);
  limit(user.id, 30, 60);

  if (req.method === "GET" && path === "/api/billing/account") return json(res, 200, await account(env, user));
  if (req.method === "GET" && path === "/api/billing/invoices") return json(res, 200, await invoices(env, user));
  if (req.method !== "POST") throw new Refused(405, "That method isn't allowed here.");

  const body = await readJson(req);
  if (path === "/api/billing/checkout") return json(res, 200, await checkout(env, user, body));
  if (path === "/api/billing/portal") return json(res, 200, await portal(env, user, body));
  if (path === "/api/billing/keep") return json(res, 200, await keep(env, user));
  if (path === "/api/billing/accounts") return json(res, 200, await setAccounts(env, user, body));
  if (path === "/api/billing/sync") {
    const customer = await existingCustomer(env, user.id);
    const level = customer ? await syncCustomer(env, customer, user.id) : (await rowOf(env, user.id))?.access_level ?? 1;
    return json(res, 200, { level });
  }
  if (path === "/api/billing/end") return json(res, 200, await endAll(env, user));
  throw new Refused(404, "Unknown billing route.");
}

/** Turns anything thrown while handling into an answer. */
export function fail(res, error) {
  if (error instanceof Refused) json(res, error.status, { error: error.message });
  else {
    if (!(error instanceof StripeError)) console.error("billing:", error);
    json(res, error instanceof StripeError ? 502 : 500, { error: "Payments aren't available right now. Try again in a moment." });
  }
}
