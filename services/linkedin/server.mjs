import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { handleLinkedIn, json, Refused } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8795;

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

const shared = loadEnv("/etc/plan-video/r2.env");
const linkedin = loadEnv(process.env.LINKEDIN_ENV || "/etc/plan-video/linkedin.env");

const env = {
  // The site its logins come back to, for the redirect addresses (handler.mjs redirectsFor).
  publicUrl: linkedin.PUBLIC_URL || shared.PUBLIC_URL || "https://plan.video",
  clientId: linkedin.LINKEDIN_CLIENT_ID || "",
  clientSecret: linkedin.LINKEDIN_CLIENT_SECRET || "",
  supabaseUrl: shared.SUPABASE_URL || linkedin.SUPABASE_URL || "",
  supabaseAnonKey: shared.SUPABASE_ANON_KEY || linkedin.SUPABASE_ANON_KEY || "",
  requireInvite: (linkedin.REQUIRE_INVITE || shared.REQUIRE_INVITE) !== "false",
};

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (!path.startsWith("/api/linkedin")) {
    json(res, 404, { error: "Unknown LinkedIn route." });
    return;
  }
  handleLinkedIn(req, res, path, env).catch((error) => {
    if (error instanceof Refused) json(res, error.status, { error: error.message });
    else json(res, 500, { error: "LinkedIn isn't available right now." });
  });
});

server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`linkedin proxy listening on ${HOST}:${PORT}`));
