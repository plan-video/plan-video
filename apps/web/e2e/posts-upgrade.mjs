// A browser that has the old site's posts database (version 2, posts kept
// in the account record's copy) opens the new site: its database is upgraded
// in place, its changes go up, the server's newer ones come down, and nothing
// else is written. See helpers.mjs for how to run it.

import { assert, launch, openDashboard, person, post, postIn, rest, serverPost, SITE, slice, step, until } from "./helpers.mjs";

const me = await person("upgrader", 3);
await rest("/rest/v1/account_state", { method: "POST", token: me.session.access_token, body: { user_id: me.id, payload: { revision: "r1", timeZone: "Europe/Amsterdam", notifications: { read: [], cleared: [], seen: {} }, workspaces: { active: "default", list: [{ id: "default", name: "Mine", color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] }] }, slices: { default: slice() } } } });
const { device, finish } = await launch();

const old = (id, extra = {}) => post(id, { createdAt: "2026-10-20T08:00:00.000Z", ...extra });
// The server's copies, as the one-time copy made them; one was edited since, on the new site.
for (const id of ["same", "changed", "edited-elsewhere"]) await rest("/rest/v1/posts", { method: "POST", body: { owner_id: me.id, id, workspace_id: "default", data: old(id) } });
await rest(`/rest/v1/posts?owner_id=eq.${me.id}&id=eq.edited-elsewhere`, { method: "PATCH", body: { data: old("edited-elsewhere", { title: "Newer on the server" }) } });

const D = await device("old browser", me);
await step("a browser with the old site's posts database and fingerprints opens the new site", async () => {
  await D.page.goto(`${SITE}/tools`, { waitUntil: "load" });
  await D.page.evaluate(async ([uid, posts]) => {
    const sync = await import("/src/lib/account-sync.ts");
    // What the old site kept: its posts database at version 2, and what the account's copy last had.
    localStorage.setItem(`plan.video.workspaces.${uid}`, JSON.stringify({ active: "default", list: [{ id: "default", name: "Mine", color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] }] }));
    const known = Object.fromEntries(posts.filter((post) => post.id !== "new").map((post) => [post.id, sync.legacyFingerprint(post.id === "changed" ? { ...post, title: "changed" } : post)]));
    localStorage.setItem(`plan.video.account-known.${uid}`, JSON.stringify({ default: { events: known } }));
    await new Promise((resolve, reject) => {
      const open = indexedDB.open(`plan-video-calendar.${uid}`, 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("calendars", { keyPath: "id" });
        db.createObjectStore("events", { keyPath: "id" });
        db.createObjectStore("media", { keyPath: "id" });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["calendars", "events"], "readwrite");
        tx.objectStore("calendars").put({ id: "posts", name: "Posts", color: "sky", createdAt: "2026-10-01T00:00:00.000Z" });
        for (const post of posts) tx.objectStore("events").put(post);
        tx.oncomplete = () => (db.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, [me.id, [old("same"), old("changed", { title: "Changed here before the move" }), old("edited-elsewhere"), old("new")]]);
  await openDashboard(D);
});

await step("its own change and its new post go up; the server's newer edit comes down; nothing else is written", async () => {
  await until("the new post", () => serverPost(me.id, "new"));
  await until("its change", async () => (await serverPost(me.id, "changed")).data.title === "Changed here before the move");
  await until("the server's edit here", async () => (await postIn(D, "edited-elsewhere"))?.title === "Newer on the server");
  assert.equal((await serverPost(me.id, "same")).version, 1, "an unchanged post isn't sent again");
  assert.equal((await serverPost(me.id, "edited-elsewhere")).data.title, "Newer on the server");
});

await step("its posts database was upgraded in place, keeping the sync's state beside the posts", async () => {
  const stores = await D.page.evaluate(async (uid) => {
    const db = await new Promise((resolve) => { const open = indexedDB.open(`plan-video-calendar.${uid}`); open.onsuccess = () => resolve(open.result); });
    const out = { version: db.version, stores: [...db.objectStoreNames] };
    db.close();
    return out;
  }, me.id);
  assert.equal(stores.version, 3);
  assert.deepEqual(stores.stores.sort(), ["calendars", "events", "media", "syncBases", "syncState"]);
});


await finish();
