// Runs only against a local Supabase stack (supabase start, migrations applied); skipped otherwise.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, test } from "node:test";

import { createDb } from "./db.mjs";
import { createPlanLimits } from "./plans.mjs";
import { createWorker } from "./worker.mjs";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const reachable = await fetch(`${URL}/rest/v1/`, { headers: { apikey: SERVICE } })
  .then((response) => response.ok)
  .catch(() => false);

async function call(path, { token = SERVICE, method = "GET", body, prefer } = {}) {
  const response = await fetch(`${URL}${path}`, {
    method,
    headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

function post(id, minutes, extra = {}) {
  const at = new Date(Math.floor(Date.now() / 60_000) * 60_000 + minutes * 60_000);
  return {
    id,
    title: id,
    day: at.toISOString().slice(0, 10),
    start: at.toISOString().slice(11, 16),
    allDay: false,
    timeZone: "UTC",
    status: "scheduled",
    platforms: ["x"],
    recurrence: null,
    recurrenceExceptions: [],
    sendFrom: new Date(Date.now() - 2 * 60_000).toISOString(),
    ...extra,
  };
}

describe("the publisher on a real database", { skip: !reachable && "no local Supabase" }, () => {
  let person;
  let worker;
  const sent = [];
  const errors = [];
  const db = createDb({ url: URL, serviceKey: SERVICE });

  const save = (data) => call("/rest/v1/posts", { token: person.token, method: "POST", body: { owner_id: person.id, id: data.id, workspace_id: "default", data }, prefer: "return=minimal" });
  const row = async (id) => (await call(`/rest/v1/posts?select=*&owner_id=eq.${person.id}&id=eq.${id}`)).data[0];
  const look = async (id) => (await call(`/rest/v1/post_schedule?select=*&owner_id=eq.${person.id}&post_id=eq.${id}`)).data[0];
  const deliveries = async (id) => (await call(`/rest/v1/post_deliveries?select=*&user_id=eq.${person.id}&post_id=eq.${id}`)).data;

  before(async () => {
    const email = `publisher-${randomUUID().slice(0, 8)}@posts.test`;
    const made = await call("/auth/v1/admin/users", { method: "POST", body: { email, password: "publisher-test", email_confirm: true } });
    const session = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "publisher-test" }) }).then((response) => response.json());
    person = { id: made.data.id, token: session.access_token };
    await call(`/rest/v1/user_data?id=eq.${person.id}`, { method: "PATCH", body: { access_level: 2 } });
    const state = await call("/rest/v1/account_state", {
      token: person.token,
      method: "POST",
      body: {
        user_id: person.id,
        payload: {
          revision: "r1",
          timeZone: "UTC",
          workspaces: { active: "default", list: [{ id: "default", name: "Mine", color: "sky", createdAt: "2026-10-01T00:00:00Z", members: [] }] },
          notifications: { read: [], cleared: [], seen: {} },
          slices: { default: { connections: [{ id: "x1", platform: "x", handle: "me" }], groups: [], queue: [], boards: [], vault: [], signatureId: null, templates: [], plugs: [], captionStyles: [], calendars: [], library: [] } },
        },
      },
    });
    assert.ok(state.status < 300, JSON.stringify(state.data));
    const x = {
      needsFile: false,
      async send(ctx) {
        sent.push(ctx.post.id);
        return { state: "sent", publishId: `x-${ctx.post.id}` };
      },
    };
    worker = createWorker({
      db,
      vault: { fresh: async () => ({ session: {} }) },
      media: { postFile: async () => null },
      networks: { x },
      planLimits: createPlanLimits({ db, log: { error: (...args) => errors.push(args) } }),
      log: { error: (...args) => errors.push(args) },
    });
  });

  test("a post due now goes out, is marked posted, and then has nothing left to look at", async () => {
    assert.equal((await save(post("now", 0))).status, 201);
    assert.equal((await save(post("later", 30))).status, 201);
    await worker.tick();
    assert.deepEqual(sent, ["now"], JSON.stringify(errors));
    assert.equal((await deliveries("now"))[0].state, "sent");
    assert.equal((await row("now")).data.status, "posted");
    assert.equal(Date.parse((await look("later")).next_run_at), Date.parse(`${post("later", 30).day}T${post("later", 30).start}:00Z`));
    await worker.tick();
    assert.equal((await look("now")).next_run_at, null);
    assert.ok((await look("now")).planned_through);
    assert.deepEqual(errors, []);
  });

  test("an edit over the version read makes the post due again, and its next look follows", async () => {
    const before = await row("later");
    const moved = post("later", 45);
    const edited = await call(`/rest/v1/posts?owner_id=eq.${person.id}&id=eq.later&version=eq.${before.version}`, { token: person.token, method: "PATCH", body: { data: moved }, prefer: "return=representation" });
    assert.equal(edited.data[0].version, before.version + 1);
    assert.ok(Date.parse((await look("later")).next_run_at) <= Date.now() + 1000);
    await worker.tick();
    assert.equal(Date.parse((await look("later")).next_run_at), Date.parse(`${moved.day}T${moved.start}:00Z`));
    assert.ok(worker.nextRun() === null || worker.nextRun() > Date.now());
  });

  test("a waiting post is kept with until when it stops waiting; a deleted one leaves nothing kept", async () => {
    const waiting = (await call(`/rest/v1/publisher_waiting?select=*&user_id=eq.${person.id}`)).data;
    const later = waiting.find((item) => item.post_id === "later");
    assert.ok(later, JSON.stringify(waiting));
    assert.equal(later.over, false);
    const start = Date.parse(`${post("later", 45).day}T${post("later", 45).start}:00Z`);
    assert.equal(Date.parse(later.until), start - 5 * 60_000);
    const current = await row("later");
    await call(`/rest/v1/posts?owner_id=eq.${person.id}&id=eq.later&version=eq.${current.version}`, { token: person.token, method: "PATCH", body: { deleted_at: new Date().toISOString() } });
    await worker.tick();
    assert.deepEqual((await call(`/rest/v1/publisher_waiting?select=*&user_id=eq.${person.id}`)).data, []);
    assert.equal((await look("later")).next_run_at, null);
  });

  test("Post now sends a draft at once, and marks it posted", async () => {
    await save(post("draft", 120, { status: "draft" }));
    await worker.tick();
    await worker.request(person.id, "draft");
    await worker.tick();
    assert.ok(sent.includes("draft"));
    assert.equal((await row("draft")).data.status, "posted");
  });

  test("the hourly look leaves a right next look alone and puts a wrong one right", async () => {
    await save(post("series", 10, { recurrence: "every:1:day" }));
    await worker.tick();
    const right = (await look("series")).next_run_at;
    // It reads every person's posts in this database; only this one's are judged here.
    await worker.sweep();
    assert.equal((await look("series")).next_run_at, right);
    const current = await row("series");
    await db.rpc("publisher_schedule", { items: [{ user_id: person.id, post_id: "series", version: current.version, next_run_at: "2031-01-01T00:00:00Z", planned_through: null }] });
    assert.ok((await worker.sweep()) >= 1);
    assert.ok(Date.parse((await look("series")).next_run_at) <= Date.now() + 1000);
    await worker.tick();
    assert.equal(Date.parse((await look("series")).next_run_at), Date.parse(`${post("series", 10).day}T${post("series", 10).start}:00Z`));
  });
});
