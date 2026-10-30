/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The R2 secret never leaves this server, and every key it signs sits under the
// caller's own id, or a shared workspace owner's (see teamActor).
// Waiting post files (posts/) count against the plan; sent/ ones only against a much larger
// ceiling, and only a post the publisher says went out can put files there (see sentFiles).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ENV_PATH = process.env.STORAGE_ENV || "/etc/plan-video/r2.env";
const HOST = "127.0.0.1";
const PORT = 8788;
const LINK_SECONDS = 15 * 60;
const BODY_MAX = 64 * 1024;

const MiB = 1024 * 1024;
const GB = 1000 ** 3;
const PLANS = ["free", "creator", "pro", "agency"];
const QUOTAS = { free: 5 * GB, creator: 50 * GB, pro: 150 * GB, agency: 250 * GB };
/** Far above what real posting fills: it only stops abuse. */
const SENT_QUOTAS = { free: 50 * GB, creator: 500 * GB, pro: 500 * GB, agency: 500 * GB };
const IMAGE_MAX = 8 * MiB;
const VIDEO_MAX = 500 * MiB;
const PROJECT_FILE_MAX = 500 * MiB;
const DELETE_MAX = 200;
const READ_MAX = 100;
const SETTLE_MAX = 100;

const MEDIA_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
};
const PROJECT_TYPE = "application/octet-stream";
const PURPOSES = new Set(["media", "posts", "projects"]);
/** Not a purpose: nobody names it but this server. */
const SENT = "sent";
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv(ENV_PATH);
for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
  if (!env[key]) throw new Error(`Missing ${key} in ${ENV_PATH}`);
}
const REQUIRE_INVITE = env.REQUIRE_INVITE !== "false";
const BUCKET = env.R2_BUCKET;

// R2_ENDPOINT names any S3-compatible store outright; otherwise it is the account's R2
// address in R2_JURISDICTION ("eu" when unset, "fedramp", or "default" for none).
// The publisher's media.mjs reads the same two settings from the same file.
function r2Endpoint() {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT;
  const jurisdiction = env.R2_JURISDICTION || "eu";
  return `https://${env.R2_ACCOUNT_ID}.${jurisdiction === "default" ? "" : `${jurisdiction}.`}r2.cloudflarestorage.com`;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: r2Endpoint(),
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Rate limits live in memory: a restart only forgives a few minutes.

const windows = new Map();

function limit(name, max, seconds) {
  const now = Date.now();
  const entry = windows.get(name);
  if (!entry || entry.reset <= now) {
    windows.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, "Too many requests. Try again in a few minutes.");
}

setInterval(() => {
  const now = Date.now();
  for (const [name, entry] of windows) if (entry.reset <= now) windows.delete(name);
  for (const [token, entry] of sessions) if (entry.until <= now) sessions.delete(token);
  for (const userId of [...holds.keys()]) holdsOf(userId);
}, 60_000).unref();

// Supabase's answer for a token is cached a minute.

const sessions = new Map();

// OAuth-client tokens (Claude's connector, say) carry `client_id` and only work at /mcp.
function grantedToApp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.client_id != null;
  } catch {
    return false;
  }
}

async function supabaseCall(path, token, init = {}) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000),
  });
}

const tokenOf = (req) => (req?.headers?.authorization ?? "").slice(7).trim();

