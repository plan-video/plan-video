import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { GATEWAY_PORT, createRelay } from "./relay.mjs";

const HOST = "127.0.0.1";
/** A stop gives the files being pulled this long to finish, inside systemd's 90 seconds. */
const DRAIN_MS = 30_000;

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
const secret = loadEnv(`${dir}/gateway.env`).SENDER_SECRET;
if (!secret) {
  console.error("gateway: SENDER_SECRET is needed in gateway.env, the same as in publisher.env");
  process.exit(1);
}

const relay = createRelay({ secret });
let going = 0;
let stopping = false;
const stop = () => process.exit(0);
const server = createServer((req, res) => {
  going++;
  res.once("close", () => {
    going--;
    if (stopping && !going) stop();
  });
  relay(req, res);
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(GATEWAY_PORT, HOST, () => console.log(`gateway listening on ${HOST}:${GATEWAY_PORT}`));

// Networks pull a send's files through here, so a restart lets the ones going finish, and keeps answering
// meanwhile: a port closed for the length of one long video would fail other sends' pulls for good.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    stopping = true;
    if (!going) stop();
    setTimeout(stop, DRAIN_MS).unref();
  });
}
