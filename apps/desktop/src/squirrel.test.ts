/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { quit: () => {} } }));

const { squirrelEvent } = await import("./squirrel");

const exe = "C:\\Users\\me\\AppData\\Local\\plan.video\\app-1.0.0\\plan.video.exe";

describe("squirrelEvent", () => {
  it("recognises each event flag on Windows", () => {
    for (const flag of ["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall", "--squirrel-obsolete"]) {
      expect(squirrelEvent([exe, flag, "1.0.0"], "win32")).toBe(flag);
    }
  });

  it("treats the first run and ordinary launches as launches", () => {
    expect(squirrelEvent([exe, "--squirrel-firstrun"], "win32")).toBeNull();
    expect(squirrelEvent([exe], "win32")).toBeNull();
    expect(squirrelEvent([exe, "--hidden"], "win32")).toBeNull();
    expect(squirrelEvent([exe, "planvideo://auth?x=1"], "win32")).toBeNull();
  });

  it("is never an event off Windows", () => {
    expect(squirrelEvent(["/Applications/plan.video.app/Contents/MacOS/plan.video", "--squirrel-install"], "darwin")).toBeNull();
  });
});
