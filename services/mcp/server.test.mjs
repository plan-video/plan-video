/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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

/** Only its claims matter to the stand-in. */
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

function rss() {
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).trim()) / 1024;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

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

function closed(ws) {
  return new Promise((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve(ws.closeCode) : ws.on("close", (code) => resolve(code))));
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(String(data)))));
}

/** A raw socket announcing a text frame just under the 24 MiB limit that never ends or says hello. */
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
  const other = await openTab("203.0.113.8");
  assert.ok(other instanceof WebSocket);
  other.close();
  open[0].close();
  await closed(open[0]);
  await wait(50);
  const again = await openTab(ip);
  assert.ok(again instanceof WebSocket);
  for (const ws of [...open, again]) ws.close();
  await Promise.all([...open, again].map(closed));
});

test("addresses in one IPv6 /64 count as one", async () => {
  const open = [];
  for (let i = 1; i <= 20; i++) open.push(await openTab(`2001:db8:aa:bb::${i.toString(16)}`));
  assert.ok(open.every((ws) => ws instanceof WebSocket));
  assert.equal(await openTab("2001:db8:aa:bb:ffff::1"), 429);
  for (const ws of open) ws.close();
  await Promise.all(open.map(closed));
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

test("a tab's socket ends with its sign-in, unless it shows a new one by then that's still its own", { timeout: 15_000 }, async () => {
  const soon = () => token({ sub: ALICE, exp: Math.floor(Date.now() / 1000) + 2, jti: randomBytes(4).toString("hex") });
  const signedIn = async (ip) => {
    const tab = await openTab(ip);
    const ready = new Promise((resolve) => tab.once("message", resolve));
    tab.send(JSON.stringify({ type: "hello", token: soon() }));
    await ready;
    return tab;
  };
  const left = await signedIn("203.0.113.40");
  const renewed = await signedIn("203.0.113.41");
  const stranger = await signedIn("203.0.113.42");
  renewed.send(JSON.stringify({ type: "token", token: token({ sub: ALICE, jti: "fresh" }) }));
  stranger.send(JSON.stringify({ type: "token", token: token({ sub: "someone-else" }) }));
  assert.equal(await closed(stranger), 4401);
  assert.equal(await closed(left), 4401);
  const pong = new Promise((resolve) => renewed.once("pong", resolve));
  renewed.ping();
  await pong;
  assert.equal(renewed.readyState, WebSocket.OPEN);
  renewed.close();
  await closed(renewed);
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

  assert.equal(tab.readyState, WebSocket.OPEN);
  tab.close();
  await closed(tab);
});

async function signedInTab(ip) {
  const tab = await openTab(ip);
  tab.send(JSON.stringify({ type: "hello", token: EDITOR_TOKEN }));
  assert.deepEqual(await nextMessage(tab), { type: "ready" });
  return tab;
}

function askAgent(ip = "198.51.100.41") {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CONNECTOR_TOKEN}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Forwarded-For": ip },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_posts", arguments: {} } }),
  }).then((res) => res.json());
}

/** Resolves with the call's id once this tab, not another of the same person's, is asked. */
function askedOn(tab) {
  return new Promise((resolve) => {
    const seen = (data) => {
      const message = JSON.parse(String(data));
      if (message.type !== "call") return;
      tab.off("message", seen);
      resolve(message.id);
    };
    tab.on("message", seen);
  });
}

async function roundTrip(tab, size = 0) {
  tab.send(JSON.stringify({ type: "active" }));
  const asked = askedOn(tab);
  const answer = askAgent();
  tab.send(JSON.stringify({ type: "result", id: await asked, ok: true, text: "x".repeat(size) }));
  return (await answer).result;
}

test("a signed-in tab no call is waiting on is cut off at a big frame", async () => {
  const tab = await signedInTab("198.51.100.50");
  tab.send(JSON.stringify({ type: "active", padding: "x".repeat(MiB) }));
  assert.equal(await closed(tab), 1006);
});

