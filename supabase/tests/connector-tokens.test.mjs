// Connector tokens against a real Supabase: what a token Claude (or any OAuth
// client) was granted can still do once migrations/20261015180000_connector_tokens.sql
// is applied and its access token hook is on. Runs against a local stack:
//
//   supabase start            (in a copy of this folder, with the migrations
//                              applied and, in its config.toml:
//                              [auth.hook.custom_access_token]
//                              enabled = true
//                              uri = "pg-functions://postgres/public/connector_access_token")
//   node --test supabase/tests/connector-tokens.test.mjs
//
// It registers a client the way Claude does, consents as a fresh user and
// swaps the code for tokens, then tries them on Supabase Auth, the database,
// Storage, every service that takes a sign-in, and the connector itself.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const URL_ = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
// The local stack's shared secret, to make a token like those issued before the hook.
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "super-secret-jwt-token-with-at-least-32-characters-long";
const SERVICES = fileURLToPath(new URL("../../services/", import.meta.url));
const PASSWORD = "connector-test-password";
const REDIRECT = "http://127.0.0.1:9/callback";

async function call(path, { token, method = "GET", body, form, headers = {} } = {}) {
  const response = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: token === SERVICE ? SERVICE : ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: form ? new URLSearchParams(form) : body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, data, location: response.headers.get("location") };
}

const claimsOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

/** A confirmed user with a password, signed in. */
async function makeUser() {
  const email = `connector-${randomUUID().slice(0, 8)}@connector.test`;
  // Let in from the waitlist first, as everyone is while the app is invite-only.
  const invited = await call("/rest/v1/waitlist", { token: SERVICE, method: "POST", body: { email, invited_at: new Date().toISOString() } });
  assert.ok(invited.status < 300, JSON.stringify(invited.data));
  const made = await call("/auth/v1/admin/users", { token: SERVICE, method: "POST", body: { email, password: PASSWORD, email_confirm: true } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const signedIn = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: PASSWORD } });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
  return { id: made.data.id, email, session: signedIn.data.access_token };
}

/** What Claude does: register, send the person to consent, swap the code. */
async function connect(user) {
  const registered = await call("/auth/v1/oauth/clients/register", {
    method: "POST",
    body: { client_name: "Not Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  assert.ok(registered.status < 300, JSON.stringify(registered.data));
  const clientId = registered.data.client_id;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s", scope: "openid email" });
  const authorize = await call(`/auth/v1/oauth/authorize?${query}`);
  const authorizationId = new URL(authorize.location, URL_).searchParams.get("authorization_id");
  assert.ok(authorizationId, `no consent step: ${authorize.status}`);
  // The consent page reads the request first, which ties it to the person.
  await call(`/auth/v1/oauth/authorizations/${authorizationId}`, { token: user.session });
  const consent = await call(`/auth/v1/oauth/authorizations/${authorizationId}/consent`, { token: user.session, method: "POST", body: { action: "approve" } });
  const code = new URL(consent.data.redirect_url).searchParams.get("code");
  const tokens = await call("/auth/v1/oauth/token", { method: "POST", form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier } });
  assert.equal(tokens.status, 200, JSON.stringify(tokens.data));
  return { clientId, token: tokens.data.access_token, refresh: tokens.data.refresh_token };
}

/** A connector token as Supabase issued them before the hook: the person in `sub`. */
function tokenFromBefore(token) {
  const claims = claimsOf(token);
  const { plan_user: person, ...rest } = claims;
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "HS256", typ: "JWT" })}.${part({ ...rest, sub: person })}`;
  return `${unsigned}.${createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url")}`;
}

