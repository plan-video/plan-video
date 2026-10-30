/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Time } from "./types";

/** Frames per second of the canonical `Time` frame unit ("30f"). */
export const TIME_FPS = 30;

/** Numbers are seconds, "30f" frames at `TIME_FPS`, "MM:SS" / "HH:MM:SS" clock strings; may be negative. Undefined if unparsable. */
export function parseTime(value: Time | string | null | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const str = value?.trim();
  if (typeof str !== "string" || str.length === 0) {
    return undefined;
  }

  if (/^-?\d+(?:\.\d+)?f$/i.test(str)) {
    return parseFloat(str) / TIME_FPS;
  }

  if (str.includes(":")) {
    const negative = str.startsWith("-");
    const parts = str.replace(/^-/, "").split(":").map(Number);

    if (parts.some((n) => !Number.isFinite(n))) {
      return undefined;
    }

    let seconds: number;
    if (parts.length === 2) {
      seconds = parts[0]! * 60 + parts[1]!;
    } else if (parts.length === 3) {
      seconds = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    } else {
      return undefined;
    }

    return negative ? -seconds : seconds;
  }

  const seconds = parseFloat(str);
  return Number.isFinite(seconds) ? seconds : undefined;
}
