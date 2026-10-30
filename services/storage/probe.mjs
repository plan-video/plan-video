// Runs on the server against the real bucket under a throwaway user id; everything it writes
// is deleted at the end.
import { ROUTES, Refused, deleteKeys, listKeys } from "./server.mjs";

const upload = ROUTES["POST /api/storage/upload-url"];
const read = ROUTES["POST /api/storage/read-url"];
const remove = ROUTES["POST /api/storage/delete"];
const usage = ROUTES["GET /api/storage/usage"];
const settle = ROUTES["POST /api/storage/settle"];
const reads = ROUTES["POST /api/storage/read-urls"];
const list = ROUTES["POST /api/storage/list"];
const erase = ROUTES["POST /api/storage/erase"];

const alice = { id: `probe-${Date.now()}-a`, plan: "free" };
const bob = { id: `probe-${Date.now()}-b`, plan: "free" };
const carol = { id: `probe-${Date.now()}-c`, plan: "pro" };
const dave = { id: `probe-${Date.now()}-d`, plan: "free" };
const erin = { id: `probe-${Date.now()}-e`, plan: "free" };
const frank = { id: `probe-${Date.now()}-f`, plan: "free" };
const results = [];

// These made-up accounts have no deliveries in Supabase: every post of theirs
// counts as sent by the publisher here, but those named unsent-*.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (!String(url).includes("/rest/v1/post_deliveries?")) return realFetch(url, init);
  const posts = new URL(url).searchParams.get("post_id").slice(4, -1).split(",");
  return Promise.resolve(Response.json(posts.filter((post) => !post.startsWith("unsent")).map((post_id) => ({ post_id }))));
};
const record = (name, pass, detail = "") => results.push({ name, pass, detail });
const refused = async (work) => {
  try {
    await work();
    return null;
  } catch (error) {
    if (error instanceof Refused) return error.status;
    throw error;
  }
};
const put = async (signed, bytes, type) =>
  (await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": type }, body: bytes })).status;

try {
  const picture = new Uint8Array(1234).fill(7);
  let signed = await upload(alice, { purpose: "media", id: "item-1", contentType: "image/png", size: picture.length });
  record("a media key sits under the user's own id", signed.key === `media/${alice.id}/item-1`, signed.key);
  record("the upload goes through", (await put(signed, picture, "image/png")) === 200);

  const proj = new TextEncoder().encode('{"projectId":"p1"}');
  signed = await upload(alice, { purpose: "projects", id: "p1", path: "package.json", contentType: "text/plain", size: proj.length });
  record("project files are forced to a plain download type", signed.contentType === "application/octet-stream", signed.contentType);
  record("a project file uploads", (await put(signed, proj, "application/octet-stream")) === 200);

  signed = await upload(alice, { purpose: "projects", id: "p1", path: "assets/empty.txt", size: 0 });
  record("an empty project file uploads", (await put(signed, new Uint8Array(), "application/octet-stream")) === 200);
  record("an empty picture is refused", (await refused(() => upload(alice, { purpose: "media", id: "e", contentType: "image/png", size: 0 }))) === 400);

  record("a path that climbs out is refused", (await refused(() => upload(alice, { purpose: "projects", id: "p1", path: "../../posts/x", size: 10 }))) === 400);
  record("an id with a slash is refused", (await refused(() => upload(alice, { purpose: "media", id: "../bob", contentType: "image/png", size: 10 }))) === 400);
  record("an unknown purpose is refused", (await refused(() => upload(alice, { purpose: "secrets", id: "x", contentType: "image/png", size: 10 }))) === 400);
  record("a picture over 8 MB is refused", (await refused(() => upload(alice, { purpose: "media", id: "big", contentType: "image/png", size: 9 * 1024 * 1024 }))) === 400);
  record("a video over 500 MB is refused", (await refused(() => upload(alice, { purpose: "posts", id: "big", contentType: "video/mp4", size: 501 * 1024 * 1024 }))) === 400);
  record("a type that isn't a picture or video is refused", (await refused(() => upload(alice, { purpose: "media", id: "x", contentType: "text/html", size: 10 }))) === 400);

  const mine = await usage(alice);
  record("usage counts what was stored", mine.used === picture.length + proj.length, `${mine.used} bytes`);
  record("usage splits it by purpose", mine.parts.media === picture.length && mine.parts.projects === proj.length && mine.parts.posts === 0, JSON.stringify(mine.parts));
  record("Free has 5 GB", mine.plan === "free" && mine.limit === 5e9, `${mine.limit}`);
  record("Pro has 150 GB", (await usage(carol)).limit === 150e9);

  const room = mine.limit - mine.used;
  for (let index = 0; room - index * 400 * 1024 * 1024 > 0; index++) {
    // Signing counts the space before the file arrives, so these links fill the quota unused.
    const size = Math.min(400 * 1024 * 1024, room - index * 400 * 1024 * 1024);
    await upload(alice, { purpose: "posts", id: `fill-${index}`, contentType: "video/mp4", size });
  }
  record("an upload past the Free 5 GB is refused", (await refused(() => upload(alice, { purpose: "posts", id: "over", contentType: "video/mp4", size: 1 }))) === 413);

  const theirs = await read(bob, { purpose: "media", id: "item-1" });
  record("another user asking for the same id gets their own key, not this one", theirs.key === `media/${bob.id}/item-1`, theirs.key);
  record("so they cannot read this user's file", (await fetch(theirs.url)).status === 404);

  const own = await read(alice, { purpose: "media", id: "item-1" });
  const back = await fetch(own.url);
  record("the owner can read their file back", back.ok && (await back.arrayBuffer()).byteLength === picture.length);

  const listed = await list(alice, { purpose: "projects" });
  record("listing gives each project file with its id and path", listed.files.length === 2 && listed.files.every((file) => file.id === "p1" && file.at > 0), JSON.stringify(listed.files));
  record("another user lists none of them", (await list(bob, { purpose: "projects" })).files.length === 0);
  record("only projects can be listed", (await refused(() => list(alice, { purpose: "media" }))) === 400);
  const many = await reads(alice, { targets: [{ purpose: "media", id: "item-1" }, { purpose: "projects", id: "p1", path: "package.json" }] });
  record("read links come back for many files at once", many.links.length === 2 && (await fetch(many.links[1].url)).ok);
  record("those keys sit under the user's own id too", (await reads(bob, { targets: [{ purpose: "media", id: "item-1" }] })).links[0].key === `media/${bob.id}/item-1`);
  record("a bad target in a batch is refused", (await refused(() => reads(alice, { targets: [{ purpose: "projects", id: "p1", path: "../x" }] }))) === 400);
  record("too many reads at once are refused", (await refused(() => reads(alice, { targets: Array.from({ length: 101 }, (_, i) => ({ purpose: "media", id: `x${i}` })) }))) === 400);

  await remove(bob, { purpose: "media", ids: ["item-1"] });
  record("another user's delete doesn't touch this user's file", (await listKeys(`media/${alice.id}/`)).length === 1);

  await remove(alice, { purpose: "media", ids: ["item-1"] });
  record("deleting media removes it", (await listKeys(`media/${alice.id}/`)).length === 0);
  await remove(alice, { purpose: "projects", id: "p1" });
  record("deleting a project removes all its files", (await listKeys(`projects/${alice.id}/`)).length === 0);

  const clip = new Uint8Array(2000).fill(3);
  signed = await upload(dave, { purpose: "posts", id: "clip", contentType: "video/mp4", size: clip.length });
  await put(signed, clip, "video/mp4");
  record("a waiting post's file counts", (await usage(dave)).parts.posts === clip.length);
  let moved = await settle(dave, { files: [{ id: "clip", size: clip.length }, { id: "nothing-here", size: 5 }] });
  record("settling moves the file to sent/", moved.sent.length === 1 && moved.sent[0].key === `sent/${dave.id}/clip`, JSON.stringify(moved));
  record("settling an id with no file says it's missing", moved.missing.length === 1 && moved.missing[0] === "nothing-here");
  record("the file left posts/ and sits in sent/", (await listKeys(`posts/${dave.id}/`)).length === 0 && (await listKeys(`sent/${dave.id}/`)).length === 1);
  const after = await usage(dave);
  // Its upload link still works, so it's held on the plan until the link is long dead.
  record("a sent file is counted only as held while its link lives", after.used === clip.length && !("sent" in after.parts), JSON.stringify(after.parts));
  moved = await settle(dave, { files: [{ id: "clip", size: clip.length }] });
  record("settling again is a no-op that still says sent", moved.sent.length === 1 && moved.missing.length === 0);
  const sentRead = await read(dave, { purpose: "posts", id: "clip" });
  const sentBack = await fetch(sentRead.url);
  record("a post's file still reads from sent/", sentRead.key === `sent/${dave.id}/clip` && sentBack.ok && (await sentBack.arrayBuffer()).byteLength === clip.length, sentRead.key);
  record("it keeps its video type", sentBack.headers.get("content-type") === "video/mp4", sentBack.headers.get("content-type") ?? "");
  record("another user can't settle it", (await settle(bob, { files: [{ id: "clip", size: clip.length }] })).missing[0] === "clip" && (await listKeys(`sent/${dave.id}/`)).length === 1);
  record("another user can't read it", (await fetch((await read(bob, { purpose: "posts", id: "clip" })).url)).status === 404);

  signed = await upload(dave, { purpose: "posts", id: "late", contentType: "video/mp4", size: clip.length, sent: true });
  record("a post that went out with no copy uploads straight to sent/", signed.key === `sent/${dave.id}/late`, signed.key);
  await put(signed, clip, "video/mp4");
  record("and doesn't count either", (await usage(dave)).used === after.used);
  signed = await upload(dave, { purpose: "posts", id: "unsent-1", contentType: "video/mp4", size: clip.length, sent: true });
  record("a post that didn't go out can't upload to sent/", signed.key === `posts/${dave.id}/unsent-1`, signed.key);
  await put(signed, clip, "video/mp4");
  moved = await settle(dave, { files: [{ id: "unsent-1", size: clip.length }] });
  record("nor be settled there", moved.unsent[0] === "unsent-1" && (await listKeys(`posts/${dave.id}/unsent-1`)).length === 1, JSON.stringify(moved));
  await remove(dave, { purpose: "posts", ids: ["unsent-1"] });
  record("only a post's file can go to sent/", (await refused(() => upload(dave, { purpose: "media", id: "x", contentType: "image/png", size: 10, sent: true }))) === 400);
  record("a settle with nothing in it is refused", (await refused(() => settle(dave, { files: [] }))) === 400);
  record("a settle with a bad id is refused", (await refused(() => settle(dave, { files: [{ id: "../x", size: 1 }] }))) === 400);
  record("a settle with no size is refused", (await refused(() => settle(dave, { files: [{ id: "x" }] }))) === 400);
  record("a settle of too many is refused", (await refused(() => settle(dave, { files: Array.from({ length: 101 }, (_, i) => ({ id: `x${i}`, size: 1 })) }))) === 400);

  // An older file left under the post's id is never kept as what went out.
  const older = new Uint8Array(1500).fill(1);
  const newer = new Uint8Array(1700).fill(2);
  signed = await upload(dave, { purpose: "posts", id: "swap", contentType: "video/mp4", size: older.length });
  await put(signed, older, "video/mp4");
  moved = await settle(dave, { files: [{ id: "swap", size: newer.length }] });
  record("an older file isn't moved in place of the one that went out", moved.missing[0] === "swap" && (await listKeys(`sent/${dave.id}/swap`)).length === 0, JSON.stringify(moved));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  signed = await upload(dave, { purpose: "posts", id: "swap", contentType: "video/mp4", size: newer.length, sent: true });
  await put(signed, newer, "video/mp4");
  let swap = await read(dave, { purpose: "posts", id: "swap" });
  record("the newer file in sent/ reads over the older one in posts/", swap.key === `sent/${dave.id}/swap` && (await (await fetch(swap.url)).arrayBuffer()).byteLength === newer.length, swap.key);
  record("settling then says it's sent", (await settle(dave, { files: [{ id: "swap", size: newer.length }] })).sent[0]?.id === "swap");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  signed = await upload(dave, { purpose: "posts", id: "swap", contentType: "video/mp4", size: older.length });
  await put(signed, older, "video/mp4");
  swap = await read(dave, { purpose: "posts", id: "swap" });
  record("a post moved back to drafts reads its new posts/ file", swap.key === `posts/${dave.id}/swap`, swap.key);
  moved = await settle(dave, { files: [{ id: "swap", size: older.length }] });
  record("posting it again moves that file over the old one", moved.sent[0]?.id === "swap" && (await listKeys(`posts/${dave.id}/`)).length === 0 && (await listKeys(`sent/${dave.id}/swap`))[0]?.size === older.length);
  await remove(dave, { purpose: "posts", ids: ["swap"] });

  await remove(dave, { purpose: "posts", ids: ["clip", "late"] });
  record("deleting a post removes its sent/ file", (await listKeys(`sent/${dave.id}/`)).length === 0);

  // The sent/ ceiling: 50 GB on Free. A fresh account: dave's links above are still held.
  for (let index = 0; index < 100; index++) {
    await upload(frank, { purpose: "posts", id: `hist-${index}`, contentType: "video/mp4", size: 500 * 1000 * 1000, sent: true });
  }
  record("past the sent/ ceiling, uploads are refused with their own status", (await refused(() => upload(frank, { purpose: "posts", id: "more", contentType: "video/mp4", size: 1, sent: true }))) === 507);
  signed = await upload(frank, { purpose: "posts", id: "waiting", contentType: "video/mp4", size: clip.length });
  await put(signed, clip, "video/mp4");
  moved = await settle(frank, { files: [{ id: "waiting", size: clip.length }] });
  record("past the ceiling, a file stays in posts/", moved.full[0] === "waiting" && (await listKeys(`posts/${frank.id}/`)).length === 1, JSON.stringify(moved));

  // Deleting the account erases every file it stores, and only its own.
  const bit = new Uint8Array(10).fill(3);
  for (const [target, type, sent] of [
    [{ purpose: "media", id: "m" }, "image/png", false],
    [{ purpose: "posts", id: "w" }, "video/mp4", false],
    [{ purpose: "posts", id: "s" }, "video/mp4", true],
    [{ purpose: "projects", id: "p", path: "package.json" }, "application/octet-stream", false],
  ]) {
    await put(await upload(erin, { ...target, contentType: type, size: bit.length, ...(sent ? { sent: true } : {}) }), bit, type);
  }
  await put(await upload(bob, { purpose: "media", id: "keep", contentType: "image/png", size: bit.length }), bit, "image/png");
  const stored = async (user) => (await Promise.all(["media", "posts", "projects", "sent"].map((purpose) => listKeys(`${purpose}/${user.id}/`)))).flat().length;
  record("erasing needs to be asked for in so many words", (await refused(() => erase(erin, {}))) === 400 && (await stored(erin)) === 4);
  const erased = await erase(erin, { everything: true });
  record("erasing removes every file of the account", erased.deleted === 4 && (await stored(erin)) === 0, JSON.stringify(erased));
  record("and leaves other accounts' files alone", (await listKeys(`media/${bob.id}/keep`)).length === 1);

  record("a delete of too many files at once is refused", (await refused(() => remove(alice, { purpose: "media", ids: Array.from({ length: 201 }, (_, i) => `x${i}`) }))) === 400);
} finally {
  for (const user of [alice, bob, carol, dave, erin, frank]) {
    for (const purpose of ["media", "posts", "projects", "sent"]) {
      const left = (await listKeys(`${purpose}/${user.id}/`)).map((item) => item.key);
      if (left.length) await deleteKeys(left);
    }
  }
}

for (const row of results) console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.name}${row.detail ? `  (${row.detail})` : ""}`);
process.exitCode = results.every((row) => row.pass) ? 0 : 1;
