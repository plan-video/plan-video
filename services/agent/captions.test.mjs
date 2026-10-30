import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";

import { handleCaptions } from "./captions.mjs";
import { hold, json, Refused, settle } from "./handler.mjs";

const SUPABASE = "https://db.test";
const tokenFor = (id) => `h.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.s`;
const idOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;

/** Stands in for Supabase and the Anthropic API: each call takes `delay` ms and costs `inputTokens`. */
function fakes({ delay = 100, inputTokens = 50_000, fail = false } = {}) {
  const state = { calls: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1")) return real(input, init);
    if (url === `${SUPABASE}/auth/v1/user`) return Response.json({ id: idOf(new Headers(init.headers).get("authorization").slice(7)) });
    // Everyone here is on Creator, whose budget is the number the tests give.
    if (url.startsWith(`${SUPABASE}/rest/v1/user_data?`)) return Response.json([{ access_level: 2 }]);
    if (url.startsWith("https://api.anthropic.com/v1/messages")) {
      state.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (fail) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "No." } }, { status: 400 });
      return Response.json({
        id: `msg_${state.calls}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: JSON.stringify({ keywords: [] }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  state.restore = () => {
    globalThis.fetch = real;
  };
  return state;
}

async function serve(env) {
  const server = createServer((req, res) => {
    handleCaptions(req, res, env).catch((error) => {
      if (error instanceof Refused) json(res, error.status, { error: error.message });
      else json(res, 500, { error: String(error?.message ?? error) });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/api/agent/captions`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function send(url, token) {
  const body = JSON.stringify({ task: "keywords", lines: [["We", "made", "a", "million", "dollars"]] });
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", agent: false, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    req.on("response", (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(body);
  });
}

let keys = 0;
async function setup(options, budgets) {
  const fake = fakes(options);
  keys += 1;
  const app = await serve({ anthropicKey: `key-${keys}`, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", requireInvite: false, ...budgets });
  return {
    fake,
    url: app.url,
    async close() {
      await app.close();
      fake.restore();
    },
  };
}

test("held amounts count against the budget until swapped for the real cost", () => {
  const name = `test-hold-${Date.now()}`;
  const first = hold(name, 800, 400, "spent");
  const second = hold(name, 800, 400, "spent");
  assert.throws(() => hold(name, 800, 1, "spent"), /spent/);
  settle(first, 50);
  settle(second, 0);
  // Only the 50 actually used is left on the count.
  const third = hold(name, 800, 750, "spent");
  assert.throws(() => hold(name, 800, 1, "spent"), /spent/);
  settle(third, 0);
  settle(hold(name, 800, 1, "spent"), 0);
});

test("a burst of caption requests sent at once can't each pass on the same old total", async () => {
  // Each call holds about 100k against a 300k budget, and really costs 50k.
  const run = await setup({}, { captionsBudget: 300_000 });
  try {
    const token = tokenFor("burst");
    const statuses = await Promise.all(Array.from({ length: 10 }, () => send(run.url, token)));
    assert.equal(run.fake.calls, 3, JSON.stringify(statuses));
    assert.equal(statuses.filter((status) => status === 429).length, 7);
    // Held amounts were swapped for 3 × 50k: room is left for more, one burst at a time.
    assert.equal(await send(run.url, token), 200);
  } finally {
    await run.close();
  }
});

test("a call that fails costs nothing", async () => {
  const run = await setup({ fail: true }, { captionsBudget: 150_000 });
  try {
    const token = tokenFor("fails");
    for (let i = 0; i < 5; i++) assert.equal(await send(run.url, token), 502);
    assert.equal(run.fake.calls, 5);
  } finally {
    await run.close();
  }
});
