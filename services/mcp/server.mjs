/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Agents reach /mcp with a token from Supabase's OAuth server. The tools run here (posting.mjs) with that token:
// the database, storage and the publisher check who it speaks for. Stateless: each MCP request gets a fresh server
// and transport.

import { isIP } from "node:net";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { bearer, createAuth } from "./auth.mjs";
import { createPostingTools } from "./posting.mjs";
import { createStore } from "./store.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MCP_PORT) || 8791;
const ENV_PATH = process.env.MCP_ENV || "/etc/plan-video/mcp.env";

const MCP_PATH = "/mcp";
const METADATA_PATHS = new Set(["/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${MCP_PATH}`]);
/** What directories read when their scan stops at the sign-in. */
const SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
/** OpenAI's check that whoever lists the app in ChatGPT holds this domain. */
const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

// Any site may call /mcp from a browser: it only takes a bearer token, never a cookie.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
};
const PREFLIGHT = {
  ...CORS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

const BODY_MAX = 512 * 1024;

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv(ENV_PATH);
for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
  if (!env[key]) throw new Error(`Missing ${key} in ${ENV_PATH}`);
}
const PUBLIC_URL = (env.PUBLIC_URL || "https://plan.video").replace(/\/$/, "");
const RESOURCE = `${PUBLIC_URL}${MCP_PATH}`;
const STORAGE_URL = (env.STORAGE_URL || "http://127.0.0.1:8788").replace(/\/$/, "");
// The gateway in front of the publisher (services/gateway).
const PUBLISHER_URL = (env.PUBLISHER_URL || "http://127.0.0.1:8798").replace(/\/$/, "");
const OPENAI_CHALLENGE = (env.OPENAI_APPS_CHALLENGE || "").trim();
const METADATA_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource${MCP_PATH}`;

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
// A copy hosted elsewhere sends the agent's user to its own site.
catalog.instructions = catalog.instructions.replaceAll("https://plan.video", PUBLIC_URL);
const TOOL_NAMES = new Set(catalog.tools.map((tool) => tool.name));
const SERVER_INFO = { name: "plan-video", title: "plan.video", version };
const SERVER_CARD = JSON.stringify({
  serverInfo: SERVER_INFO,
  description: "Plan, schedule and publish posts to YouTube, TikTok, Instagram, X, LinkedIn and more.",
  websiteUrl: PUBLIC_URL,
  transport: { type: "streamable-http", url: `${PUBLIC_URL}${MCP_PATH}` },
  authentication: { required: true, schemes: ["oauth2"] },
  capabilities: { tools: {} },
  instructions: catalog.instructions,
  tools: catalog.tools,
  resources: [],
  prompts: [],
});

const auth = createAuth({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY });
const postingFor = (token) =>
  createPostingTools(createStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, storageUrl: STORAGE_URL, publisherUrl: PUBLISHER_URL, token }), { site: PUBLIC_URL });

// Rate limits live in memory: a restart only forgives a few minutes.

const windows = new Map();

function allow(name, max, seconds) {
  const now = Date.now();
  const entry = windows.get(name);
  if (!entry || entry.reset <= now) {
    windows.set(name, { count: 1, reset: now + seconds * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [name, entry] of windows) if (entry.reset <= now) windows.delete(name);
}, 60_000).unref();

/** The last X-Forwarded-For hop, the one the reverse proxy appended. IPv6 counts by its /64, which one person can fill. */
function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  let ip = (forwarded.at(-1) ?? req.socket.remoteAddress ?? "").split("%")[0];
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  if (isIP(ip) !== 6) return ip || "unknown";
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        reject(Object.assign(new Error("Request too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Per the MCP authorization spec. */
function unauthorized(res, description) {
  json(
    res,
    401,
    { error: "invalid_token", error_description: description },
    { "WWW-Authenticate": `Bearer resource_metadata="${METADATA_URL}", error="invalid_token", error_description="${description}"` },
  );
}

const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

function mcpServer(userId, token) {
  const server = new Server(
    SERVER_INFO,
    { capabilities: { tools: {} }, instructions: catalog.instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: catalog.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    if (!TOOL_NAMES.has(name)) return toolError(`Unknown tool: ${name}`);
    if (name === "get_authoring_reference") return { content: [{ type: "text", text: catalog.reference }] };
    if (!allow(`call:${userId}`, 120, 60)) return toolError("Too many calls in a minute. Wait a moment, then go on.");
    const outcome = await postingFor(token).run(name, args);
    return outcome.error ? toolError(outcome.text) : { content: [{ type: "text", text: outcome.text }] };
  });
  return server;
}

async function handleMcp(req, res) {
  if (req.method !== "POST") {
    // Stateless: no stream to resume with GET and no session to DELETE.
    json(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { Allow: "POST, OPTIONS" });
    return;
  }

  const ip = clientIp(req);
  const token = bearer(req.headers.authorization);
  if (!token) return unauthorized(res, "Sign in to plan.video to use this connector.");
  if (!allow(`auth:${ip}`, 300, 60)) return json(res, 429, { error: "Too many requests." });
  const who = await auth.connector(token);
  if (!who) return unauthorized(res, "Your plan.video sign-in has expired. Connect again.");
  if (!allow(`mcp:${who.userId}`, 600, 60)) return json(res, 429, { error: "Too many requests." });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    return json(res, error.status ?? 400, { jsonrpc: "2.0", error: { code: -32700, message: error.status ? error.message : "Parse error." }, id: null });
  }

  const server = mcpServer(who.userId, token);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];

  if (METADATA_PATHS.has(path) && req.method === "GET") {
    json(res, 200, {
      resource: RESOURCE,
      authorization_servers: [`${env.SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "plan.video",
      resource_documentation: PUBLIC_URL,
    }, { "Access-Control-Allow-Origin": "*" });
    return;
  }

  if (path === OPENAI_CHALLENGE_PATH && req.method === "GET" && OPENAI_CHALLENGE) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(OPENAI_CHALLENGE);
    return;
  }

  if (path === SERVER_CARD_PATH && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" });
    res.end(SERVER_CARD);
    return;
  }

  if (path === MCP_PATH) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, PREFLIGHT);
      res.end();
      return;
    }
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
    handleMcp(req, res).catch((error) => {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
    });
    return;
  }

  json(res, 404, { error: "Not found." });
});

server.requestTimeout = 180_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`mcp connector listening on ${HOST}:${PORT}, serving ${RESOURCE}`));
