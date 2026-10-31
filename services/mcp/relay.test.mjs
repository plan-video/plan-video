/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_TAB, noTab, Relay, RelayError } from "./relay.mjs";

function socket() {
  return {
    sent: [],
    closed: null,
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

test("a call with no tab open says to open one", async () => {
  const relay = new Relay();
  await assert.rejects(relay.call("alice", "get_editor_state", {}), (error) => error instanceof RelayError && error.message === NO_TAB);
  assert.match(NO_TAB, /open https:\/\/plan\.video in their browser/);
});

test("a copy hosted elsewhere names its own site to open", async () => {
  const relay = new Relay({ site: "https://social.example.com" });
  await assert.rejects(relay.call("alice", "get_editor_state", {}), (error) => error instanceof RelayError && error.message === noTab("https://social.example.com") && /open https:\/\/social\.example\.com in/.test(error.message));
});

test("a call goes to its user's tab and resolves with the answer", async () => {
  const relay = new Relay();
  const alice = socket();
  const tab = relay.attach("alice", alice);
  const pending = relay.call("alice", "get_editor_state", { x: 1 });
  assert.deepEqual(alice.sent[0], { type: "call", id: alice.sent[0].id, tool: "get_editor_state", args: { x: 1 } });
  relay.receive(tab, { id: alice.sent[0].id, ok: true, text: "{}", images: [] });
  assert.deepEqual(await pending, { text: "{}", images: [] });
});

test("one user's call never reaches another user's tab", async () => {
  const relay = new Relay({ timeoutMs: 20 });
  const alice = socket();
  const bob = socket();
  relay.attach("alice", alice);
  const bobTab = relay.attach("bob", bob);
  const pending = relay.call("alice", "undo", {});
  assert.equal(bob.sent.length, 0);
  // Bob's tab answering Alice's call is ignored.
  relay.receive(bobTab, { id: alice.sent[0].id, ok: true, text: "forged" });
  relay.detach(bobTab);
  relay.receive(relay.attach("alice", socket()), { id: alice.sent[0].id, ok: true, text: "forged" });
  assert.equal(alice.sent.length, 1);
  void pending.catch(() => {});
});

test("the most recently used tab answers", async () => {
  const relay = new Relay({ timeoutMs: 20 });
  const first = socket();
  const second = socket();
  const a = relay.attach("alice", first);
  relay.attach("alice", second);
  a.lastActive = 0;
  void relay.call("alice", "undo", {}).catch(() => {});
  assert.equal(first.sent.length, 0);
  assert.equal(second.sent.length, 1);
  relay.touch(a);
  void relay.call("alice", "undo", {}).catch(() => {});
  assert.equal(first.sent.length, 1);
});

test("an error from the tab comes back as a RelayError", async () => {
  const relay = new Relay();
  const alice = socket();
  const tab = relay.attach("alice", alice);
  const pending = relay.call("alice", "trim_clip", {});
  relay.receive(tab, { id: alice.sent[0].id, ok: false, error: "No element e9." });
  await assert.rejects(pending, (error) => error instanceof RelayError && error.message === "No element e9.");
});

test("closing the tab fails its calls at once", async () => {
  const relay = new Relay();
  const tab = relay.attach("alice", socket());
  const pending = relay.call("alice", "undo", {});
  relay.detach(tab);
  await assert.rejects(pending, RelayError);
  assert.equal(relay.hasTab("alice"), false);
});

test("a tab that doesn't answer times out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const relay = new Relay({ timeoutMs: 10 });
  relay.attach("alice", socket());
  const calling = relay.call("alice", "undo", {});
  t.mock.timers.tick(10);
  await assert.rejects(calling, /didn't answer/);
});

test("publishing is given longer than other calls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const relay = new Relay({ timeoutMs: 10, slowTimeoutMs: 10, publishTimeoutMs: 200 });
  const alice = socket();
  const tab = relay.attach("alice", alice);
  const scheduling = relay.call("alice", "schedule_post", {});
  t.mock.timers.tick(10);
  await assert.rejects(scheduling, /didn't answer within/);
  const pending = relay.call("alice", "publish_post", { id: "p1" });
  t.mock.timers.tick(199);
  relay.receive(tab, { id: alice.sent[1].id, ok: true, text: "{}" });
  assert.deepEqual(await pending, { text: "{}", images: [] });
});

test("past the limit, the least recently used tab is closed", () => {
  const relay = new Relay();
  const sockets = Array.from({ length: 9 }, socket);
  sockets.forEach((s, i) => {
    relay.attach("alice", s).lastActive = i;
  });
  assert.equal(relay.size, 8);
  assert.equal(sockets[0].closed?.code, 4008);
});
