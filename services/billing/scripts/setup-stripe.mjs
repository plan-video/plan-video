// Makes plan.video's products, prices, billing portal and webhook in a Stripe
// account, or brings them up to date. Safe to run again: everything is found
// by lookup key, metadata or URL first. Run it once in test mode and once live.
//
//   STRIPE_SECRET_KEY=sk_... PUBLIC_URL=https://plan.video node scripts/setup-stripe.mjs
//
// It prints STRIPE_WEBHOOK_SECRET the first time it makes the webhook; put
// that in /etc/plan-video/billing.env. Pass --no-webhook for local testing
// with `stripe listen --forward-to localhost:5173/api/billing/webhook`.

import { BILLINGS, LEVELS, accountsKey, form, lookupKey } from "../handler.mjs";

const key = process.env.STRIPE_SECRET_KEY;
const publicUrl = (process.env.PUBLIC_URL || "https://plan.video").replace(/\/$/, "");
const makeWebhook = !process.argv.includes("--no-webhook");
if (!key) {
  console.error("Set STRIPE_SECRET_KEY.");
  process.exit(1);
}

/** Dollars a month, as lib/plans.ts sells them; yearly is billed as 12 of its month. */
const PRICES = {
  creator: { name: "Creator", monthly: 19, yearly: 15 },
  pro: { name: "Pro", monthly: 39, yearly: 31 },
  agency: { name: "Agency", monthly: 79, yearly: 63 },
};
/** Each social account past Agency's 100: a dollar a month, billed monthly or yearly alike. */
const ACCOUNT_PRICE = 1;

const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
];

async function stripe(method, path, params = {}) {
  const body = form(params).toString();
  const response = await fetch(`https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${payload?.error?.message}`);
  return payload;
}

const mode = key.startsWith("sk_live") || key.startsWith("rk_live") ? "LIVE" : "test";
console.log(`Setting up Stripe (${mode} mode) for ${publicUrl}`);

const products = (await stripe("GET", "/products", { limit: 100, active: true })).data;
const existingPrices = new Map(
  (
    await stripe("GET", "/prices", {
      active: true,
      limit: 100,
      lookup_keys: [...Object.keys(LEVELS).flatMap((plan) => BILLINGS.map((b) => lookupKey(plan, b))), ...BILLINGS.map(accountsKey)],
    })
  ).data.map((price) => [price.lookup_key, price]),
);

const portalProducts = [];
for (const plan of Object.keys(LEVELS)) {
  const spec = PRICES[plan];
  let product = products.find((item) => item.metadata?.app === "planvideo" && item.metadata?.plan === plan);
  if (!product) {
    product = await stripe("POST", "/products", { name: `plan.video ${spec.name}`, metadata: { app: "planvideo", plan } });
    console.log(`  made product ${product.id} (${spec.name})`);
  }

  const ids = [];
  for (const billing of BILLINGS) {
    const lookup = lookupKey(plan, billing);
    const cents = billing === "yearly" ? spec.yearly * 12 * 100 : spec.monthly * 100;
    const interval = billing === "yearly" ? "year" : "month";
    let price = existingPrices.get(lookup);
    const fits =
      price &&
      price.product === product.id &&
      price.unit_amount === cents &&
      price.currency === "usd" &&
      price.recurring?.interval === interval &&
      price.tax_behavior === "inclusive";
    if (!fits) {
      // Prices can't change, so a new one takes the lookup key over; subscribers keep the old price.
      const old = price;
      price = await stripe("POST", "/prices", {
        product: product.id,
        currency: "usd",
        unit_amount: cents,
        recurring: { interval },
        lookup_key: lookup,
        transfer_lookup_key: true,
        // What the plan costs is what's paid, tax included: Stripe takes VAT and sales tax out of it.
        tax_behavior: "inclusive",
        metadata: { app: "planvideo", plan, billing },
      });
      // The old price loses its lookup key, so its metadata tells the billing service which plan it is.
      if (old) {
        // Stripe won't archive a product's default price, so the new one becomes the default first.
        if (product.default_price === old.id) product = await stripe("POST", `/products/${product.id}`, { default_price: price.id });
        await stripe("POST", `/prices/${old.id}`, { active: false, metadata: { app: "planvideo", plan, billing } });
      }
      console.log(`  made price ${price.id} ${lookup} $${cents / 100}/${interval}`);
    } else console.log(`  price ${lookup} is up to date`);
    ids.push(price.id);
  }
  portalProducts.push({ product: product.id, prices: ids });
}

