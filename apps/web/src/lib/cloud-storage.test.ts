/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("somoto", () => ({ toast: { error: () => {} } }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { onAuthStateChange: () => {} } } }));
vi.stubGlobal("window", { addEventListener: () => {} });
vi.stubEnv("PROD", true);

const { CloudError, cloudUploads, queueCloud } = await import("./cloud-storage");

const turn = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe("uploads a closing tab would stop", () => {
  test("a job counts while it waits and while it runs, and stops counting once it's done", async () => {
    let finish = () => {};
    queueCloud("posts:a", () => new Promise<void>((resolve) => (finish = resolve)));
    queueCloud("posts:b", async () => {});
    expect([...cloudUploads()]).toEqual(["posts:a", "posts:b"]);
    await turn();
    expect(cloudUploads().has("posts:a")).toBe(true);
    finish();
    await turn();
    expect(cloudUploads().size).toBe(0);
  });

  test("one that storage refused doesn't count, since staying wouldn't help", async () => {
    queueCloud("posts:full", async () => {
      throw new CloudError(413, "Full");
    });
    queueCloud("posts:refused", async () => {
      throw new CloudError(400, "Refused");
    });
    await turn();
    expect(cloudUploads().size).toBe(0);
  });

  test("one held because storage can't be reached still counts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    queueCloud("posts:offline", async () => {
      throw new TypeError("Failed to fetch");
    });
    for (let tries = 0; tries < 3; tries++) {
      await turn();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    }
    expect(cloudUploads().has("posts:offline")).toBe(true);
  });
});
