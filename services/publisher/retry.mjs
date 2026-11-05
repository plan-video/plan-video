import { PublishError } from "./errors.mjs";

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** About a minute, for a database blip while a row is ours: left as it is, a row nothing was sent for reads as one that may have gone out. */
export const SETTLE_WAITS_MS = [2_000, 8_000, 20_000, 30_000];

/** `work`, then again after each of `waits` while it fails. A refusal that trying again can't change is thrown at once. */
export async function withRetries(work, waits, wait = pause) {
  for (let index = 0; ; index++) {
    try {
      return await work();
    } catch (error) {
      if ((error instanceof PublishError && !error.retry) || index >= waits.length) throw error;
      await wait(waits[index]);
    }
  }
}
