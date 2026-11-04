import assert from "node:assert/strict";
import test from "node:test";

import { littleText, pagesFor } from "../../linkedin/handler.mjs";
import { PICTURES_WAIT_MS, linkedin } from "./linkedin.mjs";

test("checking on a file only asks LinkedIn about it, and publish makes the post with it", async (t) => {
  const made = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (init.method === "POST") {
      made.push(JSON.parse(init.body));
      return new Response("{}", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
    }
    return Response.json({ recipes: [{ status: "AVAILABLE" }] });
  });
  const session = { accessToken: "a", personId: "p1" };
  const delivery = { publish_id: "video:urn:li:digitalmediaAsset:abc", updated_at: new Date().toISOString() };

  assert.deepEqual(await linkedin.check({ session, delivery }), { state: "ready" });
  assert.equal(made.length, 0);

  const sent = await linkedin.publish({ post: { captions: { linkedin: "Hi" } }, session, delivery });
  assert.equal(made.length, 1);
  const content = made[0].specificContent["com.linkedin.ugc.ShareContent"];
  assert.equal(content.shareCommentary.text, "Hi");
  assert.equal(content.shareMediaCategory, "VIDEO");
  assert.deepEqual(content.media, [{ status: "READY", media: "urn:li:digitalmediaAsset:abc" }]);
  assert.equal(sent.publishId, "urn:li:share:1");
});

test("several pictures upload through the Images API and go out as one post with all of them", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (String(url).includes("/rest/images")) {
      const n = calls.filter((call) => call.url.includes("/rest/images")).length;
      return Response.json({ value: { uploadUrl: `https://www.linkedin.com/dms-uploads/up${n}/uploaded-image/0`, image: `urn:li:image:pic${n}` } });
    }
    if (String(url).includes("/dms-uploads/")) return new Response(null, { status: 201 });
    return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
  });
  const session = { accessToken: "a", personId: "p1" };
  const media = { stream: async () => new Blob(["x"]).stream() };
  const files = ["p1", "p1_2", "p1_3"].map((id) => ({ id, key: `posts/u1/${id}`, size: 1, type: "image/jpeg", kind: "image" }));

  const sent = await linkedin.send({ post: { description: "Hi" }, session, files, media });
  assert.deepEqual(sent, { state: "processing", publishId: "images:urn:li:image:pic1,urn:li:image:pic2,urn:li:image:pic3" });
  const started = calls.filter((call) => call.url.includes("/rest/images"));
  assert.equal(started.length, 3);
  assert.deepEqual(started[0].body, { initializeUploadRequest: { owner: "urn:li:person:p1" } });
  assert.equal(started[0].headers["LinkedIn-Version"], "202609");
  assert.equal(calls.filter((call) => call.method === "PUT").length, 3);

  const delivery = { publish_id: sent.publishId, updated_at: new Date(Date.now() - 5_000).toISOString() };
  calls.length = 0;
  assert.deepEqual(await linkedin.check({ session, delivery }), { state: "processing", publishId: sent.publishId });
  delivery.updated_at = new Date(Date.now() - PICTURES_WAIT_MS).toISOString();
  assert.deepEqual(await linkedin.check({ session, delivery }), { state: "ready" });
  assert.equal(calls.length, 0);

  const made = await linkedin.publish({ post: { description: "Three (of them) #launch" }, session, delivery });
  assert.equal(made.publishId, "urn:li:share:9");
  const [post] = calls;
  assert.equal(post.url, "https://api.linkedin.com/rest/posts");
  assert.equal(post.body.author, "urn:li:person:p1");
  assert.equal(post.body.commentary, "Three \\(of them\\) #launch");
  assert.deepEqual(post.body.content, { multiImage: { images: [{ id: "urn:li:image:pic1" }, { id: "urn:li:image:pic2" }, { id: "urn:li:image:pic3" }] } });
});

test("one picture still goes out through the API LinkedIn has always taken", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    if (String(url).includes("registerUpload")) {
      return Response.json({
        value: {
          asset: "urn:li:digitalmediaAsset:one",
          uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: "https://api.linkedin.com/mediaUpload/one" } },
        },
      });
    }
    return new Response(null, { status: 201 });
  });
  const files = [{ id: "p1", key: "posts/u1/p1", size: 1, type: "image/png", kind: "image" }];
  const sent = await linkedin.send({ post: { description: "" }, session: { accessToken: "a", personId: "p1" }, files, media: { stream: async () => new Blob(["x"]).stream() } });
  assert.deepEqual(sent, { state: "processing", publishId: "image:urn:li:digitalmediaAsset:one" });
  assert.ok(urls[0].includes("/v2/assets?action=registerUpload"));
});

test("LinkedIn's reserved characters show as typed, and #words stay hashtags", () => {
  assert.equal(littleText("Hi (all) — 50% off_today *now* @you [1] {x} <y> a|b ~c \\d"), "Hi \\(all\\) — 50% off\\_today \\*now\\* \\@you \\[1\\] \\{x\\} \\<y\\> a\\|b \\~c \\\\d");
  assert.equal(littleText("#launch day #2026\nnew #café"), "#launch day #2026\nnew #café");
  assert.equal(littleText("C# and a#b and # alone"), "C\\# and a\\#b and \\# alone");
});

