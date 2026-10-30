/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Asset } from "@plan.video/assets";

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || `Assertion failed: ${String(condition)}`);
  }
}

export function assertAllSettled(results: PromiseSettledResult<void>[]) {
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  assert(errors.length === 0, `${errors.length} pipeline stage(s) failed:\n${errors.map((err) => err instanceof Error ? err.message : String(err)).join("\n")}`);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function attempt<T>(fn: () => T): { result: T } | { error: Error } {
  try {
    return { result: fn() };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error };
    }
    return { error: new Error('Unknown error') };
  }
}

export class AsyncMutex {
  currentPromise = Promise.resolve();

  async acquire() {
    let resolver: () => void;
    const nextPromise = new Promise<void>(resolve => {
      resolver = resolve;
    });

    const currentPromiseAlias = this.currentPromise;
    this.currentPromise = nextPromise;

    await currentPromiseAlias;

    return resolver!;
  }
}

export function formatAssetDuration(asset: Pick<Asset, 'type'> & { duration?: number } | null | undefined): string | null {
  if (asset?.type != "VIDEO" && asset?.type != "AUDIO" && asset?.type != "SEQUENCE") {
    return null;
  }

  const seconds = asset.duration ?? NaN;
  if (!Number.isFinite(seconds)) return "0:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remaining
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

/** Non-inclusive. */
export function intersect(range1: [number, number], range2: [number, number]): boolean {
  const [x1, x2] = range1;
  const [y1, y2] = range2;

  return x1 < y2 && y1 < x2;
}
