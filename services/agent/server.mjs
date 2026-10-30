import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { handleCaptions } from "./captions.mjs";
import { handleAgent, json, loadLimits, Refused } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8796;

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
const agent = loadEnv(process.env.AGENT_ENV || "/etc/plan-video/agent.env");

const env = {
  anthropicKey: agent.ANTHROPIC_API_KEY || "",
  supabaseUrl: shared.SUPABASE_URL || agent.SUPABASE_URL || "",
  supabaseAnonKey: shared.SUPABASE_ANON_KEY || agent.SUPABASE_ANON_KEY || "",
  requireInvite: (agent.REQUIRE_INVITE || shared.REQUIRE_INVITE) !== "false",
  // Daily spend caps in input-token equivalents; the handler's defaults when unset. A person's
  // cap goes by plan: one number is Creator's, the others its shares, or all four as
  // "Free,Creator,Pro,Agency".
  personBudget: agent.AGENT_PERSON_BUDGET || "",
  siteBudget: Number(agent.AGENT_SITE_BUDGET) || 0,
  // The share of the site's cap Free accounts can use between them, from 0 to 1.
  freeShare: agent.AGENT_FREE_SHARE ? Number(agent.AGENT_FREE_SHARE) : undefined,
  // What Free accounts on one network can spend in a day, the agent and caption tools together.
  networkBudget: Number(agent.AGENT_NETWORK_BUDGET) || 0,
  // Caption tools' daily cap per person, by plan like AGENT_PERSON_BUDGET; the handler's default when unset.
  captionsBudget: agent.CAPTIONS_PERSON_BUDGET || "",
  // Signs the model's steps. Derived from the Anthropic key when unset, so a new key ends old chats.
  signingSecret: agent.AGENT_SIGNING_SECRET || "",
};

// systemd's StateDirectory: the limits outlive a restart.
loadLimits(process.env.STATE_DIRECTORY ? join(process.env.STATE_DIRECTORY.split(":")[0], "limits.json") : null);

if (!env.anthropicKey) console.warn("agent: ANTHROPIC_API_KEY is missing from /etc/plan-video/agent.env");

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  const handle = path === "/api/agent" ? handleAgent : path === "/api/agent/captions" ? handleCaptions : null;
  if (!handle) {
    json(res, 404, { error: "Unknown agent route." });
    return;
  }
  handle(req, res, env).catch((error) => {
    if (error instanceof Refused) json(res, error.status, { error: error.message });
    else {
      console.error("agent:", error);
      json(res, 500, { error: "The Assistant isn't available right now." });
    }
  });
});

// A step that thinks, then writes a week of posts, can take a few minutes.
server.requestTimeout = 600_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`agent proxy listening on ${HOST}:${PORT}`));
