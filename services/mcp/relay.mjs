/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Hands an agent's tool calls to the user's open plan.video tab and waits for
// the answer. Every signed-in tab keeps a socket here, filed under the user
// its own sign-in names; a call only ever goes to a tab of the user the
// connector's token names, and to the one they used last.

import { randomUUID } from "node:crypto";

/** Why a call could not be answered, worded for the agent to pass on. */
export class RelayError extends Error {}

const DEFAULT_TIMEOUT_MS = 60_000;
/** Rendering frames, or bringing a post's video down from cloud storage, can take a while. */
const SLOW_TIMEOUT_MS = 120_000;
const SLOW_TOOLS = new Set(["capture_frames", "schedule_post", "update_post", "copy_post"]);
/** Publishing waits for the video to upload to every network on the post. */
const PUBLISH_TIMEOUT_MS = 600_000;
const PUBLISH_TOOLS = new Set(["publish_post"]);
/** One person rarely has more plan.video tabs open than this; past it the oldest goes. */
const MAX_TABS_PER_USER = 8;

/** What a call gets when the user has no tab open, naming the site to open (PUBLIC_URL in server.mjs). */
export const noTab = (site = "https://plan.video") =>
  `plan.video isn't open. Ask the user to open ${site} in their browser, signed in, keep the tab open, and try again.`;
export const NO_TAB = noTab();

export class Relay {
  /** userId → the tabs that user has open. */
  #tabs = new Map();
  /** call id → the call waiting on a tab. */
  #pending = new Map();
  #timeoutMs;
  #slowTimeoutMs;

  #publishTimeoutMs;
  #noTab;

  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS, slowTimeoutMs = SLOW_TIMEOUT_MS, publishTimeoutMs = PUBLISH_TIMEOUT_MS, site } = {}) {
    this.#noTab = noTab(site);
    this.#timeoutMs = timeoutMs;
    this.#slowTimeoutMs = slowTimeoutMs;
    this.#publishTimeoutMs = publishTimeoutMs;
  }

  /** Files a signed-in tab under its user. `socket` needs send(string) and close(code, reason). */
  attach(userId, socket) {
    const tab = { userId, socket, lastActive: Date.now() };
    const tabs = this.#tabs.get(userId) ?? new Set();
    this.#tabs.set(userId, tabs);
    tabs.add(tab);
    if (tabs.size > MAX_TABS_PER_USER) {
      const oldest = [...tabs].reduce((a, b) => (a.lastActive <= b.lastActive ? a : b));
      oldest.socket.close(4008, "Too many open plan.video tabs.");
      this.detach(oldest);
    }
    return tab;
  }

  /** The tab went away: whatever it was working on fails now rather than at its timeout. */
  detach(tab) {
    const tabs = this.#tabs.get(tab.userId);
    if (!tabs?.delete(tab)) return;
    if (tabs.size === 0) this.#tabs.delete(tab.userId);
    for (const [id, call] of this.#pending) {
      if (call.tab === tab) this.#settle(id, new RelayError("The plan.video tab closed before it finished. Ask the user to reopen plan.video, then check what was done before going on."));
    }
  }

  /** The user is looking at this tab: it answers the next call. */
  touch(tab) {
    tab.lastActive = Date.now();
  }

  /** How many tabs are connected, for the log. */
  get size() {
    let count = 0;
    for (const tabs of this.#tabs.values()) count += tabs.size;
    return count;
  }

  hasTab(userId) {
    return this.#tabs.has(userId);
  }

  /**
   * Runs `tool` in the user's most recently used tab. Resolves to what the
   * tab sent back ({ text, images }); rejects with a RelayError when there is
   * no tab, the tab fails the call, or it takes too long.
   */
  call(userId, tool, args) {
    const tabs = this.#tabs.get(userId);
    if (!tabs) return Promise.reject(new RelayError(this.#noTab));
    const tab = [...tabs].reduce((a, b) => (a.lastActive >= b.lastActive ? a : b));

    const id = randomUUID();
    const ms = PUBLISH_TOOLS.has(tool) ? this.#publishTimeoutMs : SLOW_TOOLS.has(tool) ? this.#slowTimeoutMs : this.#timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.#settle(id, new RelayError(`The plan.video tab didn't answer within ${Math.round(ms / 1000)} seconds. It may be in the background or still at work; ask the user to bring it to the front, then check what was done before trying again.`)),
        ms,
      );
      this.#pending.set(id, { tab, resolve, reject, timer });
      try {
        tab.socket.send(JSON.stringify({ type: "call", id, tool, args }));
      } catch {
        this.#settle(id, new RelayError(this.#noTab));
      }
    });
  }

  /** An answer from a tab. Ignored unless that tab was asked that call. */
  receive(tab, message) {
    const call = this.#pending.get(message.id);
    if (!call || call.tab !== tab) return;
    if (message.ok) {
      this.#settle(message.id, null, { text: String(message.text ?? ""), images: Array.isArray(message.images) ? message.images : [] });
    } else {
      this.#settle(message.id, new RelayError(String(message.error || "plan.video couldn't do that.")));
    }
  }

  #settle(id, error, value) {
    const call = this.#pending.get(id);
    if (!call) return;
    this.#pending.delete(id);
    clearTimeout(call.timer);
    if (error) call.reject(error);
    else call.resolve(value);
  }
}
