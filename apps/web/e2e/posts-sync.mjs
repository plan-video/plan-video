// See helpers.mjs for how to run it.

import { assert, launch, openDashboard, person, post, postIn, rest, serverPost, sleep, step, inStore, SITE, until } from "./helpers.mjs";

const me = await person("e2e", 3);
const { device, finish } = await launch();

const a = await device("A", me);
const b = await device("B", me);

await step("both devices open the dashboard", async () => {
  await openDashboard(a);
  await openDashboard(b);
});

await step("a post made on A reaches the server, with no delivery state or thumbnail in it", async () => {
  await inStore(a, (store, _p, value) => store.restoreEvent(value), post("e2e-1", { deliveries: { x: { state: "sent", attempts: 1, at: new Date().toISOString() } } }));
  const row = await until("on the server", () => serverPost(me.id, "e2e-1"));
  assert.equal(row.version, 1);
  assert.equal(row.data.title, "e2e-1");
  assert.equal(row.data.deliveries, undefined);
});

await step("B gets it live, without a reload", async () => {
  await until("on B", () => postIn(b, "e2e-1"));
});

await step("an edit on A reaches B live", async () => {
  await inStore(a, (store) => store.revisePost("e2e-1", { title: "Edited on A" }));
  await until("edit on B", async () => (await postIn(b, "e2e-1"))?.title === "Edited on A");
  assert.equal((await serverPost(me.id, "e2e-1")).version, 2);
});

await step("edits to different fields at the same time on A and B are both kept everywhere", async () => {
  await Promise.all([inStore(a, (store) => store.revisePost("e2e-1", { title: "Title from A" })), inStore(b, (store) => store.revisePost("e2e-1", { description: "Words from B" }))]);
  for (const dev of [a, b]) {
    await until(`both on ${dev.name}`, async () => {
      const shown = await postIn(dev, "e2e-1");
      return shown?.title === "Title from A" && shown?.description === "Words from B";
    });
  }
  const row = await serverPost(me.id, "e2e-1");
  assert.equal(row.data.title, "Title from A");
  assert.equal(row.data.description, "Words from B");
});

await step("a thumbnail set on A reaches B, through its own table", async () => {
  const picture = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  await inStore(a, (store, _p, value) => store.setPostThumbnail("e2e-1", value), picture);
  await until("thumbnail on the server", async () => (await rest(`/rest/v1/post_thumbnails?select=thumbnail&owner_id=eq.${me.id}&post_id=eq.e2e-1`))[0]?.thumbnail === picture);
  assert.equal((await serverPost(me.id, "e2e-1")).data.thumbnail, undefined);
  await until("thumbnail on B", async () => (await postIn(b, "e2e-1"))?.thumbnail === picture);
});

await step("the publisher marking a post posted shows on both devices", async () => {
  await inStore(a, (store) => store.revisePost("e2e-1", { status: "scheduled" }));
  await until("scheduled on the server", async () => (await serverPost(me.id, "e2e-1")).data.status === "scheduled");
  const marked = await rest("/rest/v1/rpc/publisher_mark_posted", { method: "POST", body: { owner: me.id, post: "e2e-1" } });
  assert.equal(marked, true);
  for (const dev of [a, b]) await until(`posted on ${dev.name}`, async () => (await postIn(dev, "e2e-1"))?.status === "posted");
});

await step("a post deleted on B goes from A", async () => {
  await inStore(b, (store, _p, value) => store.restoreEvent(value), post("e2e-2"));
  await until("e2e-2 on A", () => postIn(a, "e2e-2"));
  await inStore(b, (store) => store.deleteEvent({ sourceId: "e2e-2" }));
  await until("deleted on the server", async () => (await serverPost(me.id, "e2e-2"))?.deleted_at);
  await until("gone from A", async () => !(await postIn(a, "e2e-2")));
});

await step("offline, a change waits and shows as not synced; back online it goes", async () => {
  await a.context.setOffline(true);
  await inStore(a, (store, _p, value) => store.restoreEvent(value), post("e2e-3", { status: "scheduled" }));
  await until("named as not synced", () => inStore(a, (_store, posts) => posts.unsyncedPosts().has("e2e-3") && !!posts.postSyncProblem()), 20_000);
  await a.context.setOffline(false);
  await inStore(a, (_store, posts) => posts.retryPostSync());
  await until("on the server after", () => serverPost(me.id, "e2e-3"), 20_000);
  await until("no longer named", () => inStore(a, (_store, posts) => !posts.unsyncedPosts().has("e2e-3") && !posts.postSyncProblem()));
});

await step("after a reload A keeps its posts and only asks what changed", async () => {
  const asked = [];
  a.page.on("request", (request) => {
    if (request.url().includes("/rest/v1/posts")) asked.push(request.url());
  });
  await openDashboard(a);
  await until("posts after reload", () => postIn(a, "e2e-3"));
  await sleep(1500);
  assert.ok(asked.length > 0, "it read the server");
  assert.ok(asked.every((url) => url.includes("updated_at=gte")), `a full read after reload: ${asked.find((url) => !url.includes("updated_at"))}`);
});

await step("the account record no longer carries posts", async () => {
  const [state] = await rest(`/rest/v1/account_state?select=payload&user_id=eq.${me.id}`);
  assert.ok(state, "the account was saved");
  for (const slice of Object.values(state.payload.slices)) {
    assert.equal(slice.events, undefined);
    assert.equal(slice.media, undefined);
  }
});

await step("a tab that never opened the dashboard saves a post once it starts syncing, as for an AI agent", async () => {
  const c = await device("C", me);
  await c.page.goto(`${SITE}/tools`, { waitUntil: "load" });
  await c.page.evaluate(async (id) => {
    const { loadWorkspaces } = await import("/src/lib/workspaces.ts");
    const { beginSyncing } = await import("/src/lib/sync-start.ts");
    loadWorkspaces(id);
    beginSyncing(id);
  }, me.id);
  await inStore(c, async (store, _p, value) => {
    await store.hydrateCalendar();
    store.restoreEvent(value);
  }, post("from-agent-tab"));
  await until("the agent tab's post on the server", () => serverPost(me.id, "from-agent-tab"));
  await until("on A", () => postIn(a, "from-agent-tab"));
  await c.context.close();
});

await step("Post now's flush saves a fresh edit before returning", async () => {
  await inStore(a, (store) => store.revisePost("e2e-3", { title: "Saved by the flush" }));
  const ok = await inStore(a, (_store, posts) => posts.flushPostSync());
  assert.equal(ok, true);
  assert.equal((await serverPost(me.id, "e2e-3")).data.title, "Saved by the flush");
});


await finish();
