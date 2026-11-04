import assert from "node:assert/strict";
import test from "node:test";

import { littleText, pageNumbers, pagesFor } from "../../linkedin/handler.mjs";
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

test("a Page's one picture uses the Images API, since LinkedIn's older uploads refuse a Page", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (String(url).includes("/rest/images")) return Response.json({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/pic/uploaded-image/0", image: "urn:li:image:pic" } });
    if (String(url).includes("/dms-uploads/")) return new Response(null, { status: 201 });
    return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:8" } });
  });
  const media = { stream: async () => new Blob(["x"]).stream() };
  const files = [{ id: "f", key: "posts/u1/f", size: 1, type: "image/jpeg", kind: "image" }];

  const sent = await linkedin.send({ post: { description: "Hi" }, session: PAGE, files, media });
  assert.deepEqual(sent, { state: "processing", publishId: "images:urn:li:image:pic" });
  assert.equal(calls.some((call) => call.url.includes("/assets")), false);
  assert.equal(calls[0].body.initializeUploadRequest.owner, PAGE_URN);

  const delivery = { publish_id: sent.publishId, updated_at: new Date(Date.now() - PICTURES_WAIT_MS).toISOString() };
  assert.deepEqual(await linkedin.check({ session: PAGE, delivery }), { state: "ready" });
  await linkedin.publish({ post: { description: "Hi" }, session: PAGE, delivery });
  assert.equal(calls.at(-1).url, "https://api.linkedin.com/rest/posts");
  assert.equal(calls.at(-1).body.author, PAGE_URN);
  assert.deepEqual(calls.at(-1).body.content, { media: { id: "urn:li:image:pic" } });
});

test("a Page's video uploads part by part, finalizes, waits for LinkedIn, and goes out under the Page", async (t) => {
  const calls = [];
  const parts = [];
  let status = "PROCESSING";
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, method: init.method ?? "GET", headers: init.headers, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (href.includes("action=initializeUpload")) {
      return Response.json({
        value: {
          video: "urn:li:video:vid",
          uploadToken: "tok",
          uploadInstructions: [
            { uploadUrl: "https://www.linkedin.com/dms-uploads/vid/uploadedVideo?pn=1", firstByte: 0, lastByte: 3 },
            { uploadUrl: "https://www.linkedin.com/dms-uploads/vid/uploadedVideo?pn=2", firstByte: 4, lastByte: 5 },
          ],
        },
      });
    }
    if (href.includes("/dms-uploads/")) {
      parts.push(Buffer.from(init.body).toString());
      return new Response(null, { status: 200, headers: { etag: `"part-${parts.length}"` } });
    }
    if (href.includes("action=finalizeUpload")) return new Response(null, { status: 200 });
    if (href.includes("/rest/videos/")) return Response.json({ status });
    return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:ugcPost:8" } });
  });
  // Chunks that don't line up with LinkedIn's parts.
  const media = { stream: async () => new Blob(["ab", "cde", "f"]).stream() };
  const files = [{ id: "f", key: "posts/u1/f", size: 6, type: "video/mp4", kind: "video" }];

  const sent = await linkedin.send({ post: { description: "Hi" }, session: PAGE, files, media });
  assert.deepEqual(sent, { state: "processing", publishId: "video:urn:li:video:vid" });
  assert.deepEqual(calls[0].body, { initializeUploadRequest: { owner: PAGE_URN, fileSizeBytes: 6, uploadCaptions: false, uploadThumbnail: false } });
  assert.equal(calls[0].headers["LinkedIn-Version"], "202609");
  assert.deepEqual(parts, ["abcd", "ef"]);
  assert.equal(calls.filter((call) => call.url.includes("/dms-uploads/")).some((call) => call.headers.Authorization), false);
  const finalize = calls.find((call) => call.url.includes("action=finalizeUpload"));
  assert.deepEqual(finalize.body, { finalizeUploadRequest: { video: "urn:li:video:vid", uploadToken: "tok", uploadedPartIds: ["part-1", "part-2"] } });

  const delivery = { publish_id: sent.publishId, updated_at: new Date().toISOString() };
  assert.deepEqual(await linkedin.check({ session: PAGE, delivery }), { state: "processing", publishId: sent.publishId });
  assert.equal(calls.at(-1).url, "https://api.linkedin.com/rest/videos/urn%3Ali%3Avideo%3Avid");
  status = "AVAILABLE";
  assert.deepEqual(await linkedin.check({ session: PAGE, delivery }), { state: "ready" });
  status = "PROCESSING_FAILED";
  await assert.rejects(linkedin.check({ session: PAGE, delivery }), /couldn't process/);

  await linkedin.publish({ post: { description: "Hi" }, session: PAGE, delivery });
  assert.equal(calls.at(-1).body.author, PAGE_URN);
  assert.deepEqual(calls.at(-1).body.content, { media: { id: "urn:li:video:vid" } });
});

test("a Page's video that loses a part, or gets no receipt for one, is tried again whole", async (t) => {
  for (const answer of [() => new Response(null, { status: 500 }), () => new Response(null, { status: 200 })]) {
    t.mock.method(globalThis, "fetch", async (url) => {
      if (String(url).includes("initializeUpload")) {
        return Response.json({ value: { video: "urn:li:video:vid", uploadToken: "", uploadInstructions: [{ uploadUrl: "https://www.linkedin.com/dms-uploads/vid/uploadedVideo", firstByte: 0, lastByte: 0 }] } });
      }
      if (String(url).includes("/dms-uploads/")) return answer();
      throw new Error(`nothing else should be asked: ${url}`);
    });
    const media = { stream: async () => new Blob(["x"]).stream() };
    const files = [{ id: "f", key: "k", size: 1, type: "video/mp4", kind: "video" }];
    await assert.rejects(linkedin.send({ post: { description: "Hi" }, session: PAGE, files, media }), (error) => error.retry === true);
    t.mock.restoreAll();
  }
});

