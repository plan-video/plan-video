/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";

import { setSidebarTab } from "@/agent-chat";
import { addAutoZoom, autoZoomTarget, type AutoZoomOptions } from "@/engine/auto-zoom";
import { effectDefaults, setEffectDefaults } from "@/engine/effects";
import { t } from "@/lib/i18n";

import type { Entity, World } from "koota";

export function openAutoZoom() {
  setSidebarTab("effects");
}

export async function runAutoZoom(world: World, options: AutoZoomOptions = effectDefaults.autoZoom, target?: Entity | null) {
  setEffectDefaults("autoZoom", { ...options });
  const clip = target ?? autoZoomTarget(world);
  if (!clip) return void toast(t("No clip to zoom"), { description: t("Select a video clip, or move the playhead over one.") });

  try {
    const result = await addAutoZoom(world, clip, { ...options });
    if (result.ok) {
      toast.success(t("{count, plural, one {Added # punch-in} other {Added # punch-ins}}", { count: result.count }), {
        description: result.followedVoice ? undefined : t("No voice to follow, so they keep a steady beat."),
      });
    } else if (result.reason === "nothing-found") {
      toast(t("No moments to punch in on"), { description: t("Pick More often, or try a longer clip.") });
    } else {
      toast(t("No clip to zoom"), { description: t("Select a video clip, or move the playhead over one.") });
    }
  } catch (error) {
    toast.error(t("Could not add auto zoom"), { description: (error as Error).message });
  }
}