async function userFor(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to upload.");

  const cached = sessions.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall("/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to upload.");
  const user = await res.json();
  if (typeof user?.id !== "string" || !ID.test(user.id)) throw new Refused(401, "Sign in to upload.");

  if (REQUIRE_INVITE) {
    const access = await supabaseCall("/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  const known = { id: user.id, plan: await planOf(user.id, token) };
  if (sessions.size > 5000) sessions.clear();
  sessions.set(token, { user: known, until: Date.now() + 60_000 });
  return known;
}

/** 1 Free, 2 Creator, 3 Pro, 4 Agency. An unreadable row counts as Free, so an outage never grants space. */
async function planOf(userId, token) {
  const res = await supabaseCall(`/rest/v1/user_data?select=access_level&id=eq.${userId}`, token);
  if (!res.ok) return "free";
  const [row] = await res.json().catch(() => []);
  const level = Math.trunc(Number(row?.access_level)) || 1;
  return PLANS[Math.min(PLANS.length, Math.max(1, level)) - 1];
}

// A request naming `team` ({ owner, workspace }) runs as the owner, on the owner's plan,
// once Supabase confirms the caller is in that workspace. Projects stay each person's own.

const TEAM_PURPOSES = new Set(["media", "posts"]);
const teams = new Map();

async function teamActor(req, user, body) {
  const team = body?.team;
  const owner = typeof team?.owner === "string" ? team.owner : "";
  const workspace = typeof team?.workspace === "string" ? team.workspace : "";
  if (!UUID.test(owner) || !ID.test(workspace)) throw new Refused(400, "That isn't a workspace.");
  // Every purpose the request names, at the top and in each target. Only settle names none: it moves posts.
  if (body.targets !== undefined && (!Array.isArray(body.targets) || body.targets.length === 0)) throw new Refused(400, "That file can't be stored.");
  const purposes = [...(body.purpose !== undefined ? [body.purpose] : []), ...(body.targets ?? []).map((target) => target?.purpose)];
  if (!purposes.every((purpose) => TEAM_PURPOSES.has(purpose))) throw new Refused(400, "That file can't be stored.");
  if (owner === user.id) return user;
  const token = tokenOf(req);
  const key = `${token}\n${owner}\n${workspace}`;
  let known = teams.get(key);
  if (!known || known.until <= Date.now()) {
    const res = await supabaseCall("/rest/v1/rpc/team_access", token, { method: "POST", body: JSON.stringify({ owner, workspace }) });
    if (!res.ok) throw new Refused(503, "Cloud storage can't check this workspace right now.");
    const found = await res.json().catch(() => null);
    const level = Math.trunc(Number(found?.level)) || 1;
    known = {
      actor: found && (found.role === "admin" || found.role === "member") ? { id: owner, plan: PLANS[Math.min(PLANS.length, Math.max(1, level)) - 1] } : null,
      until: Date.now() + 10_000,
    };
    if (teams.size > 5000) teams.clear();
    teams.set(key, known);
  }
  if (!known.actor) throw new Refused(403, "You're not in this workspace anymore.");
  // The owner's folder holds every workspace of theirs: only this one's files, or new ones, are reached.
  const ids = [
    body.id,
    ...(Array.isArray(body.ids) ? body.ids : []),
    ...(body.targets ?? []).map((target) => target?.id),
    ...(Array.isArray(body.files) ? body.files.map((file) => file?.id) : []),
  ].filter((id) => typeof id === "string" && ID.test(id));
  if (ids.length) {
    const res = await supabaseCall("/rest/v1/rpc/team_files_allowed", token, { method: "POST", body: JSON.stringify({ owner, workspace, ids }) });
    if (!res.ok) throw new Refused(503, "Cloud storage can't check this workspace right now.");
    if ((await res.json().catch(() => null)) !== true) throw new Refused(403, "That file isn't in this workspace.");
  }
  return known.actor;
}

// Every key starts with the purpose and the user's own id.

function projectPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return parts.join("/");
}

/** `id` is checked by keyFor first. */
const sentKey = (userId, id) => `${SENT}/${userId}/${id}`;

function keyFor(userId, body) {
  const purpose = body?.purpose;
  const id = body?.id;
  if (!PURPOSES.has(purpose) || typeof id !== "string" || !ID.test(id)) throw new Refused(400, "That file can't be stored.");
  if (purpose !== "projects") return `${purpose}/${userId}/${id}`;
  const path = projectPath(body.path);
  if (!path) throw new Refused(400, "That project file can't be stored.");
  return `projects/${userId}/${id}/${path}`;
}

const usage = new Map();
const USAGE_SECONDS = 10 * 60;

async function listKeys(prefix) {
  const found = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents ?? []) found.push({ key: item.Key, size: item.Size ?? 0, at: item.LastModified?.getTime() ?? 0 });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return found;
}

