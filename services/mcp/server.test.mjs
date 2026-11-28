/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const ALICE = "0b6a3d4e-6f2a-4c1e-9d4b-3c2f1e0a9b8c";

/** Only its claims matter to the stand-in. */
function token(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.sig`;
}
const CONNECTOR_TOKEN = token({ sub: ALICE, client_id: "claude" });
/** A connector on a database without the agent functions yet. */
const BEFORE_TOKEN = token({ sub: ALICE, client_id: "before" });

const CONTEXT = {
  owner: ALICE,
  workspace: "default",
  name: "Personal",
  role: "owner",
  level: 2,
  timeZone: "UTC",
  calendarId: "posts",
  membersNeedApproval: false,
  connections: [{ id: "bsky", platform: "bluesky", handle: "me.bsky.social", ready: true, scope: "", page: false }],
  library: [{ id: "pic", name: "pic.jpg", kind: "image", type: "image/jpeg", size: 10, width: 100, height: 100, duration: 0, lastModified: 1, createdAt: "2026-11-01T00:00:00Z", uses: 0 }],
};
/** What the stand-ins were asked, by route. */
const asked = [];
const POST = {
  id: "p1",
  title: "Hello",
  description: "Hello",
  day: "2099-01-01",
  start: "10:00",
  allDay: false,
  duration: 15,
  platforms: ["bluesky"],
  accounts: { bluesky: ["bsky"] },
  status: "scheduled",
  calendarId: "posts",
  createdAt: "2026-11-01T00:00:00Z",
  recurrence: null,
  recurrenceExceptions: [],
  link: null,
  timeZone: "UTC",
};
let sent = false;

function claimsOf(req) {
  const value = String(req.headers.authorization ?? "").slice(7);
  return JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8") || "null");
}

let supabase;
let child;
let dir;
let port;

function sparePort() {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

before(async () => {
  supabase = createServer(async (req, res) => {
    const claims = claimsOf(req);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/v1/user" && claims?.sub === ALICE && !claims.client_id) return res.end(JSON.stringify({ id: ALICE }));
    if (req.url === "/rest/v1/rpc/connector_identity" && claims?.client_id) return res.end(JSON.stringify({ user_id: ALICE, client_id: claims.client_id }));
    if (req.url.startsWith("/rest/v1/rpc/agent_") || req.url.startsWith("/api/storage/") || req.url.startsWith("/api/publisher/")) {
      asked.push({ url: req.url, client: claims?.client_id, body });
      if (claims?.client_id === "broken") {
        res.statusCode = 400;
        return res.end(JSON.stringify({ code: "22P02", message: 'invalid input syntax for type uuid: "x" in public.posts' }));
      }
      if (claims?.client_id === "before") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }));
      }
      if (req.url === "/rest/v1/rpc/agent_context") return res.end(JSON.stringify(CONTEXT));
      if (req.url === "/rest/v1/rpc/agent_posts") {
        const posts = body.post_id === "p1" ? [{ id: "p1", version: 1, data: POST, deliveries: sent ? { bluesky: { state: "sent" } } : {} }] : [];
        return res.end(JSON.stringify(posts));
      }
      if (req.url === "/api/publisher/send") {
        sent = true;
        return res.end(JSON.stringify({ deliveries: [{ platform: "bluesky", connection_id: "bsky", state: "queued", error: null }] }));
      }
      if (req.url === "/rest/v1/rpc/agent_save_post") return res.end(JSON.stringify({ version: 1 }));
      if (req.url === "/api/storage/agent-copy") return res.end(JSON.stringify({ copied: body.copies.length }));
    }
    res.statusCode = 401;
    res.end("{}");
  });
  await new Promise((resolve) => supabase.listen(0, "127.0.0.1", resolve));

  dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const stand = `http://127.0.0.1:${supabase.address().port}`;
  writeFileSync(join(dir, "mcp.env"), `SUPABASE_URL=${stand}\nSUPABASE_ANON_KEY=anon\nSTORAGE_URL=${stand}\nPUBLISHER_URL=${stand}\nOPENAI_APPS_CHALLENGE=challenge-token\n`);
  port = await sparePort();
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, MCP_ENV: join(dir, "mcp.env"), MCP_PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => String(data).includes("listening") && resolve());
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => {
  child?.kill();
  supabase?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("an agent with no token is told to sign in", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /resource_metadata=/);
});

test("a plan.video sign-in that isn't a connector's is refused at /mcp", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token({ sub: ALICE })}` }, body: "{}" });
  assert.equal(res.status, 401);
});

test("a browser on another site can reach /mcp and read why it was refused", async () => {
  const preflight = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "OPTIONS",
    headers: { Origin: "https://inspector.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,mcp-protocol-version" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  for (const header of ["authorization", "content-type", "mcp-protocol-version"]) assert.match(preflight.headers.get("access-control-allow-headers"), new RegExp(header, "i"));

  const refused = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Origin: "https://inspector.example" }, body: "{}" });
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get("access-control-allow-origin"), "*");
  assert.match(refused.headers.get("access-control-expose-headers"), /WWW-Authenticate/i);
});

test("directories that can't sign in read the tools from the server card", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/.well-known/mcp/server-card.json`);
  assert.equal(res.status, 200);
  const card = await res.json();
  assert.equal(card.authentication.required, true);
  assert.match(card.transport.url, /\/mcp$/);
  const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
  assert.deepEqual(card.tools.map((tool) => tool.name), catalog.tools.map((tool) => tool.name));
});

function callTool(name, args, { ip = "198.51.100.60", bearer = CONNECTOR_TOKEN } = {}) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Forwarded-For": ip },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }).then(async (res) => (await res.json()).result);
}

test("a post is scheduled with the connector's own token, its file copied first", async () => {
  asked.length = 0;
  const result = await callTool("schedule_post", { caption: "Hello", platforms: ["bluesky"], day: "2099-01-01", time: "10:00", draft: true, media: "media:pic" });
  assert.equal(result.isError, undefined, result.content[0].text);
  const post = JSON.parse(result.content[0].text);
  assert.equal(post.status, "draft");
  const routes = asked.map((call) => call.url);
  assert.deepEqual(routes, ["/rest/v1/rpc/agent_context", "/api/storage/agent-copy", "/rest/v1/rpc/agent_save_post"]);
  assert.ok(asked.every((call) => call.client === "claude"));
  const [, copy, save] = asked;
  assert.deepEqual(copy.body.copies, [{ from: "media/pic", to: save.body.post.files[0] }]);
  assert.equal(save.body.base, null);
  assert.equal(save.body.owner, ALICE);
});

test("publishing goes through the publisher with the connector's own token, and answers once it's out", async () => {
  asked.length = 0;
  sent = false;
  const result = await callTool("publish_post", { id: "p1" });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text).deliveries, [{ platform: "bluesky", state: "sent" }]);
  const routes = asked.map((call) => call.url);
  assert.ok(routes.includes("/api/publisher/send"), routes.join(" "));
  assert.ok(asked.every((call) => call.client === "claude"));
});

test("before the database has the agent functions, an agent is told to try again soon", async () => {
  const result = await callTool("list_posts", {}, { bearer: BEFORE_TOKEN });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /being updated/);
});

test("a database error that isn't plan.video's own words doesn't reach the agent", async () => {
  const result = await callTool("list_posts", {}, { bearer: token({ sub: ALICE, client_id: "broken" }) });
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /uuid|public\.posts/);
});

test("OpenAI's domain check reads the token it asked for, as plain text", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "challenge-token");
});
