import { PublishError } from "./errors.mjs";

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