/** `at` is when the listing began: a file older than that is in it. */
async function measure(userId) {
  const cached = usage.get(userId);
  if (cached && cached.until > Date.now()) return cached;
  const at = Date.now();
  const mine = holds.get(userId);
  const found = new Map();
  const parts = {};
  for (const purpose of PURPOSES) {
    parts[purpose] = 0;
    for (const item of await listKeys(`${purpose}/${userId}/`)) {
      parts[purpose] += item.size;
      if (mine?.has(item.key)) found.set(item.key, item.size);
    }
  }
  let sent = 0;
  for (const item of await listKeys(`${SENT}/${userId}/`)) {
    sent += item.size;
    if (mine?.has(item.key)) found.set(item.key, item.size);
  }
  for (const [key, hold] of mine ?? []) hold.counted = found.get(key) ?? 0;
  const entry = { parts, sent, at, until: Date.now() + USAGE_SECONDS * 1000 };
  usage.set(userId, entry);
  return entry;
}

const total = (parts) => Object.values(parts).reduce((sum, bytes) => sum + bytes, 0);

// A signed link works until it expires, so its file counts from signing: a hold on its key
// until the link is long dead, adding only what the listing doesn't count already. Never
// released early (delete, move to sent/): the link could upload again. The link fixes the
// file's size (see uploadUrl), so a hold can't be outgrown.

/** A file still arriving when its link runs out may take a while to land. */
const HOLD_SECONDS = LINK_SECONDS + 15 * 60;
/** R2's clock and this server's may differ a little. */
const CLOCK_SLACK = 60_000;
/** By user, then key: `{ purpose, size, counted, until }`. `size` is the largest file signed for the key. */
const holds = new Map();

function holdsOf(userId) {
  const mine = holds.get(userId);
  if (!mine) return undefined;
  const now = Date.now();
  let dropped = false;
  for (const [key, hold] of mine) {
    if (hold.until > now) continue;
    mine.delete(key);
    dropped = true;
  }
  // Its link is dead: what it left is counted from the bucket again.
  if (dropped) usage.delete(userId);
  if (mine.size === 0) holds.delete(userId);
  return mine;
}

const extra = (hold) => Math.max(0, hold.size - hold.counted);

async function projected(userId) {
  const mine = holdsOf(userId);
  const { parts, sent, at } = await measure(userId);
  const soon = { parts: { ...parts }, sent, at };
  for (const hold of mine?.values() ?? []) {
    if (hold.purpose === SENT) soon.sent += extra(hold);
    else soon.parts[hold.purpose] += extra(hold);
  }
  return soon;
}

// One user at a time, so parallel uploads can't all pass the check before any is held.
// This is one Node process, so an in-memory queue is all the lock it needs.
const queues = new Map();

function oneAtATime(userId, work) {
  const run = (queues.get(userId) ?? Promise.resolve()).then(work);
  const settled = run.catch(() => {});
  queues.set(userId, settled);
  settled.then(() => {
    if (queues.get(userId) === settled) queues.delete(userId);
  });
  return run;
}

async function stat(key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: head.ContentLength ?? 0, at: head.LastModified?.getTime() ?? 0 };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function sizeOf(key) {
  return (await stat(key))?.size ?? 0;
}