test("pongs can't hide the pieces of a big frame", async () => {
  const tab = await signedInTab("198.51.100.51");
  const piece = Buffer.alloc(8 * 1024, 0x61);
  tab.on("error", () => {});
  const ended = closed(tab);
  let open = true;
  void ended.then(() => (open = false));
  for (let sent = 0; open && sent < 2000; sent++) {
    await new Promise((done) => tab.send(piece, { fin: false, binary: false }, done));
    await new Promise((done) => tab.pong("", true, done));
  }
  assert.equal(await ended, 1006);
});

test("small frames and pongs never add up to the limit", async () => {
  const tab = await signedInTab("198.51.100.52");
  const asides = JSON.stringify({ type: "active", padding: "x".repeat(1024) });
  for (let sent = 0; sent < 40; sent++) tab.send(asides);
  // More than 16 KiB of them: a day's worth of heartbeats on a tab left open.
  for (let sent = 0; sent < 3000; sent++) tab.pong();
  const { isError, content } = await roundTrip(tab);
  assert.equal(isError, undefined);
  assert.equal(content[0].text, "");
  tab.close();
  await closed(tab);
});

test("a big result leaves the tab open and answering, and six full frames fit", async () => {
  const tab = await signedInTab("198.51.100.53");
  const big = await roundTrip(tab, 200 * 1024);
  assert.equal(big.content[0].text.length, 200 * 1024);
  assert.equal((await roundTrip(tab)).isError, undefined);

  tab.send(JSON.stringify({ type: "active" }));
  const asked = askedOn(tab);
  const answer = askAgent();
  const frame = randomBytes(2.8 * MiB).toString("base64");
  tab.send(JSON.stringify({ type: "result", id: await asked, ok: true, text: "[]", images: Array.from({ length: 6 }, () => ({ mediaType: "image/png", data: frame })) }));
  const { result } = await answer;
  assert.equal(result.content.length, 7);
  assert.equal(result.content[6].data, frame);

  assert.equal((await roundTrip(tab)).isError, undefined);
  tab.close();
  await closed(tab);
});

test("a frame that would swell on parsing is refused, even with a call waiting", async () => {
  await wait(300);
  const start = rss();
  const tab = await signedInTab("198.51.100.54");
  tab.send(JSON.stringify({ type: "active" }));
  const asked = askedOn(tab);
  const answer = askAgent();
  await asked;
  const ended = closed(tab);
  tab.send(`[${"{},".repeat(Math.floor((24 * MiB - 4) / 3))}{}]`);
  assert.equal(await ended, 1003);
  const end = rss();
  assert.ok(end - start < 150, `RSS grew by ${(end - start).toFixed(0)} MiB`);
  assert.match((await answer).result.content[0].text, /tab closed/);
});

test("past 128 MiB of big frames on their way, in all, the next tab is cut off", async () => {
  const tabs = [];
  for (let n = 0; n < 8; n++) tabs.push(await signedInTab(`198.51.100.${60 + n}`));
  const ends = tabs.map(closed);
  const answers = [];
  const heard = [];
  for (const tab of tabs) {
    tab.on("error", () => {});
    tab.on("message", (data) => {
      if (JSON.parse(String(data)).type === "call") heard.shift()?.(tab);
    });
  }

  const piece = Buffer.alloc(20 * MiB, 0x61);
  let cut = -1;
  for (const [index, tab] of tabs.entries()) {
    // Two tabs used in the same millisecond tie: asked again until this one has a call of its own.
    let asked;
    do {
      tab.send(JSON.stringify({ type: "active" }));
      const next = new Promise((resolve) => heard.push(resolve));
      answers.push(askAgent());
      asked = await next;
    } while (asked !== tab);
    tab.send(piece, { fin: false, binary: false });
    // A pong comes back only once the server has read everything sent before its ping.
    const taken = new Promise((resolve) => tab.once("pong", () => resolve(true)));
    tab.ping();
    if (!(await Promise.race([taken, ends[index].then(() => false)]))) {
      cut = index;
      break;
    }
  }
  assert.equal(cut, 6);
  for (const tab of tabs) tab.close();
  await Promise.all(ends);
  await Promise.all(answers);

  // Those bytes went with their sockets: the next big result goes through.
  const next = await signedInTab("198.51.100.70");
  assert.equal((await roundTrip(next, MiB)).content[0].text.length, MiB);
  next.close();
  await closed(next);
});

test("an agent with no token is told to sign in", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /resource_metadata=/);
});
