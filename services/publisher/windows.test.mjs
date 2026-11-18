import assert from "node:assert/strict";
import test from "node:test";

import { createWindows } from "./windows.mjs";

test("a used-up limit stays used up however many other keys arrive, and ended ones are let go", () => {
  let clock = 1_000_000;
  const windows = createWindows(() => clock);
  const HOUR = 3_600_000;
  assert.equal(windows.allowed("victim", 1, HOUR), true);
  assert.equal(windows.allowed("victim", 1, HOUR), false);
  for (let i = 0; i < 30_000; i++) windows.allowed(`other-${i}`, 5, 60_000);
  assert.equal(windows.allowed("victim", 1, HOUR), false);
  assert.ok(windows.size() >= 30_001);
  clock += 120_000;
  windows.allowed("next", 5, 60_000);
  assert.equal(windows.size(), 2);
  assert.equal(windows.allowed("victim", 1, HOUR), false);
  clock += HOUR;
  assert.equal(windows.allowed("victim", 1, HOUR), true);
});
