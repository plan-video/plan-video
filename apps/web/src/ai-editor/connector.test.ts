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
const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  constructor() {
    sockets.push(this);
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

afterEach(() => {
  vi.useRealTimers();
  sent.length = 0;
  token = "first";
});

test("a call queued on a socket that has since closed doesn't run", async () => {
  vi.useFakeTimers();
  sockets.length = 0;
  let finish = () => {};
  const ran: string[] = [];
  const stop = connectClaude(async (tool) => {
    ran.push(tool);
    if (tool === "first") await new Promise<void>((resolve) => (finish = resolve));
    return { text: "" };
  });
  await vi.advanceTimersByTimeAsync(0);
  const ws = sockets[0]!;
  ws.onmessage?.({ data: JSON.stringify({ type: "call", id: "1", tool: "first" }) });
  ws.onmessage?.({ data: JSON.stringify({ type: "call", id: "2", tool: "second" }) });
  await vi.advanceTimersByTimeAsync(0);
  ws.onclose?.();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(ran).toEqual(["first"]);
  stop();
});

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