async function deleteKeys(keys) {
  for (let start = 0; start < keys.length; start += 1000) {
    const batch = keys.slice(start, start + 1000);
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
}

function postsOf(id) {
  const cut = id.lastIndexOf("_");
  return cut > 0 && isFileOf(id.slice(0, cut), id) ? [id, id.slice(0, cut)] : [id];
}

// Only the publisher writes `sent` post_deliveries rows. Asked with the caller's own token,
// so Supabase answers only about posts they may see.
async function sentFiles(req, ownerId, ids) {
  const asked = [...new Set(ids.flatMap(postsOf))];
  const went = new Set();
  // A few at a time, to keep the address short.
  for (let start = 0; start < asked.length; start += 50) {
    const posts = asked.slice(start, start + 50).join(",");
    const res = await supabaseCall(`/rest/v1/post_deliveries?select=post_id&state=eq.sent&user_id=eq.${ownerId}&post_id=in.(${posts})`, tokenOf(req));
    const rows = res.ok ? await res.json().catch(() => null) : null;
    if (!Array.isArray(rows)) throw new Refused(503, "Cloud storage can't check this post right now.");
    for (const row of rows) if (typeof row?.post_id === "string") went.add(row.post_id);
  }
  return new Set(ids.filter((id) => postsOf(id).some((post) => went.has(post))));
}

async function uploadUrl(user, body, req) {
  limit(`upload:${user.id}`, 1500, 3600);
  // A post that went out with no copy yet goes straight to sent/; one that didn't is stored as waiting.
  let sent = body?.sent === true;
  if (sent && body.purpose !== "posts") throw new Refused(400, "That file can't be stored.");
  let key = keyFor(user.id, body);
  const size = Number(body.size);
  const smallest = body.purpose === "projects" ? 0 : 1;
  if (!Number.isSafeInteger(size) || size < smallest) throw new Refused(400, "That file is empty.");

  let contentType;
  if (body.purpose === "projects") {
    contentType = PROJECT_TYPE;
    if (size > PROJECT_FILE_MAX) throw new Refused(400, "Project files can be up to 500 MB.");
  } else {
    contentType = body.contentType;
    const kind = MEDIA_TYPES[contentType];
    if (!kind) throw new Refused(400, "Use a JPG, PNG, MP4, or MOV.");
    if (kind === "image" && size > IMAGE_MAX) throw new Refused(400, "Pictures can be up to 8 MB.");
    if (kind === "video" && size > VIDEO_MAX) throw new Refused(400, "Videos can be up to 500 MB.");
  }

  if (sent && (await sentFiles(req, user.id, [body.id])).has(body.id)) key = sentKey(user.id, body.id);
  else sent = false;

  // Checked and held one at a time, so each check counts every link signed before it.
  return oneAtATime(user.id, async () => {
    const found = await stat(key);
    const room = await projected(user.id);
    const held = holds.get(user.id)?.get(key);
    // Only what the listing is sure to have counts.
    const counted = held ? held.counted : found && found.at < room.at - CLOCK_SLACK ? found.size : 0;
    const largest = Math.max(held?.size ?? 0, size);
    const adds = largest - counted - (held ? extra(held) : 0);
    if (sent) {
      // Its own status, not 413: the browser stops all backups on a full plan, and this ceiling isn't the plan.
      if (room.sent + adds > SENT_QUOTAS[user.plan]) throw new Refused(507, "There's no more room for posts that went out.");
    } else if (total(room.parts) + adds > QUOTAS[user.plan]) {
      const full = `Your ${QUOTAS[user.plan] / GB} GB of cloud storage is full.`;
      throw new Refused(413, user.plan === "free" ? `${full} Creator has ${QUOTAS.creator / GB} GB.` : full);
    }

    // Content-Length is signed, so R2 takes only a file of exactly the size held.
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn: LINK_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    if (!holds.has(user.id)) holds.set(user.id, new Map());
    holds.get(user.id).set(key, { purpose: sent ? SENT : body.purpose, size: largest, counted, until: Date.now() + HOLD_SECONDS * 1000 });
    return { key, uploadUrl: url, contentType, expiresIn: LINK_SECONDS };
  });
}

/** Both posts/ and sent/ can hold a copy of a post's file: the newer one wins. */
async function postKey(userId, id) {
  const waiting = `posts/${userId}/${id}`;
  const kept = sentKey(userId, id);
  const [a, b] = await Promise.all([stat(waiting), stat(kept)]);
  return a && (!b || a.at > b.at) ? waiting : kept;
}

async function signRead(user, body) {
  let key = keyFor(user.id, body);
  if (body.purpose === "posts") key = await postKey(user.id, body.id);
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: LINK_SECONDS });
  return { key, url, expiresIn: LINK_SECONDS };
}

async function readUrl(user, body) {
  limit(`read:${user.id}`, 600, 3600);
  return signRead(user, body);
}

async function readUrls(user, body) {
  limit(`reads:${user.id}`, 600, 3600);
  const targets = body?.targets;
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > READ_MAX) throw new Refused(400, "Read fewer files at once.");
  return { links: await Promise.all(targets.map((target) => signRead(user, target))) };
}