// Extra social accounts: a product of their own, added to an Agency subscription as a second line.
{
  let product = products.find((item) => item.metadata?.app === "planvideo" && item.metadata?.addon === "accounts");
  if (!product) {
    product = await stripe("POST", "/products", {
      name: "plan.video extra social account",
      description: "One more social account on Agency, past the 100 it includes.",
      metadata: { app: "planvideo", addon: "accounts" },
    });
    console.log(`  made product ${product.id} (extra social account)`);
  }
  for (const billing of BILLINGS) {
    const lookup = accountsKey(billing);
    const cents = ACCOUNT_PRICE * 100 * (billing === "yearly" ? 12 : 1);
    const interval = billing === "yearly" ? "year" : "month";
    let price = existingPrices.get(lookup);
    const fits =
      price &&
      price.product === product.id &&
      price.unit_amount === cents &&
      price.currency === "usd" &&
      price.recurring?.interval === interval &&
      price.tax_behavior === "inclusive";
    if (fits) {
      console.log(`  price ${lookup} is up to date`);
      continue;
    }
    const old = price;
    price = await stripe("POST", "/prices", {
      product: product.id,
      currency: "usd",
      unit_amount: cents,
      recurring: { interval },
      lookup_key: lookup,
      transfer_lookup_key: true,
      tax_behavior: "inclusive",
      metadata: { app: "planvideo", addon: "accounts", billing },
    });
    if (old) {
      if (product.default_price === old.id) product = await stripe("POST", `/products/${product.id}`, { default_price: price.id });
      await stripe("POST", `/prices/${old.id}`, { active: false, metadata: { app: "planvideo", addon: "accounts", billing } });
    }
    console.log(`  made price ${price.id} ${lookup} $${cents / 100}/${interval}`);
  }
}

const portal = {
  business_profile: { privacy_policy_url: `${publicUrl}/privacy`, terms_of_service_url: `${publicUrl}/terms` },
  default_return_url: `${publicUrl}/dashboard?dashboard=billing`,
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
    },
    // Upgrades are charged straight away. Downgrades never come through here: the
    // billing service sets them for the renewal with a subscription schedule.
    subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "always_invoice", products: portalProducts },
  },
  metadata: { app: "planvideo" },
};
const configs = (await stripe("GET", "/billing_portal/configurations", { active: true, limit: 100 })).data;
const config = configs.find((item) => item.metadata?.app === "planvideo");
if (config) {
  await stripe("POST", `/billing_portal/configurations/${config.id}`, portal);
  console.log(`  updated billing portal ${config.id}`);
} else {
  const made = await stripe("POST", "/billing_portal/configurations", portal);
  console.log(`  made billing portal ${made.id}`);
}

if (makeWebhook) {
  const url = `${publicUrl}/api/billing/webhook`;
  const hooks = (await stripe("GET", "/webhook_endpoints", { limit: 100 })).data;
  const hook = hooks.find((item) => item.url === url);
  if (hook) {
    await stripe("POST", `/webhook_endpoints/${hook.id}`, { enabled_events: EVENTS, disabled: false });
    console.log(`  updated webhook ${hook.id}; its signing secret is in the Stripe dashboard (Developers > Webhooks).`);
  } else {
    const made = await stripe("POST", "/webhook_endpoints", { url, enabled_events: EVENTS, description: "plan.video billing" });
    console.log(`  made webhook ${made.id}\n\nSTRIPE_WEBHOOK_SECRET=${made.secret}`);
  }
}
console.log("Done.");
