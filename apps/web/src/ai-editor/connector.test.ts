/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, expect, test, vi } from "vitest";

let token = "first";
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: token } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

const sent: { type: string; token?: string }[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onmessage?: unknown;
  onclose?: unknown;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  send(text: string) {
    sent.push(JSON.parse(text));
  }
  close() {}
}
vi.stubGlobal("WebSocket", FakeSocket);
vi.stubGlobal("window", { location: { href: "https://plan.video/dashboard" }, addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: "hidden" });

const { connectClaude } = await import("./connector");

afterEach(() => vi.useRealTimers());

test("a connected tab sends each new sign-in token over the socket, once, without being asked", async () => {
  vi.useFakeTimers();
  const stop = connectClaude(async () => ({ text: "" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toEqual([{ type: "hello", token: "first" }]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sent).toHaveLength(1);
  token = "second";
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sent.slice(1)).toEqual([{ type: "token", token: "second" }]);
  stop();
});
