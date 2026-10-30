/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Anthropic key, prompt and tools stay here; the tools run in the browser, which loops
// one request per model step. Replies are NDJSON lines typed text | tool | done | error.
// Each step is signed for that person and unsigned ones are refused, so the model's side is
// only ever what the model wrote. Spend is capped per person and site; counts outlive a restart.

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 16000;
/** Keeps a chat under the 100k tokens past which Haiku 5.5 costs five times as much. */
const MAX_BODY_BYTES = 300 * 1024;
const MAX_MESSAGES = 400;

const TOOLS = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

// Spend is in input-token equivalents, weighted as the API bills: cache writes 1.25x, cache
// reads 0.1x, output 5x. Plans are shares of Creator's day: Free 1/4, Pro 2x, Agency 4x.
const DEFAULT_PERSON_BUDGET = 4_000_000;
const PLAN_SHARES = { 1: 0.25, 2: 1, 3: 2, 4: 4 };
const DEFAULT_SITE_BUDGET = 200_000_000;
/** Free accounts share this part of the site's day, so they never use up what paying ones need. */
const DEFAULT_FREE_SHARE = 0.5;
/** Free accounts on one network share one Creator's day, agent and caption tools together. */
const DEFAULT_NETWORK_BUDGET = DEFAULT_PERSON_BUDGET;
/** A member can't read the owner's plan; teams come with Pro and Agency, so Pro's. */
const TEAM_LEVEL = 3;
const DAY_SECONDS = 86_400;

const SYSTEM = `You are the Assistant in the plan.video dashboard, on its Assistant page or in the panel that opens from the corner of any dashboard page. You help the person plan, write and schedule posts for their social channels. With your tools you can read their connected channels, each network's rules and their analytics, put posts on their calendar as drafts or at a time, list, change and delete posts, and publish a post now when they ask.

Each of their messages starts with a <context> block: the date and time now in their dashboard time zone, the channels they picked, any media they attached, and, when they wrote from the panel, the dashboard page it was open over. Write for the picked channels unless they name others. If none are picked and it isn't clear where a post goes, ask.

- You can't make pictures or videos. Media comes from their library: their message lists attached files by media id, which you pass to schedule_post or update_post as media: one video, or a list of pictures to go out together as a carousel. When a network needs a video and none is attached, ask them to add one with Insert media.
- Check social_schema before writing for a short network such as X or Bluesky. One caption is shared by every network on a post; when networks need different captions, make one post per network.
- Posts that went out can't be changed, but they can be posted again: copy_post makes a new post from any post with its file and settings, on the day and time asked. When they refer to posts they made or that went out, find them with list_posts and copy them rather than asking for the content again.
- Scheduling sends nothing. publish_post sends at once and can't be undone: call it only when they ask to publish now. Ask before deleting a post they didn't point to.
- When they ask for their best days or times, or how they're doing, call analytics first and go by it: the weekdays and hours with the highest median views, among those with a few posts behind them. Schedule on the next of those days, at their best hour. Say in a line what you went by, such as "Tuesdays and Fridays around 18:00 get you the most views". When the note says there's too little to go on, say so and pick sensible times instead.
- TikTok asks for a few answers before a post goes to someone's profile, scheduled or published. Call tiktok_creator first, then in one message tell them which account it posts as, and ask who can watch (from its choices; there is no default), whether to allow comments, Duet and Stitch, and whether the post promotes their own brand, someone else's, both or nothing. Show TikTok's consent line from tiktok_creator word for word with its links, and pass agreed true only after they say yes.
- Publishing and deleting ask the person to confirm in the chat before they happen. If they say no, leave it, and don't ask again unless they bring it up.
- When several posts are asked for, spread them sensibly over the days and times they give, and don't stack two on one channel at the same time.
- After you schedule or change posts, say briefly what you did: where each goes, when, and its caption if it's short.

Write plainly and keep replies short. Use a markdown list for several posts.`;

const AGENT_LIMITS = {
  person: "You've reached today's limit for the agent. It's back tomorrow.",
  team: "Your team has reached today's limit for the agent. It's back tomorrow.",
  site: "The agent is resting for today. It's back tomorrow.",
  free: "The agent is resting for today on the Free plan. It's back tomorrow, or now on a paid plan.",
  network: "Free accounts on this network have reached today's limit for the agent. It's back tomorrow, or now on a paid plan.",
};

const sessions = new Map();
const windows = new Map();
const clients = new Map();

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let stateFile = null;
let writing = null;

