import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { HOLD_MS, LOGIN_AHEAD_MS, STALE_MS, compose, createMailer, createNotices } from "./notices.mjs";
import { createWorker } from "./worker.mjs";

const T0 = Date.parse("2026-10-12T16:00:00Z");
const DAY = 24 * 60 * 60_000;
const VIDEO = { key: "posts/u1/p1", size: 10, type: "video/mp4", kind: "video" };

const scheduled = (post = {}, extra = {}) => ({
  user_id: "u1",
  workspace_id: "w1",
  time_zone: "Europe/Berlin",
  connections: [{ id: "li1", platform: "linkedin" }],
  post: { id: "p1", day: "2026-10-12", start: "18:00", timeZone: "Europe/Berlin", status: "scheduled", platforms: ["linkedin"], title: "Launch day", ...post },
  ...extra,
});

function setup({ posts = [scheduled()], send, reply, logins = {}, outcome = () => "sent", recipients = { u1: { email: "ada@example.com", name: "Ada" } } } = {}) {
  let clock = T0;
  const db = fakeDb({ posts, recipients, accounts: { "u1:li1": { handle: "Ada Lovelace", platform: "linkedin" } } });
  const emails = [];
  const mailer = {
    async send(email) {
      emails.push(email);
      return outcome(email);
    },
  };
  const vault = {
    fresh: async () => ({ platform: "linkedin", session: { accessToken: "a" } }),
    read: async (userId, connectionId) => (logins[`${userId}:${connectionId}`] ? { platform: "linkedin", session: logins[`${userId}:${connectionId}`] } : null),
  };
  const notices = createNotices({ db, vault, mailer, now: () => clock, log: { error() {} } });
  const linkedin = {
    needsFile: false,
    async send(ctx) {
      return send ? send(ctx) : { state: "sent", publishId: "li-id" };
    },
    ...(reply ? { reply } : {}),
  };
  const worker = createWorker({
    db,
    vault,
    media: { postFile: async () => ({ ...VIDEO, id: "p1" }) },
    networks: { linkedin },
    notices,
    now: () => clock,
    log: { error() {} },
  });
  return { db, worker, notices, emails, advance: (ms) => (clock += ms) };
}

const refused = () => {
  throw new PublishError("LinkedIn turned the post down: the text is too long.");
};

test("a scheduled post that fails is emailed once, after a short wait, naming the post, account, time and reason", async () => {
  const { worker, notices, emails, advance } = setup({ send: refused });
  await worker.tick();
  assert.equal(await notices.send(), 0, "not straight away");
  advance(HOLD_MS);
  assert.equal(await notices.send(), 1);
  advance(HOLD_MS);
  await worker.tick();
  assert.equal(await notices.send(), 0, "not twice");
  assert.equal(emails.length, 1);
  const [email] = emails;
  assert.equal(email.to, "ada@example.com");
  assert.equal(email.subject, "“Launch day” didn't go out");
  assert.match(email.text, /LinkedIn · Ada Lovelace · Mon 12 Oct, 18:00/);
  assert.match(email.text, /the text is too long/);
  assert.match(email.text, /\/dashboard\?dashboard=failed/);
  assert.match(email.html, /the text is too long/);
  assert.ok(email.key.startsWith("notices-"));
});

test("a send that fails for now isn't emailed until its last try fails", async () => {
  let tries = 0;
  const { worker, notices, emails, advance } = setup({
    send: () => {
      tries++;
      throw new PublishError("Couldn't reach LinkedIn. Trying again soon.", { retry: true });
    },
  });
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
  for (let step = 0; step < 6; step++) {
    advance(30 * 60_000);
    await worker.tick();
  }
  assert.equal(tries, 4);
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /Couldn't reach LinkedIn/);
});

test("a failure fixed while someone has plan.video open isn't emailed", async () => {
  let fail = true;
  const { db, worker, notices, emails, advance } = setup({ send: (ctx) => (fail ? refused(ctx) : { state: "sent", publishId: "li-id" }) });
  await worker.tick();
  fail = false;
  await worker.request("u1", "p1");
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "sent");
  advance(HOLD_MS);
  assert.equal(await notices.send(), 0);
  assert.equal(emails.length, 0);
  assert.ok(db.tables.publisher_notices.every((row) => row.sent_at), "let go, not left to be looked at again");
});

test("Post now failing in front of the person who pressed it isn't emailed", async () => {
  const { worker, notices, emails, advance } = setup({ posts: [scheduled({ status: "draft" })], send: refused });
  await worker.request("u1", "p1");
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
});

