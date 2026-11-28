import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";

import { answerFor, handleMoments, readRequest, virality } from "./moments.mjs";
import { json, Refused } from "./handler.mjs";

const words = (...list) => list.map(([text, start, end]) => ({ text, start, end }));

const marks = (all) => ({ hook: all, payoff: all, standalone: all, buzz: all });

const window0 = {
  length: 60,
  words: words(["okay", 2.1, 2.4], ["watch", 2.5, 2.9], ["this", 3.0, 3.3], ["no", 30.2, 30.5], ["way!", 30.6, 31.4]),
  chat: ["KEKW ×20"],
  chatTotal: 80,
  clips: [{ title: "crash", views: 1500 }],
};

test("picks snap to word edges and stay inside their window", () => {
  const request = readRequest({ windows: [window0], count: 5 });
  const { moments } = answerFor({ moments: [{ window: 0, start: 1.8, end: 31.0, ...marks(9), title: "He did not", caption: "", reason: "" }] }, request);
  // A breath before the first word, and a moment after the payoff for the reaction.
  assert.deepEqual(moments.map(({ start, end }) => [start, end]), [[1.9, 32]]);

  const outside = answerFor({ moments: [{ window: 3, start: 0, end: 20, ...marks(10), title: "x", caption: "", reason: "" }] }, request);
  assert.deepEqual(outside.moments, []);

  const late = answerFor({ moments: [{ window: 0, start: 55, end: 200, ...marks(5), title: "x", caption: "", reason: "" }] }, request);
  assert.deepEqual(late.moments.map(({ start, end }) => [start, end]), [[52, 60]]);
});

test("overlapping picks in one window keep the better one, and the count holds", () => {
  const request = readRequest({ windows: [window0, window0], count: 2 });
  const pick = (window, start, end, mark) => ({ window, start, end, ...marks(mark), title: `t${mark}`, caption: "", reason: "" });
  const { moments } = answerFor({ moments: [pick(0, 0, 30, 4), pick(0, 10, 40, 8), pick(1, 0, 20, 6), pick(1, 30, 50, 1)] }, request);
  assert.deepEqual(moments.map((moment) => moment.title), ["t8", "t6"]);
});

test("virality weighs the payoff and the hook above the rest, and stays within 0 to 100", () => {
  assert.equal(virality(marks(10)), 100);
  assert.equal(virality({ hook: 15, payoff: 12, standalone: 99, buzz: 10 }), 100);
  assert.equal(virality({ hook: -3, payoff: "x", standalone: null }), 0);
  const strongPayoff = virality({ hook: 5, payoff: 9, standalone: 5, buzz: 5 });
  const loudChat = virality({ hook: 5, payoff: 5, standalone: 5, buzz: 9 });
  assert.ok(strongPayoff > loudChat);
  const request = readRequest({ windows: [window0], count: 1 });
  const { moments } = answerFor({ moments: [{ window: 0, start: 2, end: 31, hook: 7, payoff: 8, standalone: 6, buzz: 9, title: "x", caption: "", reason: "" }] }, request);
  assert.equal(moments[0].score, 76);
});

test("a stream with nothing said is refused before the model is asked", () => {
  assert.throws(() => readRequest({ windows: [{ ...window0, words: [] }] }), (error) => error instanceof Refused && error.status === 422);
});

const SUPABASE = "https://db.test";
const tokenFor = (id) => `h.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.s`;
const idOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;

test("Opus spend counts at its price, so the daily cap stops a second run", async (t) => {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1")) return real(input, init);
    if (url === `${SUPABASE}/auth/v1/user`) return Response.json({ id: idOf(new Headers(init.headers).get("authorization").slice(7)) });
    if (url.startsWith(`${SUPABASE}/rest/v1/user_data?`)) return Response.json([{ access_level: 2 }]);
    if (url.startsWith("https://api.anthropic.com/v1/messages")) {
      calls += 1;
      return Response.json({
        id: `msg_${calls}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({ moments: [{ window: 0, start: 2, end: 31, ...marks(8), title: "No way", caption: "", reason: "" }] }) }],
        stop_reason: "end_turn",
        // 40x this passes a 300k cap; at Haiku's price it would be well under.
        usage: { input_tokens: 10_000, output_tokens: 0 },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => (globalThis.fetch = real));

  const env = { anthropicKey: "k", supabaseUrl: SUPABASE, supabaseAnonKey: "a", requireInvite: false, momentsBudget: "300000" };
  const server = createServer((req, res) => {
    handleMoments(req, res, env).catch((error) => json(res, error instanceof Refused ? error.status : 500, { error: String(error?.message ?? error) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const send = () =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ windows: [window0] });
      const req = request(`http://127.0.0.1:${server.address().port}/api/agent/moments`, { method: "POST", headers: { authorization: `Bearer ${tokenFor("u-opus")}`, "content-type": "application/json" } }, (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on("error", reject);
      req.end(body);
    });

  const first = await send();
  assert.equal(first.status, 200);
  assert.equal(first.body.moments[0].title, "No way");
  const second = await send();
  assert.equal(second.status, 429);
  assert.match(second.body.error, /today's limit for finding clips/);
  assert.equal(calls, 1);
});