/** One request through a service's handler: the status it answers with. */
async function through(handle, token) {
  const req = Readable.from([Buffer.from("{}")]);
  Object.assign(req, { method: "POST", url: "/", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": "2" }, socket: { remoteAddress: "127.0.0.1" } });
  let status = 0;
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    getHeader() {},
    writeHead(code) {
      status = code;
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    on() {},
    once() {},
  };
  try {
    await handle(req, res);
  } catch (error) {
    status = error.status ?? error.statusCode ?? 500;
  }
  return status;
}

let user;
let connector;

before(async () => {
  user = await makeUser();
  connector = await connect(user);
});

describe("a connector's token", () => {
  test("names nobody to the rest of Supabase, and keeps the person aside", () => {
    const claims = claimsOf(connector.token);
    assert.equal(claims.client_id, connector.clientId);
    assert.equal(claims.sub, "00000000-0000-0000-0000-000000000000");
    assert.equal(claims.plan_user, user.id);
    assert.equal(claimsOf(user.session).sub, user.id);
    assert.equal(claimsOf(user.session).client_id, undefined);
  });

  test("can't use Supabase Auth: no password, email, linking, sign-out or factors", async () => {
    const tries = [
      ["/auth/v1/user", "GET"],
      ["/auth/v1/user", "PUT", { password: "taken-over-password" }],
      ["/auth/v1/user", "PUT", { email: `evil-${randomUUID().slice(0, 8)}@connector.test` }],
      ["/auth/v1/user", "PUT", { data: { name: "evil" } }],
      ["/auth/v1/user/identities/authorize?provider=google&skip_http_redirect=true", "GET"],
      ["/auth/v1/logout?scope=global", "POST"],
      ["/auth/v1/factors", "POST", { factor_type: "totp" }],
      ["/auth/v1/reauthenticate", "GET"],
    ];
    for (const [path, method, body] of tries) {
      const { status } = await call(path, { token: connector.token, method, body });
      assert.equal(status, 403, `${method} ${path} answered ${status}`);
    }
    const takeover = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: "taken-over-password" } });
    assert.equal(takeover.status, 400);
    assert.equal((await call("/auth/v1/user", { token: user.session })).status, 200);
  });

  test("can't read or change anything in the database", async () => {
    const tries = [
      ["/rest/v1/user_data?select=id"],
      ["/rest/v1/account_state?select=user_id"],
      ["/rest/v1/account_state", "POST", { user_id: user.id }],
      ["/rest/v1/agent_chats?select=id"],
      ["/rest/v1/post_deliveries?select=id"],
      ["/rest/v1/rpc/has_access", "POST", {}],
      ["/rest/v1/rpc/team_access", "POST", { owner: user.id, workspace: "w" }],
      ["/rest/v1/rpc/toggle_roadmap_vote", "POST", { card: "connector-test" }],
      ["/graphql/v1", "POST", { query: "{ __typename }" }],
    ];
    for (const token of [connector.token, tokenFromBefore(connector.token)]) {
      for (const [path, method = "GET", body] of tries) {
        const { status, data } = await call(path, { token, method, body });
        assert.equal(status, 403, `${method} ${path} answered ${status}: ${JSON.stringify(data)}`);
      }
    }
    assert.equal((await call("/auth/v1/user", { token: user.session })).status, 200, "the account is still there");
  });

  test("can't see, add or remove stored files", async () => {
    const mine = `${user.id}/mine.txt`;
    const put = (token, name) => call(`/storage/v1/object/avatars/${name}`, { token, method: "POST", body: "hi", headers: { "Content-Type": "text/plain", "x-upsert": "true" } });
    assert.equal((await put(user.session, mine)).status, 200);
    const list = await call("/storage/v1/object/list/avatars", { token: connector.token, method: "POST", body: { prefix: user.id } });
    assert.deepEqual(list.data, []);
    assert.notEqual((await put(connector.token, `${user.id}/theirs.txt`)).status, 200);
    const removed = await call("/storage/v1/object/avatars", { token: connector.token, method: "DELETE", body: { prefixes: [mine] } });
    assert.deepEqual(removed.data, []);
    const still = await call("/storage/v1/object/list/avatars", { token: user.session, method: "POST", body: { prefix: user.id } });
    assert.deepEqual(still.data.map((file) => file.name), ["mine.txt"]);
  });

  test("is refused by every service that takes a sign-in, which still takes the user's own", async () => {
    const base = { supabaseUrl: URL_, supabaseAnonKey: ANON, requireInvite: false, clientId: "x", clientKey: "x", clientSecret: "x" };
    const [{ userFor }, { handleBilling }, { handleLinkedIn }, { handleTikTok }, { handleTranscribe }, { handleX }, { handleYouTube }, { createUsers }] = await Promise.all([
      import(`${SERVICES}agent/handler.mjs`),
      import(`${SERVICES}billing/handler.mjs`),
      import(`${SERVICES}linkedin/handler.mjs`),
      import(`${SERVICES}tiktok/handler.mjs`),
      import(`${SERVICES}transcribe/handler.mjs`),
      import(`${SERVICES}x/handler.mjs`),
      import(`${SERVICES}youtube/handler.mjs`),
      import(`${SERVICES}publisher/api.mjs`),
    ]);
    const users = createUsers({ supabaseUrl: URL_, anonKey: ANON, requireInvite: false });
    const handlers = {
      agent: (req) => userFor(req, base),
      billing: (req, res) => handleBilling(req, res, "/api/billing/nothing", { ...base, stripeKey: "sk_x", serviceKey: SERVICE }),
      linkedin: (req, res) => handleLinkedIn(req, res, "/api/linkedin/nothing", base),
      tiktok: (req, res) => handleTikTok(req, res, "/api/tiktok/nothing", base),
      transcribe: (req, res) => handleTranscribe(req, res, { ...base, elevenLabsKey: "x" }),
      x: (req, res) => handleX(req, res, "/api/x/nothing", base),
      youtube: (req, res) => handleYouTube(req, res, "/api/youtube/nothing", base),
      publisher: (req) => users.from(req),
    };
    for (const [name, handle] of Object.entries(handlers)) {
      assert.equal(await through(handle, connector.token), 401, `${name} took the connector's token`);
      assert.equal(await through(handle, tokenFromBefore(connector.token)), 401, `${name} took a connector's token from before the hook`);
      assert.notEqual(await through(handle, user.session), 401, `${name} refused the user's own sign-in`);
    }
  });

  test("is refused by the storage service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "connector-storage-"));
    const envPath = join(dir, "r2.env");
    writeFileSync(envPath, `R2_ACCOUNT_ID=x\nR2_ACCESS_KEY_ID=x\nR2_SECRET_ACCESS_KEY=x\nR2_BUCKET=x\nSUPABASE_URL=${URL_}\nSUPABASE_ANON_KEY=${ANON}\nREQUIRE_INVITE=false\n`);
    const server = spawn(process.execPath, ["server.mjs"], { cwd: `${SERVICES}storage`, env: { ...process.env, STORAGE_ENV: envPath }, stdio: ["ignore", "pipe", "inherit"] });
    try {
      await new Promise((resolve, reject) => {
        server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve());
        server.on("exit", (code) => reject(new Error(`storage exited with ${code}`)));
      });
      const ask = (token) =>
        fetch("http://127.0.0.1:8788/api/storage/usage", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status);
      assert.equal(await ask(connector.token), 401);
      assert.equal(await ask(tokenFromBefore(connector.token)), 401);
      assert.notEqual(await ask(user.session), 401);
    } finally {
      server.kill();
    }
  });

  test("from before the hook, still passes Supabase Auth but only works at the connector", async () => {
    const old = tokenFromBefore(connector.token);
    assert.equal((await call("/auth/v1/user", { token: old })).status, 200, "the made-up token should pass for a real one");
    const { createAuth } = await import(`${SERVICES}mcp/auth.mjs`);
    const auth = createAuth({ supabaseUrl: URL_, supabaseAnonKey: ANON });
    assert.equal((await auth.connector(old))?.userId, user.id);
    assert.equal(await auth.editor(old), null);
    const list = await call("/storage/v1/object/list/avatars", { token: old, method: "POST", body: { prefix: user.id } });
    assert.deepEqual(list.data, []);
  });

  test("still works at the connector, and only there, until the connector is removed", async () => {
    const { createAuth } = await import(`${SERVICES}mcp/auth.mjs`);
    const auth = createAuth({ supabaseUrl: URL_, supabaseAnonKey: ANON });
    assert.deepEqual(
      (({ userId, clientId }) => ({ userId, clientId }))(await auth.connector(connector.token)),
      { userId: user.id, clientId: connector.clientId },
    );
    assert.equal(await auth.editor(connector.token), null);
    assert.equal((await auth.editor(user.session))?.userId, user.id);
    assert.equal(await auth.connector(user.session), null);

    // A refreshed token is made the same way.
    const refreshed = await call("/auth/v1/oauth/token", { method: "POST", form: { grant_type: "refresh_token", refresh_token: connector.refresh, client_id: connector.clientId } });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
    assert.equal(claimsOf(refreshed.data.access_token).sub, "00000000-0000-0000-0000-000000000000");
    assert.equal((await createAuth({ supabaseUrl: URL_, supabaseAnonKey: ANON }).connector(refreshed.data.access_token))?.userId, user.id);

    // Removing the connector ends its session.
    const grants = await call("/auth/v1/user/oauth/grants", { token: user.session });
    assert.equal(grants.status, 200, JSON.stringify(grants.data));
    const removed = await call(`/auth/v1/user/oauth/grants?client_id=${connector.clientId}`, { token: user.session, method: "DELETE" });
    assert.ok(removed.status < 300, JSON.stringify(removed.data));
    assert.equal(await createAuth({ supabaseUrl: URL_, supabaseAnonKey: ANON }).connector(refreshed.data.access_token), null);
  });

  test("forged claims get nowhere", async () => {
    const [head, , signature] = connector.token.split(".");
    const forged = { ...claimsOf(connector.token), plan_user: randomUUID() };
    const token = `${head}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`;
    const { createAuth } = await import(`${SERVICES}mcp/auth.mjs`);
    assert.equal(await createAuth({ supabaseUrl: URL_, supabaseAnonKey: ANON }).connector(token), null);
    assert.equal((await call("/rest/v1/rpc/connector_identity", { token, method: "POST", body: {} })).status, 401);
  });
});

