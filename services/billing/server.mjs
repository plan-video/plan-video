import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { fail, handleBilling, json } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8799;

function loadEnv(path) {
  const env = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const dir = process.env.PLAN_VIDEO_ENV_DIR || "/etc/plan-video";
const shared = loadEnv(`${dir}/r2.env`);
const own = loadEnv(process.env.BILLING_ENV || `${dir}/billing.env`);

const env = {
  stripeKey: own.STRIPE_SECRET_KEY || "",
  webhookSecret: own.STRIPE_WEBHOOK_SECRET || "",
  automaticTax: own.STRIPE_AUTOMATIC_TAX === "true",
  supabaseUrl: own.SUPABASE_URL || shared.SUPABASE_URL || "",
  supabaseAnonKey: own.SUPABASE_ANON_KEY || shared.SUPABASE_ANON_KEY || "",
  serviceKey: own.SUPABASE_SERVICE_ROLE_KEY || "",
  publicUrl: (own.PUBLIC_URL || "https://plan.video").replace(/\/$/, ""),
};

if (!env.stripeKey || !env.webhookSecret || !env.serviceKey || !env.supabaseUrl) {
  console.error("billing: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are needed");
}

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (!path.startsWith("/api/billing/")) {
    json(res, 404, { error: "Unknown billing route." });
    return;
  }
  handleBilling(req, res, path, env).catch((error) => fail(res, error));
});

server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`billing listening on ${HOST}:${PORT}`));
