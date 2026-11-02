import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import sharp from "sharp";

import { PublishError } from "../publisher/errors.mjs";
import { createPhotoMaker } from "../publisher/photo-maker.mjs";
import { handlePhotos } from "./handler.mjs";

const server = createServer((req, res) => void handlePhotos(req, res));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
test.after(() => server.close());
const url = `http://127.0.0.1:${server.address().port}`;
// Through the publisher's own client, so the two can't drift apart.
const maker = createPhotoMaker({ url });

const picture = (width, height, format = "png") => sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } })[format]().toBuffer();
const shapeOf = async (bytes) => {
  const { format, width, height } = await sharp(bytes).metadata();
  return { format, size: [width, height] };
};
const make = (shape, bytes) => maker.make(shape, async () => bytes);
const cantBeMade = (error) => error instanceof PublishError && !error.retry;
/** About 100 MP, yet a few hundred KB: one colour packs small. */
const huge = () => sharp({ create: { width: 10_001, height: 10_000, channels: 3, background: { r: 30, g: 90, b: 200 } } }).jpeg({ quality: 50 }).toBuffer();

test("a TikTok picture is a JPEG of 1080p at most", async () => {
  assert.deepEqual(await shapeOf(await make("tiktok", await picture(3000, 2000))), { format: "jpeg", size: [1620, 1080] });
  assert.deepEqual(await shapeOf(await make("tiktok", await picture(800, 2000, "jpeg"))), { format: "jpeg", size: [768, 1920] });
});

test("a see-through picture goes out on white, as a JPEG would make it black", async () => {
  const clear = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  for (const bytes of [await make("tiktok", clear), await make("feed", clear), (await maker.forBluesky(clear, "image/png", 1)).bytes]) {
    const [red, green, blue] = await sharp(bytes).raw().toBuffer();
    assert.ok(red > 250 && green > 250 && blue > 250, `came out ${red},${green},${blue}`);
  }
});

test("a feed picture is cut to the shapes Instagram's feed takes, from its middle", async () => {
  const shapes = {};
  for (const [id, bytes] of Object.entries({
    tall: await picture(1170, 2532),
    wide: await picture(3000, 1000, "jpeg"),
    square: await picture(1080, 1080, "jpeg"),
    big: await picture(4000, 3000, "jpeg"),
  })) {
    const { format, size } = await shapeOf(await make("feed", bytes));
    assert.equal(format, "jpeg");
    shapes[id] = size;
    const ratio = size[0] / size[1];
    assert.ok(ratio >= 0.8 && ratio <= 1.91, `${id} is ${size[0]}x${size[1]}`);
  }
  assert.deepEqual(shapes.tall, [1170, 1460]);
  assert.deepEqual(shapes.wide, [1440, 758]);
  assert.deepEqual(shapes.square, [1080, 1080]);
  assert.deepEqual(shapes.big, [1440, 1080]);
});

test("a feed picture is turned upright before it's cut, and a long panorama stays 1440 wide", async () => {
  // Stored 3000x1000 but marked as lying on its side, so it's 1000x3000 upright.
  const sideways = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  assert.deepEqual((await shapeOf(await make("feed", sideways))).size, [1000, 1248]);
  assert.deepEqual((await shapeOf(await make("feed", await picture(16000, 2000, "jpeg")))).size, [1440, 758]);
});

test("a picture over Bluesky's limit comes back under it, with the size it now has", async () => {
  // Noise, so it can't pack small.
  const raw = Buffer.alloc(3000 * 2000 * 3);
  for (let index = 0; index < raw.length; index++) raw[index] = (index * 2654435761) >>> 24;
  const noisy = await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  assert.ok(noisy.length > 1_000_000);
  const { bytes, type, aspectRatio } = await maker.forBluesky(noisy, "image/jpeg", 1_000_000);
  assert.ok(bytes.length <= 1_000_000, `${bytes.length} bytes`);
  assert.equal(type, "image/jpeg");
  const { format, size } = await shapeOf(bytes);
  assert.equal(format, "jpeg");
  assert.deepEqual([aspectRatio.width, aspectRatio.height], size);
  assert.ok(Math.max(...size) <= 2000);
});

test("a picture under Bluesky's limit goes as it is, with its size", async () => {
  const bytes = await picture(40, 30);
  assert.deepEqual(await maker.forBluesky(bytes, "image/png", 1_000_000), { bytes, type: "image/png", aspectRatio: { width: 40, height: 30 } });
});

test("a picture with more pixels than any camera makes isn't worked on, whichever network it's for", async () => {
  const bytes = await huge();
  await assert.rejects(make("tiktok", bytes), cantBeMade);
  await assert.rejects(make("feed", bytes), cantBeMade);
  await assert.rejects(maker.forBluesky(bytes, "image/jpeg", 1000), cantBeMade);
});

test("a file that isn't a picture, or is far too big to be one, can't be made and doesn't take the service down", async () => {
  const notPicture = Buffer.from("this is not a picture");
  await assert.rejects(make("tiktok", notPicture), cantBeMade);
  await assert.rejects(maker.forBluesky(notPicture, "image/jpeg", 10), cantBeMade);
  assert.deepEqual(await maker.forBluesky(notPicture, "image/jpeg", 1000), { bytes: notPicture, type: "image/jpeg", aspectRatio: undefined });
  const tooBig = await fetch(`${url}/feed`, { method: "POST", body: Buffer.alloc(33 * 1024 * 1024) });
  assert.equal(tooBig.status, 422);
  assert.match(await tooBig.text(), /Over the size/);
  assert.equal((await shapeOf(await make("tiktok", await picture(40, 30)))).format, "jpeg");
});

test("only the shapes it knows are answered", async () => {
  assert.equal((await fetch(`${url}/`)).status, 404);
  assert.equal((await fetch(`${url}/tiktok`)).status, 404);
  assert.equal((await fetch(`${url}/other`, { method: "POST", body: "x" })).status, 404);
});
