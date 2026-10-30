import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleCaptions } from "./captions.mjs";
import { budgetsByLevel, clientIp, handleAgent, json, Refused } from "./handler.mjs";

const SUPABASE = "https://db.test";
const DAY = 86_400_000;
const tokenFor = (id) => `h.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.s`;
const idOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;

/** Each call to the model costs this much, and holds about as much again before it's known. */
const STEP = 100_000;
/** Creator's day: four steps. Free gets one, Pro eight, Agency sixteen. */
const BASE = 4 * STEP;

function stepStream() {
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: STEP, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** `levels` is each person's plan, `teams` the owners whose teams they joined (`invites`: not yet). */
function fakes({ levels = {}, teams = {}, invites = {} } = {}) {
  const state = { calls: 0, outside: [] };
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1")) return real(input, init);
    const token = new Headers(init.headers).get("authorization")?.slice(7) ?? "";
    if (url === `${SUPABASE}/auth/v1/user`) return Response.json({ id: idOf(token) });
    if (url.startsWith(`${SUPABASE}/rest/v1/user_data?`)) {
      const id = idOf(token);
      assert.ok(url.endsWith(`id=eq.${id}`), url);
      return Response.json(levels[id] ? [{ access_level: levels[id] }] : []);
    }
    if (url === `${SUPABASE}/rest/v1/rpc/my_team`) {
      const id = idOf(token);
      return Response.json({
        workspaces: (teams[id] ?? []).map((owner) => ({ owner, workspace: "w", role: "member", state: "active" })),
        invites: (invites[id] ?? []).map((owner) => ({ owner, workspace: "w", role: "member", open: true })),
      });
    }
    if (url.startsWith("https://api.anthropic.com/v1/messages")) {
      state.calls += 1;
      if (JSON.parse(init.body).stream) return stepStream();
      return Response.json({
        id: `msg_${state.calls}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: JSON.stringify({ keywords: [] }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: STEP, output_tokens: 0 },
      });
    }
    state.outside.push(url);
    throw new Error(`unexpected fetch ${url}`);
  };
  state.restore = () => {
    globalThis.fetch = real;
  };
  return state;
}

let keys = 0;
/** On a day of its own: the clock is moved on so every count from an earlier test is over. */
async function setup(t, env = {}, world = {}) {
  keys += 1;
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) + keys * 3 * DAY });
  const fake = fakes(world);
  // A key of its own: the client made for a key keeps the fetch it was made with.
  const fullEnv = { anthropicKey: `test-key-${keys}`, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", requireInvite: false, ...env };
  const server = createServer((req, res) => {
    const handle = req.url === "/api/agent" ? handleAgent : handleCaptions;
    handle(req, res, fullEnv).catch((error) => {
      if (error instanceof Refused) json(res, error.status, { error: error.message });
      else json(res, 500, { error: String(error?.message ?? error) });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fake.restore();
    assert.deepEqual(fake.outside, [], "nothing but the fakes was called");
  });
  return { fake, base };
}

function send(base, route, id, ip = "203.0.113.1", forwarded = ip) {
  const body =
    route === "agent"
      ? JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "Schedule a post." }] }] })
      : JSON.stringify({ task: "keywords", lines: [["We", "made", "a", "million", "dollars"]] });
  const path = route === "agent" ? "/api/agent" : "/api/agent/captions";
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method: "POST",
      agent: false,
      headers: { Authorization: `Bearer ${tokenFor(id)}`, "Content-Type": "application/json", "X-Forwarded-For": forwarded },
    });
    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const lines = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const error = lines.find((line) => line.error)?.error ?? null;
        resolve({ status: res.statusCode, ok: res.statusCode === 200 && !error, error });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function untilRefused(base, route, id, ip, most = 40) {
  for (let done = 0; done < most; done++) {
    const answer = await send(base, route, id, ip);
    if (!answer.ok) return { done, answer };
  }
  return { done: most, answer: null };
}

test("a person's day goes by plan: Free a quarter of Creator's, Pro twice, Agency four times", () => {
  assert.deepEqual(budgetsByLevel(""), { 1: 1_000_000, 2: 4_000_000, 3: 8_000_000, 4: 16_000_000 });
  assert.deepEqual(budgetsByLevel("400000"), { 1: 100_000, 2: 400_000, 3: 800_000, 4: 1_600_000 });
  assert.deepEqual(budgetsByLevel(400_000), { 1: 100_000, 2: 400_000, 3: 800_000, 4: 1_600_000 });
  assert.deepEqual(budgetsByLevel("0,1,2,3"), { 1: 0, 2: 1, 3: 2, 4: 3 });
  assert.deepEqual(budgetsByLevel("5,,x"), { 1: 5, 2: 4_000_000, 3: 8_000_000, 4: 16_000_000 });
});

test("the client's address is the hop Caddy appended, not one the client wrote", () => {
  const req = (forwarded, remote = "127.0.0.1") => ({ headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req("1.2.3.4")), "1.2.3.4");
  assert.equal(clientIp(req("9.9.9.9, 8.8.8.8, 1.2.3.4")), "1.2.3.4");
  assert.equal(clientIp(req(undefined, "::ffff:5.6.7.8")), "5.6.7.8");
  // One IPv6 connection usually has its whole /64.
  assert.equal(clientIp(req("2001:db8:aa:bb:1:2:3:4")), "2001:db8:aa:bb::/64");
  assert.equal(clientIp(req("2001:db8:aa:bb::ffff")), "2001:db8:aa:bb::/64");
  assert.equal(clientIp(req("2001:0DB8::1")), "2001:db8:0:0::/64");
});

for (const route of ["agent", "captions"]) {
  test(`${route}: each plan gets its own day`, async (t) => {
    const levels = { free: 1, creator: 2, pro: 3, agency: 4 };
    const { base, fake } = await setup(t, { personBudget: BASE, captionsBudget: BASE }, { levels });
    const steps = {};
    for (const [id, index] of Object.keys(levels).map((id, index) => [id, index])) {
      const { done, answer } = await untilRefused(base, route, id, `198.51.100.${index + 1}`);
      steps[id] = done;
      assert.equal(answer.status, 429);
      assert.match(answer.error, /^You've reached today's limit for (the agent|caption tools)\./);
    }
    assert.deepEqual(steps, { free: 1, creator: 4, pro: 8, agency: 16 });
    assert.equal(fake.calls, 29);
  });
}

test("a team member on Free spends from the owner's day, not a fresh one per invite", async (t) => {
  const levels = { owner: 3 };
  const teams = { member1: ["owner"], member2: ["owner"], member3: ["owner"] };
  // Only invited, not joined: on their own Free day.
  const invites = { invited: ["owner"] };
  const { base } = await setup(t, { personBudget: BASE }, { levels, teams, invites });

  // Pro's day is eight steps, for the owner and every member together.
  for (let i = 0; i < 3; i++) assert.equal((await send(base, "agent", "member1", "192.0.2.1")).ok, true);
  for (let i = 0; i < 3; i++) assert.equal((await send(base, "agent", "member2", "192.0.2.2")).ok, true);
  for (let i = 0; i < 2; i++) assert.equal((await send(base, "agent", "owner", "192.0.2.3")).ok, true);
  const member = await send(base, "agent", "member3", "192.0.2.4");
  assert.equal(member.status, 429);
  assert.equal(member.error, "Your team has reached today's limit for the agent. It's back tomorrow.");
  assert.equal((await send(base, "agent", "owner", "192.0.2.3")).status, 429);

  const invited = await untilRefused(base, "agent", "invited", "192.0.2.5");
  assert.equal(invited.done, 1);
  assert.equal(invited.answer.error, "You've reached today's limit for the agent. It's back tomorrow.");
});

test("Free accounts together can't use more than their share of the site's day, so paid ones still can", async (t) => {
  // The site's day is ten steps; Free accounts share half of it. Each Free account's own day is one step.
  const levels = { paid: 2 };
  const { base } = await setup(t, { personBudget: BASE, captionsBudget: BASE, siteBudget: 10 * STEP }, { levels });

  for (let i = 0; i < 5; i++) {
    const route = i % 2 ? "captions" : "agent";
    assert.equal((await send(base, route, `free${i}`, `198.51.100.${10 + i}`)).ok, true, `free${i}`);
  }
  const free = await send(base, "agent", "free5", "198.51.100.20");
  assert.equal(free.status, 429);
  assert.equal(free.error, "The agent is resting for today on the Free plan. It's back tomorrow, or now on a paid plan.");
  const captions = await send(base, "captions", "free6", "198.51.100.21");
  assert.equal(captions.error, "Caption tools are resting for today on the Free plan. They're back tomorrow, or now on a paid plan.");

  // The other half is the paying accounts'.
  const paid = await untilRefused(base, "agent", "paid", "198.51.100.22");
  assert.equal(paid.done, 4);
  assert.equal(paid.answer.error, "You've reached today's limit for the agent. It's back tomorrow.");
});

test("many Free accounts from one network share one day between them, the agent and captions together", async (t) => {
  const levels = { paid: 2 };
  const { base } = await setup(t, { personBudget: BASE, captionsBudget: BASE, networkBudget: 3 * STEP }, { levels });
  const ip = "203.0.113.50";

  assert.equal((await send(base, "agent", "a", ip)).ok, true);
  assert.equal((await send(base, "captions", "b", ip)).ok, true);
  assert.equal((await send(base, "agent", "c", ip)).ok, true);
  const fourth = await send(base, "captions", "d", ip);
  assert.equal(fourth.status, 429);
  assert.equal(fourth.error, "Free accounts on this network have reached today's limit for caption tools. They're back tomorrow, or now on a paid plan.");
  // A made-up address put in front of Caddy's doesn't help.
  assert.equal((await send(base, "agent", "e", ip, `10.9.8.7, ${ip}`)).error, "Free accounts on this network have reached today's limit for the agent. It's back tomorrow, or now on a paid plan.");

  // Another network, or a paid account on this one, goes on.
  assert.equal((await send(base, "agent", "f", "203.0.113.51")).ok, true);
  assert.equal((await send(base, "agent", "paid", ip)).ok, true);
});

test("the counts survive a restart, without keeping anyone's address", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "agent-limits-")), "limits.json");
  const env = { anthropicKey: "restart-key", siteBudget: 2 * STEP, networkBudget: STEP };
  const tool = { name: "agent", personBudget: 4 * STEP, messages: { person: "person", team: "team", site: "site", free: "free", network: "network" } };
  const from = (ip) => ({ headers: { "x-forwarded-for": ip }, socket: {} });

  // A copy of the module of its own is a fresh process's counts.
  const before = await import("./handler.mjs?run=before");
  before.loadLimits(file);
  before.settleBudgets(before.holdBudgets(before.budgetsFor(tool, { id: "one", level: 1, team: null }, from("198.18.0.1"), env), 1), STEP);
  before.saveLimits();
  assert.ok(!readFileSync(file, "utf8").includes("198.18.0.1"));

  const after = await import("./handler.mjs?run=after");
  // Not yet loaded: a fresh start lets it through.
  after.checkBudgets(after.budgetsFor(tool, { id: "one", level: 1, team: null }, from("198.18.0.1"), env));
  after.loadLimits(file);
  assert.throws(() => after.checkBudgets(after.budgetsFor(tool, { id: "one", level: 1, team: null }, from("198.18.0.1"), env)), /^Error: person$/);
  assert.throws(() => after.checkBudgets(after.budgetsFor(tool, { id: "two", level: 1, team: null }, from("198.18.0.1"), env)), /^Error: network$/);
  // The site's day is two steps, so Free accounts' half of it is spent.
  assert.throws(() => after.checkBudgets(after.budgetsFor(tool, { id: "three", level: 1, team: null }, from("198.18.0.2"), env)), /^Error: free$/);
  after.checkBudgets(after.budgetsFor(tool, { id: "four", level: 2, team: null }, from("198.18.0.2"), env));
});
