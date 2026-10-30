import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { handleTikTok, json, Refused } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8789;

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
const tiktok = loadEnv(process.env.TIKTOK_ENV || "/etc/plan-video/tiktok.env");

const env = {
  // The site its logins come back to, for the redirect addresses (handler.mjs redirectsFor).
  publicUrl: tiktok.PUBLIC_URL || shared.PUBLIC_URL || "https://plan.video",
  clientKey: tiktok.TIKTOK_CLIENT_KEY || "",
  clientSecret: tiktok.TIKTOK_CLIENT_SECRET || "",
  supabaseUrl: shared.SUPABASE_URL || tiktok.SUPABASE_URL || "",
  supabaseAnonKey: shared.SUPABASE_ANON_KEY || tiktok.SUPABASE_ANON_KEY || "",
  requireInvite: (tiktok.REQUIRE_INVITE || shared.REQUIRE_INVITE) !== "false",
  // Turn on once video.list is on the TikTok app; asking for a scope it lacks stops the login.
  readVideos: tiktok.TIKTOK_READ_VIDEOS === "true",
};

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (!path.startsWith("/api/tiktok")) {
    json(res, 404, { error: "Unknown TikTok route." });
    return;
  }
  handleTikTok(req, res, path, env).catch((error) => {
    if (error instanceof Refused) json(res, error.status, { error: error.message });
    else json(res, 500, { error: "TikTok isn't available right now." });
  });
});

server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`tiktok proxy listening on ${HOST}:${PORT}`));