test("a post paused or deleted before its time isn't emailed", async () => {
  const posts = [scheduled()];
  const { db, worker, notices, emails, advance } = setup({ posts });
  await worker.plan();
  posts[0].post.paused = true;
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
});

test("a post with no account to go out from is emailed with the post's title", async () => {
  const { notices, worker, emails, advance } = setup({ posts: [scheduled({}, { connections: [] })] });
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /Launch day/);
  assert.match(emails[0].text, /Connect LinkedIn in Connections/);
});

test("everything of a person's that failed together goes in one email", async () => {
  const second = scheduled({ id: "p2", title: "Follow-up" });
  const { worker, notices, emails, advance } = setup({ posts: [scheduled(), second], send: refused });
  await worker.tick();
  advance(HOLD_MS);
  assert.equal(await notices.send(), 1);
  assert.equal(emails[0].subject, "2 posts didn't go out");
  assert.match(emails[0].text, /Launch day[\s\S]*Follow-up/);
});

test("a send cut off by a restart is emailed, since it may have gone out", async () => {
  const { db, worker, notices, emails, advance } = setup();
  await db.insertNew("post_deliveries", [{
    user_id: "u1", workspace_id: "w1", post_id: "p1", occurrence: "once", platform: "linkedin", connection_id: "li1",
    state: "sending", attempts: 1, due_at: new Date(T0).toISOString(), next_at: new Date(T0).toISOString(), updated_at: new Date(T0 - 60 * 60_000).toISOString(),
  }]);
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /may have gone out/);
});

test("an email Resend can't take now is tried again later; one it refuses isn't", async () => {
  let answer = "retry";
  const { worker, notices, emails, db, advance } = setup({ send: refused, outcome: () => answer });
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(db.tables.publisher_notices[0].attempts, 1);
  assert.equal(db.tables.publisher_notices[0].sent_at, null);
  answer = "refused";
  await notices.send();
  await notices.send();
  assert.equal(emails.length, 2, "refused once, then let go");
});

test("a notice that couldn't be emailed for a day is let go: it would come too late to help", async () => {
  const { worker, notices, emails, advance } = setup({ send: refused });
  await worker.tick();
  advance(STALE_MS + HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
});

test("someone without an email address gets nothing, and the notice is let go", async () => {
  const { worker, notices, emails, db, advance } = setup({ send: refused, recipients: {} });
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
  assert.ok(db.tables.publisher_notices[0].sent_at);
});

test("someone who turned these emails off in the account settings gets nothing", async () => {
  const { worker, notices, emails, db, advance } = setup({ send: refused, recipients: { u1: { email: "ada@example.com", name: "Ada", alerts: false } } });
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
  assert.ok(db.tables.publisher_notices[0].sent_at);
});

test("every email says where to turn them off", async () => {
  const { worker, notices, emails, advance } = setup({ send: refused });
  await worker.tick();
  advance(HOLD_MS);
  await notices.send();
  assert.match(emails[0].html, /href="https:\/\/plan\.video\/dashboard\?dashboard=account"[^>]*>Turn them off<\/a>/);
  assert.match(emails[0].text, /Turn them off in your account settings: https:\/\/plan\.video\/dashboard\?dashboard=account/);
});

const linkedinLogin = (db, updated = new Date(T0 - DAY).toISOString()) =>
  db.upsert("social_tokens", { user_id: "u1", connection_id: "li1", platform: "linkedin", sealed: "x", updated_at: updated });

test("a LinkedIn login that runs out within a week is emailed once, with the day", async () => {
  const { db, notices, emails, advance } = setup({ posts: [], logins: { "u1:li1": { accessToken: "a", refreshToken: "", expiresAt: T0 + 3 * DAY } } });
  await linkedinLogin(db);
  assert.equal(await notices.watchLogins(), 1);
  await notices.watchLogins();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Your LinkedIn login runs out on 15 October");
  assert.match(emails[0].text, /Ada Lovelace/);
  assert.match(emails[0].text, /\/dashboard\?dashboard=connections/);
});

test("a LinkedIn login that ran out is emailed as ran out", async () => {
  const { db, notices, emails, advance } = setup({ posts: [], logins: { "u1:li1": { accessToken: "a", refreshToken: "", expiresAt: T0 - 60_000 } } });
  await linkedinLogin(db);
  await notices.watchLogins();
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails[0].subject, "Your LinkedIn login ran out");
  assert.match(emails[0].text, /LinkedIn · Ada Lovelace/);
  assert.match(emails[0].text, /ran out on 12 October/);
});

