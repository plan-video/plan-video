//   supabase start            (in a copy of this folder, with the migrations applied)
//   node --test supabase/tests/<file>.test.mjs
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL point them at another stack.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
export const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const DATABASE = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const run = randomUUID().slice(0, 8);
export const address = (name) => `${name}-${run}@posts.test`;
const PASSWORD = "posts-test-password";

export async function call(path, { token = SERVICE, method = "GET", body, prefer } = {}) {
  const response = await fetch(`${URL}${path}`, {
    method,
    headers: {
      apikey: token === SERVICE ? SERVICE : ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

export async function rpc(token, name, args = {}) {
  const { status, data } = await call(`/rest/v1/rpc/${name}`, { token, method: "POST", body: args });
  if (status >= 400) {
    const error = new Error(data?.message || `rpc ${name} failed with ${status}`);
    error.code = data?.code;
    throw error;
  }
  return data;
}

export async function refuses(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

export async function letIn(email) {
  const { status, data } = await call("/rest/v1/waitlist?on_conflict=email", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { email, invited_at: new Date().toISOString() },
  });
  assert.ok(status < 300, JSON.stringify(data));
}

export async function makeUser(name, { letIn: invited = true } = {}) {
  const email = address(name);
  if (invited) await letIn(email);
  const made = await call("/auth/v1/admin/users", { method: "POST", body: { email, password: PASSWORD, email_confirm: true } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const session = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  }).then((response) => response.json());
  assert.ok(session.access_token, JSON.stringify(session));
  return { id: made.data.id, email, token: session.access_token };
}

export async function setLevel(userId, level) {
  const { status } = await call(`/rest/v1/user_data?id=eq.${userId}`, { method: "PATCH", body: { access_level: level } });
  assert.ok(status < 300);
}

export function slice(overrides = {}) {
  return {
    connections: [],
    groups: [],
    queue: [],
    boards: [],
    vault: [],
    signatureId: null,
    templates: [],
    plugs: [],
    captionStyles: [],
    calendars: [{ id: "posts", name: "Posts", color: "sky", createdAt: "2026-10-01T00:00:00.000Z" }],
    library: [],
    ...overrides,
  };
}

export async function saveOwner(owner, payload, base) {
  return call("/rest/v1/account_state?on_conflict=user_id", {
    token: owner.token,
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: owner.id, payload: base === undefined ? payload : { ...payload, base }, updated_at: new Date().toISOString() },
  });
}

/** Runs SQL as postgres and returns psql's unaligned output, every statement's. */
export function sql(text) {
  return execFileSync("psql", [DATABASE, "-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-q", "-f", "-"], { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
