/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Agents reach /mcp with a token from Supabase's OAuth server; the tools run in the user's
// open plan.video tab over /api/mcp/tab. Stateless: each MCP request gets a fresh server and
// transport, so the only state is the open tabs.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocket, WebSocketServer } from "ws";

import { bearer, createAuth } from "./auth.mjs";
import { Relay, RelayError } from "./relay.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MCP_PORT) || 8791;
const ENV_PATH = process.env.MCP_ENV || "/etc/plan-video/mcp.env";

const MCP_PATH = "/mcp";
const TAB_PATH = "/api/mcp/tab";
const METADATA_PATHS = new Set(["/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${MCP_PATH}`]);

const KiB = 1024;
const MiB = 1024 * KiB;
const BODY_MAX = 512 * KiB;
/** Six 720p frames, base64, with room to spare. */
const TAB_MESSAGE_MAX = 24 * MiB;
/** All a tab may send before its hello is accepted: the hello, a sign-in token in JSON. */
const HELLO_MAX = 16 * KiB;
const MAX_UNVERIFIED = 500;
const MAX_UNVERIFIED_PER_IP = 20;
const MAX_TABS = 5000;
const MAX_IMAGES = 6;
const HELLO_MS = 10_000;
const HEARTBEAT_MS = 30_000;

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

function wwwOf(site) {
  const url = new URL(site);
  if (!url.hostname.startsWith("www.")) url.hostname = `www.${url.hostname}`;
  return url.origin;
}

const env = loadEnv(ENV_PATH);
for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
  if (!env[key]) throw new Error(`Missing ${key} in ${ENV_PATH}`);
}
const PUBLIC_URL = (env.PUBLIC_URL || "https://plan.video").replace(/\/$/, "");
const ORIGINS = new Set((env.ALLOWED_ORIGINS || [PUBLIC_URL, wwwOf(PUBLIC_URL)].join(",")).split(",").map((origin) => origin.trim()));
const RESOURCE = `${PUBLIC_URL}${MCP_PATH}`;
const METADATA_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource${MCP_PATH}`;

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
// A copy hosted elsewhere sends the agent's user to its own site.
catalog.instructions = catalog.instructions.replaceAll("https://plan.video", PUBLIC_URL);
const TOOL_NAMES = new Set(catalog.tools.map((tool) => tool.name));

const auth = createAuth({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY });
const relay = new Relay({ site: PUBLIC_URL });

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

/** The last X-Forwarded-For hop, the one the reverse proxy appended. */
function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded.at(-1) ?? req.socket.remoteAddress ?? "unknown";
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

function toContent(output) {
  const images = output.images
    .filter((image) => image && image.mediaType === "image/png" && typeof image.data === "string")
    .slice(0, MAX_IMAGES)
    .map((image) => ({ type: "image", data: image.data, mimeType: "image/png" }));
  return { content: [{ type: "text", text: output.text }, ...images] };
}

function mcpServer(userId) {
  const server = new Server(
    { name: "plan-video", title: "plan.video", version },
    { capabilities: { tools: {} }, instructions: catalog.instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: catalog.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    if (!TOOL_NAMES.has(name)) return toolError(`Unknown tool: ${name}`);
    if (name === "get_authoring_reference") return { content: [{ type: "text", text: catalog.reference }] };
    if (!allow(`call:${userId}`, 120, 60)) return toolError("Too many calls in a minute. Wait a moment, then go on.");
    try {
      return toContent(await relay.call(userId, name, args));
    } catch (error) {
      if (error instanceof RelayError) return toolError(error.message);
      throw error;
    }
  });
  return server;
}

async function handleMcp(req, res) {
  if (req.method !== "POST") {
    // Stateless: no stream to resume with GET and no session to DELETE.
    json(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { Allow: "POST" });
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

  const server = mcpServer(who.userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const tabs = new WebSocketServer({ noServer: true, maxPayload: TAB_MESSAGE_MAX });

const unverified = new Map();
let unverifiedTotal = 0;

// The first message must be `{ type: "hello", token }`; then `call` / `result` messages
// by id, and `{ type: "active" }` when the user comes back to the tab.
function onTab(ws, socket, ip) {
  let tab = null;
  let greeting = false;
  let alive = true;

  // Until its hello is accepted the socket could be anyone's: past a hello's worth of bytes it
  // is cut off before ws buffers the rest, or big frames from unsigned sockets fill the process.
  let waiting = true;
  let received = 0;
  const count = (chunk) => {
    received += chunk.length;
    if (received > HELLO_MAX) ws.terminate();
  };
  const verified = () => {
    if (!waiting) return;
    waiting = false;
    socket.off("data", count);
    unverifiedTotal -= 1;
    const left = unverified.get(ip) - 1;
    if (left > 0) unverified.set(ip, left);
    else unverified.delete(ip);
  };
  socket.on("data", count);
  unverifiedTotal += 1;
  unverified.set(ip, (unverified.get(ip) ?? 0) + 1);

  const hello = setTimeout(() => ws.close(4401, "Sign in first."), HELLO_MS);
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);
  ws.on("pong", () => {
    alive = true;
  });

  ws.on("message", async (data, isBinary) => {
    let message;
    try {
      if (isBinary) throw new Error();
      message = JSON.parse(data.toString("utf8"));
    } catch {
      ws.close(1003, "Expected JSON.");
      return;
    }

    if (!tab) {
      if (greeting || message?.type !== "hello" || typeof message.token !== "string") {
        ws.close(4401, "Sign in first.");
        return;
      }
      greeting = true;
      const who = await auth.editor(message.token).catch(() => null);
      clearTimeout(hello);
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!who) {
        ws.close(4401, "Sign in again.");
        return;
      }
      verified();
      tab = relay.attach(who.userId, { send: (text) => ws.send(text), close: (code, reason) => ws.close(code, reason) });
      ws.send(JSON.stringify({ type: "ready" }));
      return;
    }

    if (message?.type === "active") relay.touch(tab);
    else if (message?.type === "result" && typeof message.id === "string") relay.receive(tab, message);
  });

  ws.on("close", () => {
    verified();
    clearTimeout(hello);
    clearInterval(heartbeat);
    if (tab) relay.detach(tab);
  });
  ws.on("error", () => ws.terminate());
}

function refuseUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
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

  if (path === MCP_PATH) {
    handleMcp(req, res).catch((error) => {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
    });
    return;
  }

  json(res, 404, { error: "Not found." });
});

server.on("upgrade", (req, socket, head) => {
  const path = (req.url || "").split("?")[0];
  if (path !== TAB_PATH) return refuseUpgrade(socket, 404, "Not Found");
  if (!ORIGINS.has(String(req.headers.origin ?? ""))) return refuseUpgrade(socket, 403, "Forbidden");
  const ip = clientIp(req);
  if (!allow(`tab:${ip}`, 60, 60)) return refuseUpgrade(socket, 429, "Too Many Requests");
  if ((unverified.get(ip) ?? 0) >= MAX_UNVERIFIED_PER_IP) return refuseUpgrade(socket, 429, "Too Many Requests");
  if (relay.size >= MAX_TABS || unverifiedTotal >= MAX_UNVERIFIED) return refuseUpgrade(socket, 503, "Service Unavailable");
  tabs.handleUpgrade(req, socket, head, (ws) => onTab(ws, socket, ip));
});

server.requestTimeout = 180_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`mcp connector listening on ${HOST}:${PORT}, serving ${RESOURCE}`));
