/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, it } from "vitest";
import { AgentChatClient } from "../src/client";

class FakeSocket {
  static last: FakeSocket;
  readonly OPEN = 1;
  readyState = 1;
  sent: { id: string; method: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {}
  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

it("keeps events that arrive in the same tick as the snapshot", async () => {
  const client = new AgentChatClient({ resolveEndpoint: async () => "ws://x", WebSocket: FakeSocket as unknown as typeof WebSocket });
  await new Promise<void>((resolve) => {
    client.onState((state) => state === "open" && resolve());
    client.connect();
  });
  const seen: string[] = [];
  client.open("c", (message) => seen.push(message.type === "snapshot" ? "snapshot" : `event ${message.seq}`));
  const socket = FakeSocket.last;
  const open = socket.sent.find((m) => m.method === "chats.open")!;
  const event = (seq: number) => ({ t: "event", chatId: "c", seq, event: { type: "item.delta", itemId: "a", text: "x" } });
  socket.deliver(event(4));
  socket.deliver({ t: "res", id: open.id, ok: true, data: { chat: {}, items: [], seq: 5, pending: null } });
  socket.deliver(event(5));
  socket.deliver(event(6));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  socket.deliver(event(7));
  expect(seen).toEqual(["snapshot", "event 6", "event 7"]);
});
