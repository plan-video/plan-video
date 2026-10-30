// What the end-to-end checks share. They drive the real dashboard in Chrome
// against a local Supabase, through the app's own modules, with every call to
// /api blocked so nothing reaches production:
//
//   supabase start                      (at the repo root, with the migrations applied)
//   node apps/web/e2e/serve.mjs &       (this checkout's dev server on 5391, on the local Supabase)
//   PLAYWRIGHT=/path/to/playwright-core/index.mjs node apps/web/e2e/posts-sync.mjs
//
// Playwright isn't a dependency of the repo: install playwright-core anywhere
// (npm i playwright-core@1.49.1 in a folder of its own) and point PLAYWRIGHT at
// it, or have it in node_modules. Chrome must be installed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export { assert, randomUUID };

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright-core");

export const SUPA = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
export const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const SITE = process.env.SITE || "http://127.0.0.1:5391";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks `check` until it gives something, or gives up after `ms`. */
export async function until(what, check, ms = 15_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    last = await check();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`timed out: ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}

/** A call to the local Supabase, as `token` (the service's by default). */
export async function rest(path, { method = "GET", body, token = SERVICE } = {}) {
  const response = await fetch(`${SUPA}${path}`, {
    method,
    headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Someone signed in, on plan `level` when given. */
export async function person(name, level) {
  const email = `${name}-${randomUUID().slice(0, 8)}@posts.test`;
  // Let in from the waitlist first, as everyone is while the app is invite-only.
  await rest("/rest/v1/waitlist", { method: "POST", body: { email, invited_at: new Date().toISOString() } });
  const made = await rest("/auth/v1/admin/users", { method: "POST", body: { email, password: "e2e-password", email_confirm: true } });
  const session = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "e2e-password" }),
  }).then((response) => response.json());
  assert.ok(session.access_token, JSON.stringify(session));
  if (level) await rest(`/rest/v1/user_data?id=eq.${made.id}`, { method: "PATCH", body: { access_level: level } });
  return { id: made.id, email, session };
}

/** A workspace's lists, without posts. */
export const slice = () => ({
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
});

/** A post as the calendar keeps it. */
export const post = (id, extra = {}) => ({
  id,
  title: id,
  description: null,
  day: "2026-12-01",
  start: "09:00",
  allDay: false,
  duration: 30,
  calendarId: "posts",
  createdAt: new Date().toISOString(),
  link: null,
  platforms: ["x"],
  recurrence: null,
  recurrenceExceptions: [],
  status: "draft",
  timeZone: "Europe/Amsterdam",
  ...extra,
});

export async function launch() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];

  /** A browser profile signed in as `who`: one device. */
  async function device(name, who) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(
      ([key, value]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        localStorage.setItem("plan.video.analytics-consent", "denied");
      },
      [`sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`, JSON.stringify(who.session)],
    );
    await context.route(/\/api\//, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"blocked in the test"}' }));
    await context.route(/sentry\.io|umami/, (route) => route.abort());
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    page.on("console", (message) => {
      // Offline steps make the syncs say they can't reach the server, which they should.
      if (message.type() === "error" && !/503|blocked in the test|Failed to load resource|Failed to fetch/.test(message.text())) errors.push(`${name} console: ${message.text().slice(0, 300)}`);
    });
    return { name, context, page };
  }

  /**
   * A dev server prepares its dependencies as pages first ask for them, and
   * reloads the page each time it does: a throwaway visit to the dashboard
   * first, so the checks don't lose a step to a reload.
   */
  async function warmUp() {
    const visitor = await device("warm-up", await person("warm-up"));
    await openDashboard(visitor);
    await visitor.page.waitForLoadState("networkidle").catch(() => undefined);
    await sleep(3000);
    await openDashboard(visitor);
    await visitor.context.close();
  }
  await warmUp();

  async function finish() {
    await browser.close();
    console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
    process.exit(errors.length ? 1 : 0);
  }

  return { browser, device, finish };
}

/**
 * Runs `fn(store, posts, value)` in the page, with the calendar store and
 * lib/post-sync.ts as the app itself loaded them: the dev server may give an
 * edited module a timestamp, and another address would be another copy.
 */
export const inStore = (dev, fn, arg) =>
  dev.page.evaluate(
    async ([source, value]) => {
      const address = async (from, name) => (await (await fetch(from)).text()).match(new RegExp(`from "(/src/[^"]*${name}[^"]*)"`))?.[1];
      // Looked up once, while online.
      window.__pvModules ??= {
        store: (await address("/src/lib/post-sync.ts", "calendar/store")) ?? "/src/components/calendar/store.ts",
        posts: (await address("/src/lib/sync-start.ts", "post-sync")) ?? "/src/lib/post-sync.ts",
      };
      const store = await import(window.__pvModules.store);
      const posts = await import(window.__pvModules.posts);
      return new Function("store", "posts", "value", `return (${source})(store, posts, value);`)(store, posts, value);
    },
    [fn.toString(), arg],
  );

export const postIn = (dev, id) => inStore(dev, (store, _posts, id) => store.allPosts().find((post) => post.id === id) ?? null, id);
export const serverPost = async (owner, id) => (await rest(`/rest/v1/posts?select=*&owner_id=eq.${owner}&id=eq.${id}`))[0];

export async function openDashboard(dev) {
  await dev.page.goto(`${SITE}/dashboard`, { waitUntil: "load" });
  // A dev server's first visit prepares its dependencies and reloads the page once: asked again after it.
  await until(`${dev.name} calendar`, () =>
    inStore(dev, async (store) => (await store.hydrateCalendar(), store.loaded())).catch(async (error) => {
      if (!/Execution context was destroyed|dynamically imported module|navigation/i.test(String(error?.message))) throw error;
      await dev.page.waitForLoadState("load");
      return false;
    }),
  30_000);
}

export async function step(name, work) {
  const start = Date.now();
  await work();
  console.log(`ok  ${name} (${Date.now() - start} ms)`);
}
