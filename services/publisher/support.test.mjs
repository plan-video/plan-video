import assert from "node:assert/strict";
import test from "node:test";

import { json } from "./api.mjs";
import { clientIp, composeReport, createSupport, parseReport } from "./support.mjs";

const REPORT = { kind: "bug", email: "Ada@Example.com", message: "The calendar won't open on Safari.\nIt stays blank.", page: "/dashboard", browser: "Safari 18", language: "en" };

function exchange(body, { ip = "203.0.113.7", token = "", method = "POST" } = {}) {
  const req = { method, body, headers: { "x-forwarded-for": `10.0.0.1, ${ip}`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, socket: {} };
  const res = {
    status: 0,
    body: null,
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = JSON.parse(text);
    },
  };
  return { req, res };
}

function setup({ outcome = "sent", to = "founder@example.com", user = null } = {}) {
  const emails = [];
  let clock = Date.parse("2026-10-27T12:00:00Z");
  const support = createSupport({
    mailer: {
      async send(email) {
        emails.push(email);
        return outcome;
      },
    },
    to,
    supabaseUrl: "https://db.example",
    anonKey: "anon",
    readBody: async (req) => req.body,
    json,
    now: () => clock,
    fetch: async (url, init) => {
      assert.equal(url, "https://db.example/auth/v1/user");
      return init.headers.Authorization === "Bearer good" && user ? new Response(JSON.stringify(user)) : new Response("{}", { status: 401 });
    },
    log: { error() {} },
  });
  const send = async (body, options) => {
    const { req, res } = exchange(body, options);
    await support(req, res);
    return res;
  };
  return { send, emails, later: (ms) => (clock += ms) };
}

test("a report is emailed to the inbox, answered by replying to the sender", async () => {
  const { send, emails } = setup();
  const res = await send(REPORT);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: true });
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, "founder@example.com");
  assert.equal(emails[0].replyTo, "ada@example.com");
  assert.equal(emails[0].subject, "[Bug] The calendar won't open on Safari.");
  assert.match(emails[0].text, /It stays blank\./);
  assert.match(emails[0].text, /Account: Not signed in/);
  assert.doesNotMatch(emails[0].text, /203\.0\.113\.7/);
});

test("the sender's text is escaped in the HTML", async () => {
  const { html } = composeReport({ ...REPORT, message: "<img src=x onerror=alert(1)> broke it" }, { account: null, at: 0 });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x/);
});

test("a signed-in sender's account is checked with Supabase and named", async () => {
  const { send, emails } = setup({ user: { id: "u1", email: "ada@plan.example" } });
  await send(REPORT, { token: "good" });
  assert.match(emails[0].text, /Account: ada@plan\.example \(u1\)/);
  await send({ ...REPORT, message: "Another thing that broke today." }, { token: "forged" });
  assert.match(emails[1].text, /Account: Not signed in/);
});

test("the hidden field drops a bot's report while thanking it", async () => {
  const { send, emails } = setup();
  const res = await send({ ...REPORT, website: "https://spam.example" });
  assert.equal(res.status, 200);
  assert.equal(emails.length, 0);
});

test("a report without a reply address or with too little said is refused", async () => {
  const { send, emails } = setup();
  assert.equal((await send({ ...REPORT, email: "not an email" })).status, 400);
  assert.equal((await send({ ...REPORT, email: "a@b.c\nBcc: x@y.z" })).status, 400);
  assert.equal((await send({ ...REPORT, message: "broken" })).status, 400);
  assert.equal((await send({ ...REPORT, message: "x".repeat(5001) })).status, 400);
  assert.equal((await send(REPORT, { method: "GET" })).status, 405);
  assert.equal(emails.length, 0);
});

test("an unknown kind counts as a question, and fields are cut to one line", () => {
  const { report } = parseReport({ ...REPORT, kind: "__proto__", page: "/a\n/b", browser: "x".repeat(400) });
  assert.equal(report.kind, "other");
  assert.equal(report.page, "/a /b");
  assert.equal(report.browser.length, 300);
});

test("one network can send five an hour", async () => {
  const { send, emails, later } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await send({ ...REPORT, email: `p${i}@example.com` })).status, 200);
  assert.equal((await send({ ...REPORT, email: "p9@example.com" })).status, 429);
  assert.equal((await send({ ...REPORT, email: "p9@example.com" }, { ip: "198.51.100.1" })).status, 200);
  later(3600_000);
  assert.equal((await send({ ...REPORT, email: "p9@example.com" })).status, 200);
  assert.equal(emails.length, 7);
});

test("a double click is emailed once: the same report has the same key", async () => {
  const { send, emails } = setup();
  await send(REPORT);
  await send(REPORT);
  assert.equal(emails[0].key, emails[1].key);
  await send({ ...REPORT, message: "Something else is wrong too." });
  assert.notEqual(emails[0].key, emails[2].key);
});

test("without an inbox or when Resend refuses, the sender is told to email", async () => {
  assert.equal((await setup({ to: "" }).send(REPORT)).status, 503);
  const res = await setup({ outcome: "retry" }).send(REPORT);
  assert.equal(res.status, 503);
  assert.match(res.body.error, /hello@plan\.video/);
});

test("the network is Caddy's last hop, an IPv6 one by its /64", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9" }, socket: {} }), "9.9.9.9");
  assert.equal(clientIp({ headers: { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" }, socket: {} }), "2001:db8:1:2::/64");
});
