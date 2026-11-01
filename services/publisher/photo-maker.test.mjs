import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { createPhotoMaker } from "./photo-maker.mjs";

/** A stand-in for services/photos that answers whatever a test says. */
async function service(t, answer) {
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    answer(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return createPhotoMaker({ url: `http://127.0.0.1:${server.address().port}` });
}

const send = (status, body = "", type = "text/plain") => (_req, res) => {
  res.writeHead(status, { "Content-Type": type, Connection: "close" });
  res.end(body);
};
const load = async () => Buffer.from("picture");

test("a picture the service can't make isn't tried again; a service that's down or failing is", async (t) => {
  const refused = await service(t, send(422, "Input image exceeds pixel limit"));
  await assert.rejects(refused.make("tiktok", load), (error) => error instanceof PublishError && !error.retry && /damaged or too large/.test(error.message));

  const failing = await service(t, send(500));
  await assert.rejects(failing.make("tiktok", load), (error) => error instanceof PublishError && error.retry);

  const down = createPhotoMaker({ url: "http://127.0.0.1:1" });
  await assert.rejects(down.make("feed", load), (error) => error instanceof PublishError && error.retry);
});

test("an answer too large to be a picture is turned down, not kept in memory", async (t) => {
  const piece = Buffer.alloc(1024 * 1024);
  const maker = await service(t, (_req, res) => {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    for (let index = 0; index < 17; index++) res.write(piece);
    res.end();
  });
  await assert.rejects(maker.make("tiktok", load), (error) => error instanceof PublishError && error.retry);
});

test("at most two pictures are made at once, and one waiting isn't loaded until its turn", async (t) => {
  const maker = await service(t, send(200, "jpeg", "image/jpeg"));
  const held = [];
  const loaded = [];
  const picture = (name) => () => {
    loaded.push(name);
    return new Promise((resolve) => held.push(() => resolve(Buffer.from(name))));
  };
  const made = ["a", "b", "c"].map((name) => maker.make("tiktok", picture(name)));
  assert.deepEqual(loaded, ["a", "b"]);
  held[0]();
  await made[0];
  assert.deepEqual(loaded, ["a", "b", "c"]);
  held[1]();
  held[2]();
  await Promise.all(made);
});

test("a small picture still goes to Bluesky, without its shape, when its size can't be had", async (t) => {
  const bytes = Buffer.from("small");
  const asIs = { bytes, type: "image/png", aspectRatio: undefined };
  assert.deepEqual(await createPhotoMaker({ url: "http://127.0.0.1:1" }).forBluesky(bytes, "image/png", 100), asIs);
  for (const nonsense of ['{"width":"x","height":1}', '{"width":0,"height":10}', '{"width":1.5,"height":10}', "not json"]) {
    const maker = await service(t, send(200, nonsense, "application/json"));
    assert.deepEqual(await maker.forBluesky(bytes, "image/png", 100), asIs, nonsense);
  }
});

test("a picture over Bluesky's limit waits for the service to come back rather than going out as it is", async () => {
  const down = createPhotoMaker({ url: "http://127.0.0.1:1" });
  await assert.rejects(down.forBluesky(Buffer.alloc(200), "image/png", 100), (error) => error instanceof PublishError && error.retry);
});
