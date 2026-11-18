/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { KEYMAPS, bindingsFor, matchesKeys, parseKeymap, type KeyCombo, type KeymapId } from "./keymap";

function firstCommand(id: KeymapId, combo: KeyCombo) {
  const held = new Set(combo.filter((key) => !key.startsWith("!")));
  const moved = new Set(combo.slice(0, 1));
  return bindingsFor(id).find(({ keys }) => matchesKeys(keys, moved, held))?.command;
}

describe("keymaps", () => {
  for (const { id } of KEYMAPS) {
    it(`${id}: every key runs the command it is listed under`, () => {
      for (const { command, keys } of bindingsFor(id)) {
        expect([keys, firstCommand(id, keys)]).toEqual([keys, command]);
      }
    });
  }

  it("keeps the plan.video keys unless another app is chosen", () => {
    expect(firstCommand("plan-video", ["arrowleft"])).toBe("nudgeLeft");
    expect(firstCommand("plan-video", ["a"])).toBe("previousFrame");
    expect(firstCommand("plan-video", ["v"])).toBe("moveTool");
  });

  it("uses each app's own keys where they differ", () => {
    expect(firstCommand("premiere", ["k", "mod"])).toBe("split");
    expect(firstCommand("resolve", ["\\", "mod"])).toBe("split");
    expect(firstCommand("final-cut", ["a"])).toBe("moveTool");
    expect(firstCommand("final-cut", ["v"])).toBe("hide");
    expect(firstCommand("final-cut", ["a", "mod", "shift"])).toBe("deselect");
    expect(firstCommand("capcut", ["arrowdown"])).toBe("nextCut");
  });

  it("can still nudge after the arrows move the playhead", () => {
    expect(firstCommand("capcut", ["arrowleft"])).toBe("previousFrame");
    expect(firstCommand("capcut", ["arrowleft", "alt"])).toBe("nudgeLeft");
    expect(firstCommand("capcut", ["arrowup", "alt", "shift"])).toBe("nudgeFastUp");
  });

  it("falls back to plan.video for a saved value it does not know", () => {
    expect(parseKeymap("final-cut")).toBe("final-cut");
    expect(parseKeymap("toString")).toBe("plan-video");
    expect(parseKeymap(null)).toBe("plan-video");
  });
});
