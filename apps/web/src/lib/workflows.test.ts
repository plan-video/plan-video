/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {} }));
vi.mock("@/lib/guest", () => ({ ownerOf: (id?: string) => id }));

const { STARTER_WORKFLOWS, activeSteps, readSteps, readWorkflow } = await import("./workflows");

const base = { id: "w1", name: "Gaming clips", off: [], createdAt: "2026-10-28T10:00:00.000Z", updatedAt: "2026-10-28T10:00:00.000Z" };

describe("readWorkflow", () => {
  it("keeps a well-formed workflow as it was", () => {
    const steps = {
      size: { width: 1080, height: 1920 },
      layout: { id: "split", crops: { facecam: { x: 0.1, y: 0, width: 0.3, height: 0.2 } }, styles: { facecam: { shape: "circle", rounding: 100 } } },
      grade: { look: "warm", exposure: 12 },
      autoZoom: { strength: "medium", frequency: "normal", motion: "smooth" },
      captions: { look: { props: { preset: "pop" }, children: [] } },
      keywords: { color: 0xffd60a },
      emoji: { on: true },
      progressBar: { position: "bottom", thickness: "thin", color: "#FFFFFF", track: true },
    };
    expect(readWorkflow({ ...base, steps })).toEqual({ ...base, steps });
  });

  it("drops what doesn't hold up, step by step", () => {
    const read = readWorkflow({
      ...base,
      off: ["captions", "nonsense"],
      steps: {
        size: { width: "big", height: 1920 },
        layout: { id: "no-such-layout" },
        grade: { exposure: "lots", nonsense: 3 },
        autoZoom: { strength: "huge", frequency: "normal", motion: "snap" },
        progressBar: { position: "bottom", thickness: "thin", color: "red", track: false },
        emoji: { on: "yes" },
      },
      thumb: "javascript:alert(1)",
    });
    expect(read).toEqual({ ...base, off: ["captions"], steps: {} });
  });

  it("refuses rows that are not workflows, and starters", () => {
    expect(readWorkflow(null)).toBeNull();
    expect(readWorkflow({ id: 3, name: "x" })).toBeNull();
    expect(readWorkflow({ ...base, id: "starter:stream" })).toBeNull();
  });
});

describe("activeSteps", () => {
  const workflow = (steps: object, off: string[] = []) => readWorkflow({ ...base, steps, off })!;

  it("runs steps in order, leaving out those turned off", () => {
    const steps = { size: { width: 1080, height: 1920 }, autoZoom: { strength: "subtle", frequency: "fewer", motion: "snap" }, progressBar: { position: "top", thickness: "thick", color: "#000000", track: false } };
    expect(activeSteps(workflow(steps))).toEqual(["size", "autoZoom", "progressBar"]);
    expect(activeSteps(workflow(steps, ["autoZoom"]))).toEqual(["size", "progressBar"]);
  });

  it("lets a layout set the size, and keeps keywords and emoji to captions", () => {
    const steps = { size: { width: 1080, height: 1920 }, layout: { id: "split" }, keywords: { color: 1 }, emoji: { on: true } };
    expect(activeSteps(workflow(steps))).toEqual(["layout"]);
    expect(activeSteps(workflow(steps, ["layout"]))).toEqual(["size"]);
    const captioned = { ...steps, captions: { look: { props: {}, children: [] } } };
    expect(activeSteps(workflow(captioned))).toEqual(["layout", "captions", "keywords", "emoji"]);
  });
});

describe("starters", () => {
  it("hold up as stored steps", () => {
    for (const starter of STARTER_WORKFLOWS) expect(readSteps(starter.steps)).toEqual(starter.steps);
  });
});
