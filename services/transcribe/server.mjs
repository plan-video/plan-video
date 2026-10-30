import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { handleTranscribe, json, Refused } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8792;

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
const transcribe = loadEnv(process.env.TRANSCRIBE_ENV || "/etc/plan-video/transcribe.env");

const env = {
  elevenLabsKey: transcribe.ELEVENLABS_API_KEY || "",
  supabaseUrl: shared.SUPABASE_URL || transcribe.SUPABASE_URL || "",
  supabaseAnonKey: shared.SUPABASE_ANON_KEY || transcribe.SUPABASE_ANON_KEY || "",
  requireInvite: (transcribe.REQUIRE_INVITE || shared.REQUIRE_INVITE) !== "false",
  // Uploads wait here while ElevenLabs works. Not /tmp: on the server that's
  // held in memory, and counts against the service's MemoryMax.
  tmpDir: "/var/tmp",
};

if (!env.elevenLabsKey) console.warn("transcribe: ELEVENLABS_API_KEY is missing from /etc/plan-video/transcribe.env");

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (path !== "/api/transcribe") {
    json(res, 404, { error: "Unknown transcription route." });
    return;
  }
  handleTranscribe(req, res, env).catch((error) => {
    if (error instanceof Refused) json(res, error.status, { error: error.message });
    else {
      console.error("transcribe:", error);
      json(res, 500, { error: "Captions aren't available right now." });
    }
  });
});

// Long recordings take ElevenLabs a few minutes.
server.requestTimeout = 360_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`transcribe proxy listening on ${HOST}:${PORT}`));
