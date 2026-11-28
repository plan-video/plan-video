import { test } from "node:test";
import assert from "node:assert/strict";

import { CHAT_LAG, chatSummary, heat, pickWindows, reactions, usual } from "./signals.mjs";

const quietLoud = (seconds) => Array.from({ length: seconds }, (_, s) => -30 + (s % 7) * 0.1);

test("a chat burst and a loud moment each make a window that starts before them", () => {
  const seconds = 3600;
  const messages = [];
  for (let s = 0; s < seconds; s += 6) messages.push({ t: s, text: "hi" });
  for (let i = 0; i < 80; i++) messages.push({ t: 1200 + CHAT_LAG + (i % 10), text: "KEKW" });
  const loud = quietLoud(seconds);
  for (let s = 2500; s < 2504; s++) loud[s] = -8;

  const windows = pickWindows(heat({ seconds, messages, loud }), { count: 2 });
  assert.equal(windows.length, 2);
  const around = (at) => windows.find((window) => window.start <= at && at < window.end);
  assert.ok(around(1200) && around(1200).start < 1200 - 20, JSON.stringify(windows));
  assert.ok(around(2500), JSON.stringify(windows));
});

test("viewers' most watched clips come first, and mostly muted windows are skipped", () => {
  const seconds = 3600;
  const clips = [{ start: 600, duration: 30, views: 5000, title: "how" }, { start: 2000, duration: 30, views: 9000, title: "muted" }, { start: 3000, duration: 20, views: 10, title: "meh" }];
  const muted = (window) => window.start < 2030 && window.end > 2000;
  const windows = pickWindows(heat({ seconds, loud: quietLoud(seconds), clips }), { count: 3, clips, muted });
  assert.ok(windows[0].start <= 600 && windows[0].end >= 630, JSON.stringify(windows));
  assert.ok(!windows.some(muted));
  assert.ok(windows.every((a, i) => windows.every((b, j) => i === j || a.end <= b.start || b.end <= a.start)));
});

test("chat is summed by what people typed most, timed back by the chat's lag", () => {
  const messages = [
    ...Array.from({ length: 5 }, () => ({ t: 100 + CHAT_LAG, text: "KEKW" })),
    { t: 101 + CHAT_LAG, text: "kekw" },
    { t: 102 + CHAT_LAG, text: "what was that" },
    { t: 100, text: "too early" },
  ];
  assert.deepEqual(chatSummary(messages, 95, 155), { total: 7, lines: ["KEKW ×6", "what was that"] });
});

test("a window's reactions are placed inside it, chat moved back by its lag, against the stream's usual", () => {
  const seconds = 1000;
  const messages = [];
  for (let s = 0; s < seconds; s += 10) messages.push({ t: s, text: "hi" });
  // 40 messages over 5 s, read with chat's lag, so they belong 30 s into the window at 400.
  for (let i = 0; i < 40; i++) messages.push({ t: 430 + CHAT_LAG + (i % 5), text: "KEKW" });
  const loud = Array.from({ length: seconds }, () => -30);
  for (let s = 445; s < 448; s++) loud[s] = -18;
  const clips = [{ start: 380, duration: 40, views: 900, title: "no way" }, { start: 600, duration: 20, views: 5, title: "elsewhere" }];
  const signals = { seconds, messages, loud, clips };

  const found = reactions({ start: 400, end: 460 }, signals, usual(signals));
  assert.ok(found.chatPeak.at >= 21 && found.chatPeak.at <= 30, JSON.stringify(found.chatPeak));
  // The stream's usual is 1.4 messages per 10 s; the burst plus the steady chat is 41.
  assert.ok(found.chatPeak.pace > 25 && found.chatPeak.pace < 35, JSON.stringify(found.chatPeak));
  assert.deepEqual(found.loudPeak, { at: 46, db: 12 });
  assert.deepEqual(found.clips, [{ title: "no way", views: 900, start: 0, end: 20 }]);

  const calm = reactions({ start: 800, end: 860 }, signals, usual(signals));
  assert.equal(calm.loudPeak, null);
  assert.deepEqual(calm.clips, []);
});
