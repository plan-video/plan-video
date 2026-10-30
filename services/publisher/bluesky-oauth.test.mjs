import assert from "node:assert/strict";
import test from "node:test";

import { blueskyNodeProblem, createBlueskyOAuth, makeBlueskyKey } from "./bluesky-oauth.mjs";
import { fakeDb } from "./fake-db.mjs";

const KEY = Buffer.alloc(32, 3).toString("base64");
const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const PDS = "https://pds.example";
const ISSUER = "https://entryway.example";

test("a Node without its undici version can't sign in with Bluesky, and says so", () => {
  // The server's distro Node: same version, no undici reported.
  assert.match(blueskyNodeProblem({ node: "22.22.1" }), /undici none/);
  assert.match(blueskyNodeProblem({ node: "20.5.0", undici: "5.22.1" }), /6\.11\.1/);
  assert.match(blueskyNodeProblem({ node: "20.12.0", undici: "6.11.0" }), /6\.11\.1/);
  assert.equal(blueskyNodeProblem({ node: "20.12.0", undici: "6.11.1" }), null);
  assert.equal(blueskyNodeProblem({ node: "22.22.1", undici: "6.23.0" }), null);
  assert.equal(blueskyNodeProblem({ node: "24.0.0", undici: "7.0.0" }), null);
  assert.equal(blueskyNodeProblem(), null, "the Node running these tests should be able to");
});

test("a Bluesky handle that is an internal or non-public address can't make the server fetch it", async () => {
  // No fetch stand-in: the guard itself must refuse these, by policy (http, a
  // custom port) or at connect (a loopback, link-local or private address), so
  // none of the publisher's own services is ever reached.
  const oauth = await createBlueskyOAuth({ db: fakeDb(), sealKey: KEY, privateJwk: await makeBlueskyKey(), publicUrl: "https://plan.video" });
  for (const target of ["http://127.0.0.1:8798", "http://169.254.169.254", "https://127.0.0.1", "https://10.0.0.1", "https://192.168.1.1:8798", "https://[::1]"]) {
    await assert.rejects(oauth.authorize("u1", target), `expected ${target} to be refused`);
  }
});

/** One Bluesky account and its server, in place of the network. Keeps what it was asked. */
function standInBluesky(t) {
  const server = { states: [], tokens: 0, revoked: [], used: [] };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    const { origin, pathname } = new URL(request.url);
    const form = async () => new URLSearchParams(await request.text());
    if (request.url === `https://plc.directory/${encodeURIComponent(DID)}`) {
      return Response.json({ id: DID, service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
    }
    if (origin === PDS && pathname === "/.well-known/oauth-protected-resource") return Response.json({ resource: PDS, authorization_servers: [ISSUER] });
    if (origin === PDS && pathname.startsWith("/xrpc/")) {
      server.used.push(request.headers.get("authorization"));
      return Response.json({});
    }
    if (origin !== ISSUER) return new Response(null, { status: 404 });
    if (pathname === "/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        pushed_authorization_request_endpoint: `${ISSUER}/oauth/par`,
        require_pushed_authorization_requests: true,
        token_endpoint: `${ISSUER}/oauth/token`,
        revocation_endpoint: `${ISSUER}/oauth/revoke`,
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["ES256"],
        dpop_signing_alg_values_supported: ["ES256"],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
    }
    if (pathname === "/oauth/par") {
      server.states.push((await form()).get("state"));
      return Response.json({ request_uri: `urn:ietf:params:oauth:request_uri:${server.states.length}`, expires_in: 300 }, { status: 201 });
    }
    if (pathname === "/oauth/token") {
      const n = ++server.tokens;
      return Response.json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, token_type: "DPoP", scope: "atproto transition:generic", sub: DID, expires_in: 3600 });
    }
    if (pathname === "/oauth/revoke") {
      server.revoked.push((await form()).get("token"));
      return Response.json({});
    }
    return new Response(null, { status: 404 });
  });
  return server;
}

