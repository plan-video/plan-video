import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { handleX, json, Refused } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8797;

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
const x = loadEnv(process.env.X_ENV || "/etc/plan-video/x.env");

const env = {
  // The site its logins come back to, for the redirect addresses (handler.mjs redirectsFor).
  publicUrl: x.PUBLIC_URL || shared.PUBLIC_URL || "https://plan.video",
  clientId: x.X_CLIENT_ID || "",
  clientSecret: x.X_CLIENT_SECRET || "",
  supabaseUrl: shared.SUPABASE_URL || x.SUPABASE_URL || "",
  supabaseAnonKey: shared.SUPABASE_ANON_KEY || x.SUPABASE_ANON_KEY || "",
  requireInvite: (x.REQUIRE_INVITE || shared.REQUIRE_INVITE) !== "false",
};

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (!path.startsWith("/api/x/")) {
    json(res, 404, { error: "Unknown X route." });
    return;
  }
  handleX(req, res, path, env).catch((error) => {
    if (error instanceof Refused) json(res, error.status, { error: error.message });
    else json(res, 500, { error: "X isn't available right now." });
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`x proxy listening on ${HOST}:${PORT}`));
