import assert from "node:assert/strict";
import test from "node:test";

import { dueAtOf, matchesRecurrence, momentOf, runsBetween } from "./schedule.mjs";

const at = (text) => Date.parse(text);

test("a post's time is read in its own zone", () => {
  assert.equal(momentOf("2026-10-12", "18:00", "Europe/Amsterdam"), at("2026-10-12T16:00:00Z"));
  assert.equal(momentOf("2026-12-12", "18:00", "Europe/Amsterdam"), at("2026-12-12T17:00:00Z"));
  assert.equal(momentOf("2026-10-12", "18:00", "America/New_York"), at("2026-10-12T22:00:00Z"));
});

test("a time skipped by the clocks going forward lands just after", () => {
  // 02:30 doesn't exist in Amsterdam on 29 March 2026.
  assert.equal(momentOf("2026-03-29", "02:30", "Europe/Amsterdam"), at("2026-03-29T01:30:00Z"));
});

test("a one-off post is due once, inside the window only", () => {
  const post = { day: "2026-10-12", start: "18:00", timeZone: "Europe/Amsterdam", recurrence: null };
  assert.deepEqual(runsBetween(post, "UTC", at("2026-10-12T15:59:00Z"), at("2026-10-12T16:00:00Z")), [{ occurrence: "once", dueAt: at("2026-10-12T16:00:00Z") }]);
  assert.deepEqual(runsBetween(post, "UTC", at("2026-10-12T16:00:00Z"), at("2026-10-12T17:00:00Z")), []);
  assert.deepEqual(runsBetween(post, "UTC", at("2026-10-12T15:00:00Z"), at("2026-10-12T15:59:59Z")), []);
});

test("the account's zone is used when the post has none, and UTC when that's unknown", () => {
  const post = { day: "2026-10-12", start: "09:00", recurrence: null };
  assert.equal(dueAtOf(post, "Asia/Tokyo", "once"), at("2026-10-12T00:00:00Z"));
  assert.equal(dueAtOf(post, "Not/AZone", "once"), at("2026-10-12T09:00:00Z"));
});

test("all-day posts count from the start of their day", () => {
  const post = { day: "2026-10-12", start: "13:00", allDay: true, timeZone: "UTC" };
  assert.equal(dueAtOf(post, "UTC", "once"), at("2026-10-12T00:00:00Z"));
});

test("a repeating post runs on its cadence, minus skipped days and after its end", () => {
  const post = {
    day: "2026-10-05",
    start: "10:00",
    timeZone: "UTC",
    recurrence: "every:1:week",
    recurrenceExceptions: ["2026-10-12"],
    recurrenceEnd: "2026-10-26",
  };
  const runs = runsBetween(post, "UTC", at("2026-10-01T00:00:00Z"), at("2026-11-30T00:00:00Z"));
  assert.deepEqual(runs.map((run) => run.occurrence), ["2026-10-05", "2026-10-19", "2026-10-26"]);
  assert.equal(dueAtOf(post, "UTC", "2026-10-12"), null);
  assert.equal(dueAtOf(post, "UTC", "2026-10-19"), at("2026-10-19T10:00:00Z"));
  assert.equal(dueAtOf(post, "UTC", "once"), null);
});

test("weekday and monthly cadences", () => {
  assert.equal(matchesRecurrence("weekday", "2026-10-10", "2026-10-01"), false); // Saturday
  assert.equal(matchesRecurrence("weekday", "2026-10-12", "2026-10-01"), true);
  assert.equal(matchesRecurrence("every:1:month", "2026-02-28", "2026-01-31"), true);
  assert.equal(matchesRecurrence("every:2:day", "2026-10-03", "2026-10-01"), true);
  assert.equal(matchesRecurrence("every:2:day", "2026-10-02", "2026-10-01"), false);
  assert.equal(matchesRecurrence("friday", "2026-10-16", "2026-10-02"), true);
});

test("a series looked at from long before its first day starts counting there", () => {
  const post = { day: "2026-10-12", start: "09:00", timeZone: "UTC", recurrence: "every:1:day" };
  assert.deepEqual(
    runsBetween(post, "UTC", 0, at("2026-10-13T09:00:00Z")).map((run) => run.occurrence),
    ["2026-10-12", "2026-10-13"],
  );
});

test("a post's next run is the first one the schedule gives after the moment, for every kind of post", async () => {
  const { nextRunAfter } = await import("./schedule.mjs");
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const zones = ["Europe/Amsterdam", "America/New_York", "Asia/Kathmandu", "Australia/Lord_Howe", "UTC", "Pacific/Apia", "America/Sao_Paulo"];
  const cadences = [null, null, "weekday", "monday", "sunday", "every:1:day", "every:3:day", "every:1:week", "every:2:week", "every:1:month", "every:3:month", "every:12:month", "nonsense"];
  const day = (offset) => new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < 3000; i++) {
    const first = Math.floor(random() * 700);
    const post = {
      day: day(first),
      start: `${String(Math.floor(random() * 24)).padStart(2, "0")}:${pick(["00", "15", "30", "59"])}`,
      allDay: random() < 0.1,
      timeZone: random() < 0.9 ? pick(zones) : undefined,
      recurrence: pick(cadences),
      recurrenceExceptions: random() < 0.3 ? [day(first + 1), day(first + 7), day(first + 31)] : [],
      recurrenceEnd: random() < 0.3 ? day(first + Math.floor(random() * 400)) : random() < 0.05 ? ["not", "a", "day"] : null,
    };
    const after = Date.UTC(2026, 0, 1) + Math.floor(random() * 900) * 86_400_000 + Math.floor(random() * 86_400_000);
    // Compared over the next 400 days; past those, it may only give a later run or none.
    const window = after + 400 * 86_400_000;
    const [expected] = runsBetween(post, "Europe/Amsterdam", after, window);
    const next = nextRunAfter(post, "Europe/Amsterdam", after);
    const said = JSON.stringify({ post, after: new Date(after).toISOString(), next });
    if (expected) assert.equal(next, expected.dueAt, said);
    else assert.ok(next === null || next > window, said);
  }
});

test("a post's next run: none for a post with no time, one past, or a series that ended", async () => {
  const { nextRunAfter } = await import("./schedule.mjs");
  const after = at("2026-10-12T12:00:00Z");
  assert.equal(nextRunAfter({ day: "2026-10-12", start: "13:00", recurrence: null }, "UTC", after), at("2026-10-12T13:00:00Z"));
  assert.equal(nextRunAfter({ day: "2026-10-12", start: "12:00", recurrence: null }, "UTC", after), null, "a run at the moment itself is planned by now");
  assert.equal(nextRunAfter({ day: "2026-10-12", start: "nope", recurrence: null }, "UTC", after), null);
  assert.equal(nextRunAfter({ day: ["2026-10-12"], start: "13:00", recurrence: null }, "UTC", after), null);
  assert.equal(nextRunAfter({ day: "2026-10-01", start: "09:00", recurrence: "every:1:day", recurrenceEnd: "2026-10-11" }, "UTC", after), null);
  assert.equal(nextRunAfter({ day: "2026-10-01", start: "09:00", recurrence: "every:1:day", recurrenceEnd: "2026-10-13" }, "UTC", after), at("2026-10-13T09:00:00Z"));
  // A series every 99 months has its next run years ahead, and still has one.
  assert.equal(nextRunAfter({ day: "2026-10-01", start: "09:00", recurrence: "every:99:month" }, "UTC", after), at("2035-01-01T09:00:00Z"));
});