/** Only ever under the asking user's own id. */
async function list(user, body) {
  limit(`list:${user.id}`, 600, 3600);
  if (body?.purpose !== "projects") throw new Refused(400, "That can't be listed.");
  const prefix = `projects/${user.id}/`;
  const files = [];
  for (const item of await listKeys(prefix)) {
    const rest = item.key.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 1) continue;
    files.push({ id: rest.slice(0, slash), path: rest.slice(slash + 1), size: item.size, at: item.at });
  }
  return { files };
}

async function remove(user, body) {
  limit(`delete:${user.id}`, 600, 3600);
  const purpose = body?.purpose;
  let keys;
  if (purpose === "projects" && body.paths === undefined) {
    if (typeof body.id !== "string" || !ID.test(body.id)) throw new Refused(400, "That project can't be found.");
    keys = (await listKeys(`projects/${user.id}/${body.id}/`)).map((item) => item.key);
  } else if (purpose === "projects") {
    if (!Array.isArray(body.paths) || body.paths.length > DELETE_MAX) throw new Refused(400, "Delete fewer files at once.");
    keys = body.paths.map((path) => keyFor(user.id, { purpose, id: body.id, path }));
  } else {
    if (!Array.isArray(body?.ids) || body.ids.length > DELETE_MAX) throw new Refused(400, "Delete fewer files at once.");
    keys = body.ids.map((id) => keyFor(user.id, { purpose, id }));
    // A post's file may sit in either place, or both for a moment while it moves.
    if (purpose === "posts") keys.push(...body.ids.map((id) => sentKey(user.id, id)));
  }
  if (keys.length) {
    await deleteKeys(keys);
    usage.delete(user.id);
  }
  return { deleted: keys.length };
}

async function erase(user, body) {
  limit(`erase:${user.id}`, 10, 3600);
  if (body?.everything !== true) throw new Refused(400, "Say that everything should go.");
  const keys = [];
  for (const purpose of [...PURPOSES, SENT]) {
    for (const item of await listKeys(`${purpose}/${user.id}/`)) keys.push(item.key);
  }
  if (keys.length) await deleteKeys(keys);
  usage.delete(user.id);
  return { deleted: keys.length };
}

// Copies files of posts that went out from posts/ to sent/. Each comes with the size the post
// went out with, so an older file under its id is never kept instead. Files over the sent/
// ceiling, or of posts that didn't go out (see sentFiles), stay put on the plan.
async function settle(user, body, req) {
  limit(`settle:${user.id}`, 300, 3600);
  const files = body?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > SETTLE_MAX) throw new Refused(400, "Move fewer files at once.");
  for (const file of files) {
    keyFor(user.id, { purpose: "posts", id: file?.id });
    if (!Number.isSafeInteger(file.size) || file.size < 1) throw new Refused(400, "That file is empty.");
  }

  const unique = [...new Map(files.map((file) => [file.id, file])).values()];
  const went = await sentFiles(req, user.id, unique.map((file) => file.id));
  // One at a time with the user's uploads, so the ceiling counts every file on its way.
  return oneAtATime(user.id, async () => {
    const result = { sent: [], missing: [], full: [], unsent: [] };
    let { sent: used } = await projected(user.id);
    let changed = false;
    for (const { id, size } of unique) {
      const from = `posts/${user.id}/${id}`;
      const to = sentKey(user.id, id);
      const [waiting, kept] = await Promise.all([sizeOf(from), sizeOf(to)]);
      if (waiting !== size) {
        if (kept === size) result.sent.push({ id, key: to });
        else result.missing.push(id);
        continue;
      }
      if (!went.has(id)) {
        result.unsent.push(id);
        continue;
      }
      if (used - kept + size > SENT_QUOTAS[user.plan]) {
        result.full.push(id);
        continue;
      }
      try {
        await s3.send(new CopyObjectCommand({ Bucket: BUCKET, CopySource: `${BUCKET}/${from}`, Key: to }));
      } catch (error) {
        // Another browser moved it first.
        if (error?.$metadata?.httpStatusCode !== 404 || (await sizeOf(to)) !== size) throw error;
        result.sent.push({ id, key: to });
        continue;
      }
      changed = true;
      // Only once the copy is there. Should this fail, both stay, and the next ask finishes the move.
      await deleteKeys([from]);
      used += size - kept;
      result.sent.push({ id, key: to });
    }
    // Counted again on the next ask: two browsers moving the same file would each subtract it.
    if (changed) usage.delete(user.id);
    return result;
  });
}