/** Call once, before serving. */
export function loadLimits(path) {
  stateFile = path || null;
  if (!stateFile) return;
  try {
    const saved = JSON.parse(readFileSync(stateFile, "utf8"));
    const now = Date.now();
    for (const [name, entry] of Object.entries(saved)) {
      if (entry && typeof entry.count === "number" && typeof entry.reset === "number" && entry.reset > now) windows.set(name, entry);
    }
  } catch {
    // Nothing kept yet, or unreadable: start counting afresh.
  }
}

export function saveLimits() {
  if (!stateFile) return;
  const now = Date.now();
  for (const [name, entry] of windows) if (entry.reset <= now) windows.delete(name);
  try {
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(Object.fromEntries(windows)));
    renameSync(`${stateFile}.tmp`, stateFile);
  } catch (error) {
    console.warn("agent: couldn't keep the limits:", error.message);
  }
}

function keepLimits() {
  if (!stateFile || writing) return;
  writing = setTimeout(() => {
    writing = null;
    saveLimits();
  }, 5000);
  writing.unref?.();
}

function windowFor(name, seconds) {
  const now = Date.now();
  let entry = windows.get(name);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + seconds * 1000 };
    windows.set(name, entry);
  }
  return entry;
}

export function limit(name, max, seconds, message) {
  const entry = windowFor(name, seconds);
  entry.count += 1;
  keepLimits();
  if (entry.count > max) throw new Refused(429, message);
}

export function checkBudget(name, max, message) {
  if (windowFor(name, DAY_SECONDS).count >= max) throw new Refused(429, message);
}

// A call's cost is only known after it, so `most` is held until `settle`: without the hold,
// requests sent at once all pass on the same old count.
export function hold(name, max, most, message) {
  const entry = windowFor(name, DAY_SECONDS);
  if (entry.count >= max) throw new Refused(429, message);
  entry.count += most;
  keepLimits();
  return { name, entry, most };
}

export function settle(held, used) {
  if (windows.get(held.name) === held.entry) {
    held.entry.count = Math.max(0, held.entry.count - held.most + used);
    keepLimits();
  } else if (used) {
    // The day turned over while the call ran: its cost goes on the new one.
    windowFor(held.name, DAY_SECONDS).count += used;
    keepLimits();
  }
}

export function mostCost(bodyBytes, maxTokens) {
  return bodyBytes + 20_000 + 5 * maxTokens;
}

// One number (Creator's, the others are shares of it) or all four as "Free,Creator,Pro,Agency".
// Anything missing or unreadable keeps its default.
export function budgetsByLevel(value, base = DEFAULT_PERSON_BUDGET) {
  const parts = String(value ?? "").split(",").map((part) => Number.parseInt(part.trim(), 10));
  const one = parts.length === 1 && parts[0] > 0 ? parts[0] : base;
  return Object.fromEntries(
    Object.entries(PLAN_SHARES).map(([level, share], index) => {
      const given = parts.length > 1 ? parts[index] : Number.NaN;
      return [level, Number.isFinite(given) && given >= 0 ? given : Math.round(one * share)];
    }),
  );
}

// The last X-Forwarded-For hop is the one Caddy appended; anything before it is client-sent.
// IPv6 counts by its /64, which one connection usually has to itself.
export function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  let ip = (forwarded.at(-1) ?? req.socket?.remoteAddress ?? "").split("%")[0];
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  if (isIP(ip) !== 6) return ip || "unknown";
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

// A Free team member spends from the owner's day, so invites don't each bring a fresh day.
// Free accounts also share part of the site's day and their network's, so many Free accounts
// from one place get no more than one paid one. The network is kept as a keyed hash.
export function budgetsFor(tool, user, req, env) {
  const team = typeof user.team === "string";
  const level = team ? TEAM_LEVEL : Math.min(4, Math.max(1, Math.trunc(Number(user.level)) || 1));
  const site = Number(env.siteBudget) || DEFAULT_SITE_BUDGET;
  const budgets = [
    {
      name: `${tool.name}-spend:${team ? user.team : user.id}`,
      max: budgetsByLevel(tool.personBudget)[level],
      message: team ? tool.messages.team : tool.messages.person,
    },
  ];
  if (level === 1) {
    const share = typeof env.freeShare === "number" && env.freeShare >= 0 && env.freeShare <= 1 ? env.freeShare : DEFAULT_FREE_SHARE;
    const network = createHmac("sha256", signingKey(env)).update(`network\n${clientIp(req)}`).digest("base64url").slice(0, 22);
    budgets.push(
      { name: `agent-spend-network:${network}`, max: Number(env.networkBudget) || DEFAULT_NETWORK_BUDGET, message: tool.messages.network },
      { name: "agent-spend-free", max: Math.floor(site * share), message: tool.messages.free },
    );
  }
  budgets.push({ name: "agent-spend", max: site, message: tool.messages.site });
  return budgets;
}

