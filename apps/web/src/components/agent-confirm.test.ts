/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, test } from "vitest";

import type { ConfirmDetails, ConfirmRequest } from "@/lib/agent-confirm";

import { confirmFacts } from "./agent-confirm";

const details: ConfirmDetails = { link: "", files: [], filesElsewhere: 0, repeat: null, youtube: null, tiktok: null, captions: [], thread: [] };
const request = (tiktok: ConfirmDetails["tiktok"]): ConfirmRequest => ({ tool: "schedule_post", caption: "", day: null, time: null, channels: [], soon: false, tiktok: null, details: { ...details, tiktok } });
const shown = (tiktok: ConfirmDetails["tiktok"]) => confirmFacts(request(tiktok)).find((fact) => fact.label === "TikTok")?.value;

test("the approval lists every TikTok setting that goes out", () => {
  const all = shown({ privacy: "SELF_ONLY", comments: true, duet: true, stitch: true, yourBrand: true, brandedContent: true });
  for (const word of ["Comments", "Duet", "Stitch", "Your brand", "Branded content"]) expect(all).toContain(word);
  const none = shown({ privacy: "SELF_ONLY", comments: false, duet: false, stitch: false, yourBrand: false, brandedContent: false });
  for (const word of ["Comments", "Duet", "Stitch", "Your brand", "Branded content"]) expect(none).not.toContain(word);
});
