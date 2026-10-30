/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runs server.mjs on a spare port, against a stand-in for Supabase, and talks
// to it the way tabs, agents and strangers on the internet do.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";

const ORIGIN = "http://localhost:5173";
const ALICE = "0b6a3d4e-6f2a-4c1e-9d4b-3c2f1e0a9b8c";
const MiB = 1024 * 1024;

/** A token shaped like Supabase's: only its claims matter to the stand-in. */
function token(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.sig`;
}
const EDITOR_TOKEN = token({ sub: ALICE });
const CONNECTOR_TOKEN = token({ sub: ALICE, client_id: "claude" });

function claimsOf(req) {
  const value = String(req.headers.authorization ?? "").slice(7);
  return JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8") || "null");
}

let supabase;
let child;
let dir;
let port;

/** A port nothing is listening on. */
function sparePort() {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

before(async () => {
  supabase = createServer((req, res) => {
    const claims = claimsOf(req);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/v1/user" && claims?.sub === ALICE && !claims.client_id) return res.end(JSON.stringify({ id: ALICE }));
    if (req.url === "/rest/v1/rpc/connector_identity" && claims?.client_id) return res.end(JSON.stringify({ user_id: ALICE, client_id: claims.client_id }));
    res.statusCode = 401;
    res.end("{}");
  });
  await new Promise((resolve) => supabase.listen(0, "127.0.0.1", resolve));

  dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  writeFileSync(join(dir, "mcp.env"), `SUPABASE_URL=http://127.0.0.1:${supabase.address().port}\nSUPABASE_ANON_KEY=anon\nALLOWED_ORIGINS=${ORIGIN}\n`);
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

/** The server's resident memory, in MiB. */
function rss() {
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).trim()) / 1024;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Opens a tab socket from `ip`; resolves once open, or to the HTTP status it was refused with. */
function openTab(ip) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/tab`, { origin: ORIGIN, headers: { "X-Forwarded-For": ip } });
    ws.on("open", () => resolve(ws));
    ws.on("unexpected-response", (req, res) => {
      res.resume();
      resolve(res.statusCode);
    });
    ws.on("error", reject);
  });
}

/** Resolves with the close code once `ws` closes. */
function closed(ws) {
  return new Promise((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve(ws.closeCode) : ws.on("close", (code) => resolve(code))));
}

/** The next message `ws` is sent, parsed. */
function nextMessage(ws) {
  return new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(String(data)))));
}

/**
 * The attack: a raw socket that upgrades, announces a text frame just under the
 * 24 MiB limit, and sends all of it but the last byte, so the frame never ends
 * and never says hello. Resolves once the bytes are written or the server cuts
 * it off; the socket is left open.
 */
function bigFrameBeforeHello(ip) {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let upgraded = false;
    let cutOff = false;
    socket.on("error", () => {});
    socket.on("close", () => {
      cutOff = true;
      resolve({ socket, cutOff });
    });
    socket.write(
      `GET /api/mcp/tab HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n` +
        `Origin: ${ORIGIN}\r\nX-Forwarded-For: ${ip}\r\n\r\n`,
    );
    socket.on("data", async (data) => {
      if (upgraded) return;
      upgraded = true;
      assert.match(String(data), /^HTTP\/1\.1 101/);
      const length = 24 * MiB - 64;
      const header = Buffer.alloc(14);
      header[0] = 0x81; // FIN, text
      header[1] = 0x80 | 127; // masked, 64-bit length
      header.writeBigUInt64BE(BigInt(length), 2);
      socket.write(header); // mask key: four zero bytes, so the payload goes as is
      const chunk = Buffer.alloc(MiB, 0x61);
      for (let sent = 0; sent < length - 1 && !cutOff; ) {
        const part = chunk.subarray(0, Math.min(MiB, length - 1 - sent));
        sent += part.length;
        if (!socket.write(part)) await new Promise((done) => socket.once("drain", done).once("close", done));
      }
      if (!cutOff) resolve({ socket, cutOff });
    });
  });
}

test("big frames before the hello are cut off and don't fill memory", async () => {
  await wait(300);
  const start = rss();
  const attacks = await Promise.all(Array.from({ length: 8 }, (_, i) => bigFrameBeforeHello(`198.51.100.${i + 1}`)));
  await wait(500);
  const end = rss();
  console.log(`server RSS before ${start.toFixed(0)} MiB, after 8 frames of 24 MiB ${end.toFixed(0)} MiB`);
  assert.ok(attacks.every((attack) => attack.cutOff), "every socket is closed by the server");
  assert.ok(end - start < 40, `RSS grew by ${(end - start).toFixed(0)} MiB`);
  for (const { socket } of attacks) socket.destroy();
});

test("a hello bigger than the limit is cut off", async () => {
  const ws = await openTab("198.51.100.20");
  ws.send(JSON.stringify({ type: "hello", token: "x".repeat(32 * 1024) }));
  assert.equal(await closed(ws), 1006);
});

test("one address can hold only 20 sockets that haven't said hello", async () => {
  const ip = "203.0.113.7";
  const open = [];
  for (let i = 0; i < 20; i++) open.push(await openTab(ip));
  assert.ok(open.every((ws) => ws instanceof WebSocket));
  assert.equal(await openTab(ip), 429);
  // Another address is still let in.
  const other = await openTab("203.0.113.8");
  assert.ok(other instanceof WebSocket);
  other.close();
  // A socket that goes frees its place.
  open[0].close();
  await closed(open[0]);
  await wait(50);
  const again = await openTab(ip);
  assert.ok(again instanceof WebSocket);
  for (const ws of [...open, again]) ws.close();
  await Promise.all([...open, again].map(closed));
});

test("only 500 sockets in all may be waiting to say hello", async () => {
  const open = [];
  for (let n = 0; n < 25; n++) {
    open.push(...(await Promise.all(Array.from({ length: 20 }, () => openTab(`192.0.2.${n + 1}`)))));
  }
  assert.ok(open.every((ws) => ws instanceof WebSocket));
  assert.equal(await openTab("192.0.2.200"), 503);
  for (const ws of open) ws.close();
  await Promise.all(open.map(closed));
  await wait(50);
  const later = await openTab("192.0.2.201");
  assert.ok(later instanceof WebSocket);
  later.close();
});

test("a socket that never says hello is closed after 10 seconds", { timeout: 15_000 }, async () => {
  const ws = await openTab("198.51.100.30");
  const opened = Date.now();
  assert.equal(await closed(ws), 4401);
  const ms = Date.now() - opened;
  assert.ok(ms >= 9_500 && ms < 11_500, `closed after ${ms} ms`);
});

test("a signed-in tab answers an agent's call with a big result, end to end", async () => {
  const tab = await openTab("198.51.100.40");
  tab.send(JSON.stringify({ type: "hello", token: EDITOR_TOKEN }));
  assert.deepEqual(await nextMessage(tab), { type: "ready" });
  tab.send(JSON.stringify({ type: "active" }));

  // The tab answers with a 6 MiB frame, far past the hello's limit.
  const image = randomBytes(4.5 * MiB).toString("base64");
  tab.on("message", (data) => {
    const call = JSON.parse(String(data));
    if (call.type !== "call") return;
    assert.equal(call.tool, "list_posts");
    tab.send(JSON.stringify({ type: "result", id: call.id, ok: true, text: "[]", images: [{ mediaType: "image/png", data: image }] }));
  });

  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CONNECTOR_TOKEN}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Forwarded-For": "198.51.100.41" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_posts", arguments: {} } }),
  });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content[0], { type: "text", text: "[]" });
  assert.equal(result.content[1].data.length, image.length);
  assert.equal(result.content[1].data, image);

  // Still connected after the big message.
  assert.equal(tab.readyState, WebSocket.OPEN);
  tab.close();
  await closed(tab);
});

test("an agent with no token is told to sign in", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /resource_metadata=/);
});