/** The callback's query for the last sign-in the server was asked to start. */
const comeBack = (server) => new URLSearchParams({ state: server.states.at(-1), iss: ISSUER, code: "code" }).toString();

async function signIn(oauth, server, userId) {
  await oauth.authorize(userId, DID);
  return oauth.callback({ person: userId, owner: userId }, comeBack(server));
}

/** The token the person's posts go out with. */
async function tokenOf(oauth, server, userId) {
  const send = await oauth.sender(userId, DID);
  await send("com.atproto.repo.createRecord", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return server.used.at(-1);
}

test("people who connect the same Bluesky account each keep their own session", async (t) => {
  const server = standInBluesky(t);
  const db = fakeDb();
  const oauth = await createBlueskyOAuth({ db, sealKey: KEY, privateJwk: await makeBlueskyKey(), publicUrl: "https://plan.video" });

  await signIn(oauth, server, "u1");
  await signIn(oauth, server, "u2");
  // The second sign-in ended nobody's session.
  assert.deepEqual(server.revoked, []);
  assert.equal(await tokenOf(oauth, server, "u1"), "DPoP access-1");
  assert.equal(await tokenOf(oauth, server, "u2"), "DPoP access-2");

  // Signing in again replaces only the person's own session.
  await signIn(oauth, server, "u1");
  assert.deepEqual(server.revoked, ["access-1"]);
  assert.equal(await tokenOf(oauth, server, "u1"), "DPoP access-3");
  assert.equal(await tokenOf(oauth, server, "u2"), "DPoP access-2");

  // So does disconnecting.
  await oauth.revoke("u1", DID);
  assert.deepEqual(server.revoked, ["access-1", "access-3"]);
  assert.deepEqual(db.tables.bluesky_sessions.map((row) => row.user_id), ["u2"]);
  await assert.rejects(oauth.sender("u1", DID), /expired/);
  assert.equal(await tokenOf(oauth, server, "u2"), "DPoP access-2");
});

test("a Bluesky sign-in finishes only for the person who started it", async (t) => {
  const server = standInBluesky(t);
  const oauth = await createBlueskyOAuth({ db: fakeDb(), sealKey: KEY, privateJwk: await makeBlueskyKey(), publicUrl: "https://plan.video" });
  await oauth.authorize("u1", DID);
  await assert.rejects(oauth.callback({ person: "u2", owner: "u2" }, comeBack(server)), /didn't finish/);
  assert.equal(server.tokens, 0);
  // Still there for the person who started it.
  assert.equal((await oauth.callback({ person: "u1", owner: "u1" }, comeBack(server))).did, DID);
});

test("a sign-in ticket attaches only that Bluesky account, for that person and workspace, for 15 minutes", async (t) => {
  const server = standInBluesky(t);
  const oauth = await createBlueskyOAuth({ db: fakeDb(), sealKey: KEY, privateJwk: await makeBlueskyKey(), publicUrl: "https://plan.video" });
  // An admin signing in for workspace "brand" of u1's.
  const admin = { person: "u2", owner: "u1", workspace: "brand" };
  await oauth.authorize("u1", DID);
  const { ticket } = await oauth.callback(admin, comeBack(server));
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  assert.match(oauth.openTicket(admin, DID, ticket).nonce, /^[0-9a-f]{24}$/);
  assert.equal(oauth.openTicket({ ...admin, person: "u3" }, DID, ticket), null);
  assert.equal(oauth.openTicket({ ...admin, workspace: "other" }, DID, ticket), null);
  assert.equal(oauth.openTicket({ person: "u1", owner: "u1" }, DID, ticket), null);
  assert.equal(oauth.openTicket(admin, "did:plc:other", ticket), null);
  assert.equal(oauth.openTicket(admin, DID, undefined), null);
  // One of the older kind, without a nonce, opens for nobody.
  assert.equal(oauth.openTicket(admin, DID, ticket.replace(/\.[0-9a-f]{24}\./, ".")), null);
  t.mock.method(Date, "now", () => now + 15 * 60_000 + 1);
  assert.equal(oauth.openTicket(admin, DID, ticket), null);
});