async function usageOf(user) {
  limit(`usage:${user.id}`, 120, 3600);
  const { parts } = await projected(user.id);
  return { used: total(parts), limit: QUOTAS[user.plan], plan: user.plan, parts };
}

const isFileOf = (postId, id) => id === postId || (id.startsWith(`${postId}_`) && /^[A-Za-z0-9]{1,32}$/.test(id.slice(postId.length + 1)));

// Anyone with the preview link may ask, signed in or not: Supabase says which post it's of,
// and only while it is still shared.
async function previewUrl(body) {
  const preview = body?.preview;
  if (typeof preview !== "string" || !UUID.test(preview)) throw new Refused(404, "This preview isn't shared.");
  limit(`preview:${preview}`, 600, 3600);
  const res = await supabaseCall("/rest/v1/rpc/post_preview_media", env.SUPABASE_ANON_KEY, { method: "POST", body: JSON.stringify({ preview }) });
  if (!res.ok) throw new Refused(404, "This preview isn't shared.");
  const found = await res.json().catch(() => null);
  if (typeof found?.ownerId !== "string" || !ID.test(found.ownerId) || typeof found?.postId !== "string" || !ID.test(found.postId)) {
    throw new Refused(404, "This preview has no video.");
  }
  const file = body.file === undefined ? found.postId : body.file;
  if (typeof file !== "string" || !ID.test(file) || !isFileOf(found.postId, file)) throw new Refused(404, "This preview has no such file.");
  const key = await postKey(found.ownerId, file);
  if (!(await sizeOf(key))) throw new Refused(404, "This preview's video isn't available.");
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: LINK_SECONDS });
  return { url, expiresIn: LINK_SECONDS };
}

const PUBLIC_ROUTES = {
  "POST /api/storage/preview-url": previewUrl,
};

/** Requests about a shared workspace may only take these routes, as its owner. */
const TEAM_ROUTES = new Set([uploadUrl, readUrl, readUrls, remove, settle]);

const ROUTES = {
  "POST /api/storage/upload-url": uploadUrl,
  "POST /api/storage/read-url": readUrl,
  "POST /api/storage/read-urls": readUrls,
  "POST /api/storage/list": list,
  "POST /api/storage/delete": remove,
  "POST /api/storage/erase": erase,
  "POST /api/storage/settle": settle,
  "GET /api/storage/usage": usageOf,
};

function json(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        reject(new Refused(413, "That request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const path = (req.url ?? "").split("?")[0];
    const route = ROUTES[`${req.method} ${path}`];
    const open = PUBLIC_ROUTES[`${req.method} ${path}`];
    if (!route && !open) throw new Refused(404, "Not found.");

    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    limit(`ip:${ip}`, 1200, 600);

    const user = open ? null : await userFor(req);
    let body = {};
    if (req.method === "POST") {
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch (error) {
        if (error instanceof Refused) throw error;
        throw new Refused(400, "That request could not be read.");
      }
    }
    let actor = user;
    if (route && body?.team !== undefined && body?.team !== null) {
      if (!TEAM_ROUTES.has(route)) throw new Refused(400, "That can't be done for a shared workspace.");
      actor = await teamActor(req, user, body);
    }
    json(res, 200, open ? await open(body) : await route(actor, body, req));
  } catch (error) {
    if (error instanceof Refused) {
      json(res, error.status, { error: error.message });
      return;
    }
    console.error("[storage]", error?.name ?? "error", error?.message ?? "");
    json(res, 500, { error: "Cloud storage isn't available right now." });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

export { PUBLIC_ROUTES, ROUTES, Refused, deleteKeys, listKeys, s3, server, teamActor };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  server.listen(PORT, HOST, () => console.log(`storage signer listening on ${HOST}:${PORT}`));
}