test("LinkedIn logins that renew themselves, are far off, ran out long ago or belong to a removed account aren't emailed", async () => {
  for (const session of [
    { accessToken: "a", refreshToken: "r", expiresAt: T0 + DAY },
    { accessToken: "a", refreshToken: "", expiresAt: T0 + LOGIN_AHEAD_MS + DAY },
    { accessToken: "a", refreshToken: "", expiresAt: T0 - LOGIN_AHEAD_MS - DAY },
  ]) {
    const { db, notices } = setup({ posts: [], logins: { "u1:li1": session } });
    await linkedinLogin(db);
    assert.equal(await notices.watchLogins(), 0);
  }
  const { db, notices } = setup({ posts: [], logins: { "u1:gone": { accessToken: "a", refreshToken: "", expiresAt: T0 + DAY } } });
  db.tables.social_tokens.push({ user_id: "u1", connection_id: "gone", platform: "linkedin", sealed: "x", updated_at: new Date(T0).toISOString() });
  await notices.watchLogins();
  assert.equal(db.tables.publisher_notices.length, 0);
});

test("a LinkedIn account connected again before the email goes isn't emailed", async () => {
  const { db, notices, emails, advance } = setup({ posts: [], logins: { "u1:li1": { accessToken: "a", refreshToken: "", expiresAt: T0 + DAY } } });
  await linkedinLogin(db);
  await notices.watchLogins();
  await linkedinLogin(db, new Date(T0 + 60_000).toISOString());
  advance(HOLD_MS);
  await notices.send();
  assert.equal(emails.length, 0);
});

test("old notices are pruned", async () => {
  const { worker, notices, db, advance } = setup({ send: refused });
  await worker.tick();
  advance(31 * DAY);
  await notices.prune();
  assert.equal(db.tables.publisher_notices.length, 0);
});

test("what the email says is escaped", () => {
  const { html, subject } = compose([
    { id: 1, kind: "failed", detail: { delivery: "d1", post_id: "p1", post: "<b>Hi</b> & bye", platform: "x", connection: "c1", due: "2026-10-12T16:00:00Z", zone: "UTC", error: "<script>" } },
  ]);
  assert.equal(subject, "“<b>Hi</b> & bye” didn't go out");
  assert.doesNotMatch(html, /<script>|<b>Hi/);
  assert.match(html, /&lt;b&gt;Hi&lt;\/b&gt; &amp; bye/);
});

test("the mailer sends through Resend with an idempotency key, and sorts its answers", async () => {
  const sent = [];
  const answers = [200, 503, 422];
  const mailer = createMailer({
    apiKey: "re_test",
    from: "plan.video <hello@plan.video>",
    log: { error() {} },
    fetch: async (url, init) => {
      sent.push({ url, init });
      return new Response("{}", { status: answers.shift() });
    },
  });
  const email = { to: "ada@example.com", subject: "s", html: "<p>h</p>", text: "t", key: "notices-1" };
  assert.equal(await mailer.send(email), "sent");
  assert.equal(await mailer.send(email), "retry");
  assert.equal(await mailer.send(email), "refused");
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].init.headers.Authorization, "Bearer re_test");
  assert.equal(sent[0].init.headers["Idempotency-Key"], "notices-1");
  assert.deepEqual(JSON.parse(sent[0].init.body), { from: "plan.video <hello@plan.video>", to: ["ada@example.com"], subject: "s", html: "<p>h</p>", text: "t" });
});

test("a thread's follow-up that fails is emailed, saying the post went out", async () => {
  const thread = [{ id: "a", text: "More under it", delay: 0 }];
  const reply = () => {
    throw new PublishError("LinkedIn refused the request.");
  };
  const { db, worker, notices, emails, advance } = setup({ posts: [scheduled({ thread })], reply });
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "sent");
  assert.equal(db.tables.post_replies[0].state, "failed");
  advance(HOLD_MS);
  assert.equal(await notices.send(), 1);
  const [email] = emails;
  assert.equal(email.subject, "Part of the thread under “Launch day” didn't go out");
  assert.match(email.text, /The post went out/);
  assert.match(email.text, /Follow-up 1 of the thread didn't go out on LinkedIn\. LinkedIn refused the request\./);
  assert.match(email.text, /\/dashboard\?dashboard=posts/);
});