export function checkBudgets(budgets) {
  for (const budget of budgets) checkBudget(budget.name, budget.max, budget.message);
}

export function holdBudgets(budgets, most) {
  const held = [];
  try {
    for (const budget of budgets) held.push(hold(budget.name, budget.max, most, budget.message));
  } catch (error) {
    settleBudgets(held, 0);
    throw error;
  }
  return held;
}

export function settleBudgets(held, used) {
  for (const one of held) settle(one, used);
}

export function cost(usage) {
  return (
    (usage.input_tokens ?? 0) +
    1.25 * (usage.cache_creation_input_tokens ?? 0) +
    0.1 * (usage.cache_read_input_tokens ?? 0) +
    5 * (usage.output_tokens ?? 0)
  );
}

/** Keys in order, so a step stored and read back signs the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function signingKey(env) {
  return env.signingSecret || createHmac("sha256", "plan.video agent steps").update(env.anthropicKey).digest();
}

function signStep(env, userId, content) {
  return createHmac("sha256", signingKey(env)).update(`${userId}\n${canonical(content)}`).digest("base64url");
}

function signedBy(env, userId, content, sig) {
  if (typeof sig !== "string") return false;
  const expected = Buffer.from(signStep(env, userId, content));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// OAuth-client tokens (Claude's connector, say) carry `client_id` and only work at /mcp.
function grantedToApp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.client_id != null;
  } catch {
    return false;
  }
}

async function supabaseCall(env, path, token, init = {}) {
  return fetch(`${env.supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000),
  });
}

export async function userFor(req, env) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to use the Assistant.");

  const cached = sessions.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall(env, "/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to use the Assistant.");
  const user = await res.json();
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to use the Assistant.");

  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  const level = await levelOf(env, user.id, token);
  const known = { id: user.id, level, team: level > 1 ? null : await teamOwnerOf(env, user.id, token) };
  if (sessions.size > 5000) sessions.clear();
  sessions.set(token, { user: known, until: Date.now() + 60_000 });
  return known;
}

/** An unreadable plan counts as Free, so an outage never grants more. */
async function levelOf(env, userId, token) {
  const res = await supabaseCall(env, `/rest/v1/user_data?select=access_level&id=eq.${encodeURIComponent(userId)}`, token).catch(() => null);
  if (!res?.ok) return 1;
  const rows = await res.json().catch(() => null);
  return Math.min(4, Math.max(1, Math.trunc(Number(Array.isArray(rows) ? rows[0]?.access_level : 0)) || 1));
}

// An invite not yet accepted doesn't count: nobody's spend goes on someone else's day
// without them saying yes.
async function teamOwnerOf(env, userId, token) {
  const res = await supabaseCall(env, "/rest/v1/rpc/my_team", token, { method: "POST", body: "{}" }).catch(() => null);
  if (!res?.ok) return null;
  const team = await res.json().catch(() => null);
  const joined = (Array.isArray(team?.workspaces) ? team.workspaces : []).find(
    (workspace) => workspace?.state === "active" && typeof workspace.owner === "string" && workspace.owner !== userId,
  );
  return joined?.owner ?? null;
}

const unreadable = () => new Refused(400, "That conversation can't be read. Start a new chat.");

/** Words and tool results only: nothing else is passed on. */
function personBlock(block) {
  if (block?.type === "text" && typeof block.text === "string" && block.text) return { type: "text", text: block.text };
  if (block?.type === "tool_result" && typeof block.tool_use_id === "string" && typeof block.content === "string") {
    return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content, ...(block.is_error === true ? { is_error: true } : {}) };
  }
  throw unreadable();
}

/** Only the block kinds the model writes, and only our tools. */
function modelBlock(block) {
  if (block?.type === "text" && typeof block.text === "string") return { type: "text", text: block.text };
  if (block?.type === "tool_use" && typeof block.id === "string" && TOOL_NAMES.has(block.name) && block.input && typeof block.input === "object") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input };
  }
  if (block?.type === "thinking" && typeof block.thinking === "string" && typeof block.signature === "string") {
    return { type: "thinking", thinking: block.thinking, signature: block.signature };
  }
  if (block?.type === "redacted_thinking" && typeof block.data === "string") return { type: "redacted_thinking", data: block.data };
  throw unreadable();
}

