// See helpers.mjs for how to run it.

import { assert, launch, SITE } from "./helpers.mjs";

const { browser, finish } = await launch();
const context = await browser.newContext();
await context.route(/\/api\/|sentry|umami/, (route) => route.fulfill({ status: 503, body: "{}" }));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => message.type() === "error" && !/503|Failed to load resource/.test(message.text()) && errors.push(message.text().slice(0, 200)));
await page.goto(`${SITE}/try`, { waitUntil: "load" });
await page.waitForTimeout(4000);
const count = await page.evaluate(async () => {
  const source = await (await fetch("/src/lib/post-sync.ts")).text();
  const store = await import(source.match(/from "(\/src\/[^"]*calendar\/store[^"]*)"/)[1]);
  await store.hydrateCalendar();
  return store.allPosts().length;
});
assert.ok(count > 0, "the demo shows its posts");
assert.deepEqual(errors, []);
console.log(`ok  the demo opens with ${count} posts`);
await finish();
