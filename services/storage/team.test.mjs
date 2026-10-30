import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";

const dir = mkdtempSync(join(tmpdir(), "storage-team-"));
writeFileSync(
  join(dir, "r2.env"),
  ["R2_ACCOUNT_ID=a", "R2_ACCESS_KEY_ID=b", "R2_SECRET_ACCESS_KEY=c", "R2_BUCKET=d", "SUPABASE_URL=https://sb.test", "SUPABASE_ANON_KEY=anon", "REQUIRE_INVITE=false"].join("\n"),
);
process.env.STORAGE_ENV = join(dir, "r2.env");

const { teamActor, server } = await import("./server.mjs");

/** What Supabase says each token's role is in the owner's "brand" workspace. */
const ROLES = { "member-token": { role: "member", level: 4 }, "admin-token": { role: "admin", level: 3 } };
const original = globalThis.fetch;
let asked = 0;
const checked = [];

before(() => {
  globalThis.fetch = async (url, init) => {
    const token = init.headers.Authorization.slice(7);
    if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: MEMBER }), { status: 200 });
    if (url.includes("/rest/v1/user_data")) return new Response(JSON.stringify([{ access_level: 1 }]), { status: 200 });
    if (url.endsWith("/rest/v1/rpc/team_access")) {
      asked++;
      const { owner, workspace } = JSON.parse(init.body);
      return new Response(JSON.stringify(owner === OWNER && workspace === "brand" ? (ROLES[token] ?? null) : null), { status: 200 });
    }
    if (url.endsWith("/rest/v1/rpc/team_files_allowed")) {
      // Another workspace of the owner's has "theirs".
      const { ids } = JSON.parse(init.body);
      checked.push(ids);
      return new Response(JSON.stringify(!ids.some((id) => id.startsWith("theirs"))), { status: 200 });
    }
    return original(url, init);
  };
});

after(() => {
  globalThis.fetch = original;
  server.close();
});

const req = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const me = { id: MEMBER, plan: "free" };

test("a member acts as the workspace's owner, on the owner's plan", async () => {
  assert.deepEqual(await teamActor(req("member-token"), me, { purpose: "posts", id: "x", team: { owner: OWNER, workspace: "brand" } }), {
    id: OWNER,
    plan: "agency",
  });
  assert.deepEqual(await teamActor(req("admin-token"), me, { targets: [{ purpose: "media", id: "y" }], team: { owner: OWNER, workspace: "brand" } }), {
    id: OWNER,
    plan: "pro",
  });
  // Asked once, then kept for a few seconds.
  const before = asked;
  await teamActor(req("member-token"), me, { purpose: "media", id: "z", team: { owner: OWNER, workspace: "brand" } });
  assert.equal(asked, before);
});

test("someone not in the workspace, another workspace, or a project is refused", async () => {
  await assert.rejects(teamActor(req("stranger-token"), me, { purpose: "posts", id: "x", team: { owner: OWNER, workspace: "brand" } }), { status: 403 });
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "posts", id: "x", team: { owner: OWNER, workspace: "other" } }), { status: 403 });
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "projects", id: "x", path: "a", team: { owner: OWNER, workspace: "brand" } }), { status: 400 });
  await assert.rejects(
    teamActor(req("member-token"), me, { targets: [{ purpose: "posts", id: "a" }, { purpose: "projects", id: "b", path: "c" }], team: { owner: OWNER, workspace: "brand" } }),
    { status: 400 },
  );
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "posts", id: "x", team: { owner: "nope", workspace: "brand" } }), { status: 400 });
});

test("a member reaches only their workspace's files, and every purpose named is checked", async () => {
  const team = { owner: OWNER, workspace: "brand" };
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "posts", id: "theirs_1", team }), { status: 403 });
  await assert.rejects(teamActor(req("member-token"), me, { targets: [{ purpose: "posts", id: "mine" }, { purpose: "media", id: "theirs-2-poster" }], team }), { status: 403 });
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "posts", ids: ["mine", "theirs_3"], team }), { status: 403 });
  await assert.rejects(teamActor(req("member-token"), me, { files: [{ id: "theirs_4", size: 1 }], team }), { status: 403 });
  assert.deepEqual(await teamActor(req("member-token"), me, { purpose: "posts", id: "mine_1", team }), { id: OWNER, plan: "agency" });
  assert.deepEqual(checked.at(-1), ["mine_1"]);
  // An empty list of targets doesn't stand in for checking the purpose.
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "projects", id: "x", path: "a", targets: [], team }), { status: 400 });
  await assert.rejects(teamActor(req("member-token"), me, { purpose: "projects", id: "x", path: "a", targets: [{ purpose: "posts", id: "y" }], team }), { status: 400 });
});

test("the owner naming their own workspace is just themselves", async () => {
  const owner = { id: OWNER, plan: "pro" };
  assert.equal(await teamActor(req("owner-token"), owner, { purpose: "posts", id: "x", team: { owner: OWNER, workspace: "brand" } }), owner);
});

test("routes that are each person's own refuse a shared workspace", async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const ask = (path, body) =>
    original(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer member-token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (response) => ({ status: response.status, ...(await response.json()) }));
  const team = { owner: OWNER, workspace: "brand" };
  assert.equal((await ask("/api/storage/list", { purpose: "projects", team })).status, 400);
  assert.equal((await ask("/api/storage/erase", { everything: true, team })).status, 400);
  assert.equal((await ask("/api/storage/upload-url", { purpose: "projects", id: "p", path: "a", size: 1, team })).status, 400);
  assert.equal((await ask("/api/storage/upload-url", { purpose: "projects", id: "p", path: "a", size: 1, targets: [], team })).status, 400);
  assert.equal((await ask("/api/storage/delete", { purpose: "projects", id: "p", targets: [{ purpose: "posts", id: "q" }], team })).status, 400);
  assert.equal((await ask("/api/storage/read-url", { purpose: "posts", id: "p", team: { owner: OWNER, workspace: "other" } })).status, 403);
});