function cleanMessages(value, env, userId) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) throw new Refused(400, "Start a new chat.");
  return value.map((message, index) => {
    const role = message?.role;
    const content = message?.content;
    if ((role !== "user" && role !== "assistant") || !Array.isArray(content) || content.length === 0) throw unreadable();
    if (index === 0 && role !== "user") throw unreadable();
    if (role === "user") return { role, content: content.map(personBlock) };
    if (!signedBy(env, userId, content, message.sig)) {
      throw new Refused(400, "This chat can't go on: it was started before an update, or changed outside plan.video. Start a new chat.");
    }
    return { role, content: content.map(modelBlock) };
  });
}

// A thinking block is only accepted while the prompt and tools before it are unchanged, so
// old reasoning is dropped for chats begun before a deploy that changed them.
function withoutThinking(messages) {
  return messages.map((message) =>
    message.role === "assistant"
      ? { ...message, content: message.content.filter((block) => block?.type !== "thinking" && block?.type !== "redacted_thinking") }
      : message,
  ).filter((message) => message.content.length > 0);
}

const hasThinking = (messages) =>
  messages.some((message) => message.role === "assistant" && message.content.some((block) => block?.type === "thinking" || block?.type === "redacted_thinking"));

export function clientFor(key) {
  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({ apiKey: key, maxRetries: 2 });
    clients.set(key, client);
  }
  return client;
}

function errorText(error) {
  if (error instanceof Anthropic.RateLimitError) return "The Assistant is busy. Try again in a moment.";
  if (error instanceof Anthropic.BadRequestError) {
    console.error("agent: Anthropic refused the request:", error.message);
    return "That conversation can't go on. Start a new chat.";
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error("agent: the Anthropic key was refused:", error.message);
    return "The Assistant isn't available right now.";
  }
  if (error instanceof Anthropic.APIError) {
    console.error(`agent: Anthropic answered ${error.status}:`, error.message);
    return "The Assistant isn't available right now. Try again in a moment.";
  }
  console.error("agent:", error);
  return "The Assistant couldn't be reached. Try again in a moment.";
}

export async function handleAgent(req, res, env) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST." });
    return;
  }
  if (!env.anthropicKey) {
    json(res, 503, { error: "The agent isn't set up on the server yet." });
    return;
  }

  const user = await userFor(req, env);
  limit(`agent:${user.id}`, 150, 600, "That's a lot of messages at once. Wait a few minutes and try again.");
  limit(`agent-day:${user.id}`, 300, DAY_SECONDS, "You've reached today's limit for the agent. It's back tomorrow.");
  const budgets = budgetsFor({ name: "agent", personBudget: env.personBudget, messages: AGENT_LIMITS }, user, req, env);
  checkBudgets(budgets);

  let body;
  try {
    body = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString("utf8"));
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused(400, "Not JSON.");
  }
  const messages = cleanMessages(body?.messages, env, user.id);
  const most = mostCost(Buffer.byteLength(JSON.stringify(messages)), MAX_TOKENS);
  const held = holdBudgets(budgets, most);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // Caddy and nginx would otherwise hold the words back.
    "X-Accel-Buffering": "no",
  });
  const send = (line) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
  };

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  let streamed = false;
  /** Taken from the stream, so a step stopped halfway still counts. */
  let usage = {};
  const step = async (history) => {
    usage = {};
    const stream = clientFor(env.anthropicKey).messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools: TOOLS,
        messages: history,
      },
      { signal: controller.signal },
    );

    for await (const event of stream) {
      if (event.type === "message_start") usage = { ...event.message.usage };
      else if (event.type === "message_delta" && event.usage) usage = { ...usage, ...Object.fromEntries(Object.entries(event.usage).filter(([, value]) => value != null)) };
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        streamed = true;
        send({ type: "tool", name: event.content_block.name });
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        streamed = true;
        send({ type: "text", text: event.delta.text });
      }
    }
    const message = await stream.finalMessage();
    usage = message.usage;
    send({ type: "done", content: message.content, stop_reason: message.stop_reason, sig: signStep(env, user.id, message.content) });
  };

  try {
    try {
      await step(messages);
    } catch (error) {
      if (streamed || controller.signal.aborted || !(error instanceof Anthropic.BadRequestError) || !hasThinking(messages)) throw error;
      console.warn("agent: retrying without earlier thinking:", error.message);
      await step(withoutThinking(messages));
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    send({ type: "error", error: errorText(error) });
  } finally {
    settleBudgets(held, cost(usage));
    if (!res.writableEnded) res.end();
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Refused(413, "This chat is too long. Start a new one."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function json(res, status, body) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end(`${JSON.stringify({ type: "error", error: body?.error ?? "Something went wrong." })}\n`);
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}