test("LinkedIn's own reason for refusing a request is what people see", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ message: "Multiple errors occurred during param validation. Please see errorDetails for more information.", errorDetails: { inputErrors: [{ description: "Commentary is too long" }] } }, { status: 400 }),
  );
  await assert.rejects(linkedin.send({ post: { description: "Hi" }, session: PAGE, files: [], media: {} }), /Commentary is too long/);
});

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

const pagePosts = () => [
  { id: "urn:li:share:1", lifecycleState: "PUBLISHED", publishedAt: 1000, createdAt: 900, commentary: "Hello \\(world\\) {hashtag|\\#|launch}\nSecond line" },
  { id: "urn:li:ugcPost:2", lifecycleState: "PUBLISHED", createdAt: 2000, commentary: "Thanks @[Acme](urn:li:organization:9)" },
  { id: "urn:li:share:3", lifecycleState: "DRAFT", createdAt: 3000, commentary: "Not out yet" },
  { id: "urn:li:share:4", lifecycleState: "PUBLISHED", createdAt: 4000, commentary: "Nobody saw this one" },
];

function fakePageApi(t, { posts = pagePosts(), stats = {}, followers = { status: 200, body: { firstDegreeSize: 12 } } } = {}) {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const target = decodeURIComponent(String(url));
    asked.push({ target, headers: init.headers });
    if (target.includes("/rest/posts?")) return posts.status ? Response.json({}, { status: posts.status }) : Response.json({ elements: posts });
    if (target.includes("/networkSizes/")) return Response.json(followers.body, { status: followers.status });
    const kind = target.includes("&shares=") ? "shares" : "ugcPosts";
    const answer = stats[kind] ?? { status: 200, body: { elements: [] } };
    return Response.json(answer.body ?? {}, { status: answer.status });
  });
  return asked;
}

test("a Page's numbers join each published post to its own statistics, and a post with none counts zero", async (t) => {
  const asked = fakePageApi(t, {
    stats: {
      shares: { status: 200, body: { elements: [{ share: "urn:li:share:1", totalShareStatistics: { impressionCount: 500, likeCount: 7, commentCount: 2 } }] } },
      ugcPosts: { status: 200, body: { elements: [{ ugcPost: "urn:li:ugcPost:2", totalShareStatistics: { impressionCount: 80, likeCount: -1, commentCount: 0 } }] } },
    },
  });
  const found = await pageNumbers("token", "42");
  assert.equal(found.followers, 12);
  assert.deepEqual(found.videos, [
    { id: "urn:li:share:1", title: "Hello (world) #launch", postedAt: 1000, cover: "", url: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1/", views: 500, likes: 7, comments: 2 },
    { id: "urn:li:ugcPost:2", title: "Thanks Acme", postedAt: 2000, cover: "", url: "https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A2/", views: 80, likes: 0, comments: 0 },
    { id: "urn:li:share:4", title: "Nobody saw this one", postedAt: 4000, cover: "", url: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A4/", views: 0, likes: 0, comments: 0 },
  ]);
  const list = asked.find((call) => call.target.includes("/rest/posts?"));
  assert.match(list.target, /author=urn:li:organization:42&q=author/);
  assert.equal(list.headers["X-RestLi-Method"], "FINDER");
  assert.ok(asked.some((call) => call.target.includes("&shares=List(urn:li:share:1,urn:li:share:4)")));
  assert.ok(asked.some((call) => call.target.includes("&ugcPosts=List(urn:li:ugcPost:2)")));
  assert.equal(asked.length, 4);
});

test("posts LinkedIn has no activity for yet still show, at zero", async (t) => {
  fakePageApi(t, { stats: { shares: { status: 400 }, ugcPosts: { status: 400 } } });
  const found = await pageNumbers("token", "42");
  assert.equal(found.videos.length, 3);
  assert.ok(found.videos.every((post) => post.views === 0 && post.likes === 0));
});

test("a Page with no posts makes no statistics calls, and followers LinkedIn won't give stay unknown", async (t) => {
  const asked = fakePageApi(t, { posts: [], followers: { status: 403, body: {} } });
  assert.deepEqual(await pageNumbers("token", "42"), { followers: null, videos: [] });
  assert.equal(asked.filter((call) => call.target.includes("ShareStatistics")).length, 0);
});

test("a login without the reading permission, or a role without numbers, is told what to do", async (t) => {
  fakePageApi(t, { posts: { status: 403 } });
  assert.match((await pageNumbers("token", "42")).error, /Add Page/);
  t.mock.restoreAll();
  fakePageApi(t, { stats: { shares: { status: 403 } } });
  assert.match((await pageNumbers("token", "42")).error, /administrators/);
  t.mock.restoreAll();
  fakePageApi(t, { stats: { ugcPosts: { status: 500 } } });
  assert.ok((await pageNumbers("token", "42")).error);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("network down"); });
  assert.match((await pageNumbers("token", "42")).error, /Couldn't reach LinkedIn/);
});
