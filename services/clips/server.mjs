import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { handleScan, handleVideo, json, Refused } from "./handler.mjs";
import { StreamError } from "./hls.mjs";

const HOST = "127.0.0.1";
const PORT = 8800;

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
const clips = loadEnv(process.env.CLIPS_ENV || "/etc/plan-video/clips.env");

const env = {
  supabaseUrl: shared.SUPABASE_URL || "",
  supabaseAnonKey: shared.SUPABASE_ANON_KEY || "",
  requireInvite: shared.REQUIRE_INVITE !== "false",
  // The transcribe and agent services on this server, asked under the person's own sign-in.
  transcribeUrl: process.env.TRANSCRIBE_URL || "http://127.0.0.1:8792/api/transcribe",
  agentUrl: process.env.AGENT_URL || "http://127.0.0.1:8796/api/agent/moments",
  ffmpeg: process.env.FFMPEG || "ffmpeg",
  ffprobe: process.env.FFPROBE || "ffprobe",
  ytdlp: process.env.YTDLP || "yt-dlp",
  // A Netscape cookies file, for when YouTube asks this server to sign in.
  ytdlpCookies: clips.YTDLP_COOKIES || "",
  // Clips wait here while they're sent. Not /tmp: on the server that's held in memory.
  tmpDir: "/var/tmp",
};

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  const handle = path === "/api/clips/scan" ? handleScan : path === "/api/clips/video" ? handleVideo : null;
  if (!handle) {
    json(res, 404, { error: "Unknown clips route." });
    return;
  }
  handle(req, res, env).catch((error) => {
    if (error instanceof Refused || error instanceof StreamError) json(res, error.status, { error: error.message });
    else {
      console.error("clips:", error);
      json(res, 500, { error: "Finding clips isn't available right now." });
    }
  });
});

// A long broadcast takes a few minutes to listen to and pick from.
server.requestTimeout = 900_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`clips listening on ${HOST}:${PORT}`));