const PAGE = { accessToken: "a", organizationId: "42" };
const PAGE_URN = "urn:li:organization:42";

test("a Page posts as itself through the versioned API, and a person's post doesn't", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:7" } });
  });

  const sent = await linkedin.send({ post: { description: "Hi (all) #news" }, session: PAGE, files: [], media: {} });
  assert.equal(sent.publishId, "urn:li:share:7");
  assert.equal(calls[0].url, "https://api.linkedin.com/rest/posts");
  assert.equal(calls[0].headers["LinkedIn-Version"], "202609");
  assert.equal(calls[0].body.author, PAGE_URN);
  assert.equal(calls[0].body.commentary, "Hi \\(all\\) #news");
  assert.equal("content" in calls[0].body, false);

  await linkedin.send({ post: { description: "Hi" }, session: { accessToken: "a", personId: "p1" }, files: [], media: {} });
  assert.equal(calls[1].url, "https://api.linkedin.com/v2/ugcPosts");
  assert.equal(calls[1].body.author, "urn:li:person:p1");
});

for (const [kind, type, urn] of [["video", "video/mp4", "urn:li:video:abc"], ["image", "image/jpeg", "urn:li:image:abc"]]) {
  test(`a Page's ${kind} uploads and goes out under the Page`, async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      if (String(url).includes("registerUpload")) {
        return Response.json({
          value: {
            asset: "urn:li:digitalmediaAsset:abc",
            uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: "https://www.linkedin.com/dms-uploads/abc/0" } },
          },
        });
      }
      if (String(url).includes("/dms-uploads/")) return new Response(null, { status: 201 });
      if (String(url).includes("/rest/assets/")) return Response.json({ recipes: [{ status: "AVAILABLE" }] });
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:ugcPost:8" } });
    });
    const media = { stream: async () => new Blob(["x"]).stream() };
    const files = [{ id: "f", key: "posts/u1/f", size: 1, type, kind }];

    const sent = await linkedin.send({ post: { description: "Hi" }, session: PAGE, files, media });
    assert.deepEqual(sent, { state: "processing", publishId: `${kind}:urn:li:digitalmediaAsset:abc` });
    assert.equal(calls[0].url, "https://api.linkedin.com/rest/assets?action=registerUpload");
    assert.equal(calls[0].headers["LinkedIn-Version"], "202609");
    assert.equal(calls[0].body.registerUploadRequest.owner, PAGE_URN);

    const delivery = { publish_id: sent.publishId, updated_at: new Date().toISOString() };
    assert.deepEqual(await linkedin.check({ session: PAGE, delivery }), { state: "ready" });
    assert.equal(calls.at(-1).url, "https://api.linkedin.com/rest/assets/abc");
    assert.equal(calls.at(-1).headers["LinkedIn-Version"], "202609");

    await linkedin.publish({ post: { description: "Hi" }, session: PAGE, delivery });
    assert.equal(calls.at(-1).url, "https://api.linkedin.com/rest/posts");
    assert.equal(calls.at(-1).body.author, PAGE_URN);
    assert.deepEqual(calls.at(-1).body.content, { media: { id: urn } });
  });
}

test("a Page's several pictures are owned by the Page, and its follow-ups comment as the Page", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (String(url).includes("/rest/images")) return Response.json({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/up/0", image: "urn:li:image:pic" } });
    if (String(url).includes("/dms-uploads/")) return new Response(null, { status: 201 });
    return Response.json({}, { status: 201, headers: { "x-restli-id": "99" } });
  });
  const media = { stream: async () => new Blob(["x"]).stream() };
  const files = ["a", "b"].map((id) => ({ id, key: `posts/u1/${id}`, size: 1, type: "image/jpeg", kind: "image" }));

  await linkedin.send({ post: { description: "Hi" }, session: PAGE, files, media });
  assert.equal(calls[0].body.initializeUploadRequest.owner, PAGE_URN);

  calls.length = 0;
  await linkedin.reply({ session: PAGE, text: "More", root: "urn:li:share:7" });
  assert.equal(calls[0].url, "https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7/comments");
  assert.equal(calls[0].headers["LinkedIn-Version"], "202609");
  assert.deepEqual(calls[0].body, { actor: PAGE_URN, object: "urn:li:share:7", message: { text: "More" } });
});

test("only Pages the member has an approved posting role on are found, each once", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(String(url));
    if (String(url).includes("organizationAcls")) {
      return Response.json({
        elements: [
          { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:1" },
          { role: "CONTENT_ADMINISTRATOR", state: "APPROVED", organizationTarget: "urn:li:organization:2" },
          { role: "ADMINISTRATOR", state: "APPROVED", organizationTarget: "urn:li:organization:1" },
          { role: "ANALYST", state: "APPROVED", organization: "urn:li:organization:3" },
          { role: "ADMINISTRATOR", state: "REQUESTED", organization: "urn:li:organization:4" },
          { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:school:5" },
        ],
      });
    }
    return String(url).endsWith("/organizations/1") ? Response.json({ localizedName: " Acme " }) : Response.json({ message: "no" }, { status: 403 });
  });

  assert.deepEqual(await pagesFor("a"), { pages: [{ organizationId: "1", name: "Acme" }, { organizationId: "2", name: "LinkedIn Page" }] });
  assert.equal(asked[0], "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100");
});
