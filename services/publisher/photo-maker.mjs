// Pictures are made by services/photos, so a bad file never reaches the process holding the logins.
// Its answers are treated as untrusted too: bytes to pass on, never to decode here.

import { PublishError } from "./errors.mjs";

/** Pictures made at once, which also caps how many this process holds waiting on them. */
const AT_ONCE = 2;
const TIMEOUT_MS = 2 * 60_000;
const SIZE_TIMEOUT_MS = 10_000;
/** Well above any picture it makes, all of them within 1920 by 1920. */
const MAX_ANSWER = 16 * 1024 * 1024;

export function createPhotoMaker({ url }) {
  let running = 0;
  const waiting = [];
  async function inTurn(work) {
    if (running >= AT_ONCE) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try {
      return await work();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  async function ask(path, bytes, timeout = TIMEOUT_MS) {
    const unavailable = () => new PublishError("plan.video couldn't prepare a picture just now. Trying again soon.", { retry: true });
    try {
      const response = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes, signal: AbortSignal.timeout(timeout) });
      if (response.status === 422) {
        await response.body?.cancel();
        throw new PublishError("That picture is damaged or too large. Attach another one.");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw unavailable();
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_ANSWER) throw unavailable();
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      throw error instanceof PublishError ? error : unavailable();
    }
  }

  const sizeOf = async (bytes) => {
    try {
      const { width, height } = JSON.parse(await ask("/size", bytes, SIZE_TIMEOUT_MS));
      return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    /** `shape` is "tiktok" or "feed". `load` runs in turn, so waiting pictures aren't held in memory. */
    make: (shape, load) => inTurn(async () => ask(`/${shape}`, await load())),

    /** A picture under `limit` goes as it is. Its size only helps the layout, so a post never fails for it. */
    forBluesky: (bytes, type, limit) =>
      inTurn(async () => {
        const ready = bytes.length <= limit ? { bytes, type } : { bytes: await ask("/bluesky", bytes), type: "image/jpeg" };
        return { ...ready, aspectRatio: await sizeOf(ready.bytes) };
      }),
  };
}
