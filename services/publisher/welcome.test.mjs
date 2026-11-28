import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TRIES, composeWelcome, createWelcomes } from "./welcome.mjs";

const T0 = Date.parse("2026-11-28T12:00:00Z");

/** Like publisher_welcomes_due over auth.users and welcome_emails. */
function setup({ people = [{ user_id: "u1", email: "ada@example.com" }], outcome = () => "sent", failUpsert = 0 } = {}) {
  const rows = new Map();
  let upsertFails = failUpsert;
  const db = {
    rows,
    async rpc(name, args) {
      assert.equal(name, "publisher_welcomes_due");
      return people
        .filter((person) => {
          const row = rows.get(person.user_id);
          return !row || (row.sent_at === null && row.attempts < args.max_attempts);
        })
        .map((person) => ({ ...person, attempts: rows.get(person.user_id)?.attempts ?? 0 }));
    },
    async upsert(table, row) {
      assert.equal(table, "welcome_emails");
      if (upsertFails-- > 0) throw new Error("The database refused POST welcome_emails");
      rows.set(row.user_id, { ...row });
    },
  };
  const emails = [];
  const mailer = {
    async send(email) {
      emails.push(email);
      return outcome(email);
    },
  };
  const welcomes = createWelcomes({ db, mailer, publicUrl: "https://plan.video", now: () => T0, log: { error() {} } });
  return { db, emails, welcomes };
}

test("each person is welcomed once", async () => {
  const { db, emails, welcomes } = setup({ people: [{ user_id: "u1", email: "ada@example.com" }, { user_id: "u2", email: "bo@example.com" }] });
  assert.equal(await welcomes.send(), 2);
  assert.equal(await welcomes.send(), 0);
  assert.deepEqual(emails.map((email) => email.to), ["ada@example.com", "bo@example.com"]);
  assert.equal(db.rows.get("u1").sent_at, new Date(T0).toISOString());
});

test("a welcome Resend took but that wasn't noted goes again with the same key, so Resend sends it once", async () => {
  const { emails, welcomes } = setup({ failUpsert: 1 });
  await welcomes.send();
  await welcomes.send();
  assert.equal(emails.length, 2);
  assert.equal(emails[0].key, emails[1].key);
  assert.equal(await welcomes.send(), 0);
});

test("a welcome Resend can't take now is tried again, up to a limit", async () => {
  const { db, emails, welcomes } = setup({ outcome: () => "retry" });
  for (let pass = 0; pass < MAX_TRIES + 2; pass++) await welcomes.send();
  assert.equal(emails.length, MAX_TRIES);
  assert.equal(new Set(emails.map((email) => email.key)).size, 1);
  assert.ok(db.rows.get("u1").sent_at);
});

test("a welcome Resend refuses isn't tried again", async () => {
  const { emails, welcomes } = setup({ outcome: () => "refused" });
  await welcomes.send();
  await welcomes.send();
  assert.equal(emails.length, 1);
});

test("a second pass while one is sending sends nothing more", async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { emails, welcomes } = setup({ outcome: () => held.then(() => "sent") });
  const first = welcomes.send();
  assert.equal(await welcomes.send(), 0);
  release();
  assert.equal(await first, 1);
  assert.equal(emails.length, 1);
});

test("the email's links and pictures are on the copy's own site", () => {
  const { html, text } = composeWelcome({ publicUrl: "https://posts.example.com/" });
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(urls.length > 10);
  for (const url of urls.filter((url) => !url.startsWith("https://x.com/"))) assert.match(url, /^https:\/\/posts\.example\.com\/[a-z]/);
  assert.match(text, /https:\/\/posts\.example\.com\/dashboard/);
  assert.match(html, /posts\.example\.com\/mcp<\/a>/);
});
