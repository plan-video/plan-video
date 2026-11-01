/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { inGuestMode } from "@/lib/guest";
import { scheduledLimit } from "@/lib/plans";
import { activeScope } from "@/lib/workspaces";

/** The scheduled-post limit is set only once the plan is known to be Free. */
const onFreePlan = () => scheduledLimit() !== undefined;

/** Bulk tools and adding templates, Vault items or preview links. A shared workspace is on its owner's plan, and only paid plans have a team. */
export const paidToolsLocked = () => onFreePlan() && !activeScope();

export const FREE_EXPORT_RESOLUTION = 1080;

/** A project is its maker's own, so a shared workspace doesn't lift this. A guest is held to it too, or /try would export 4K for free. */
export const exportCapped = () => onFreePlan() || inGuestMode();

export const canExportAt = (resolution: number) => !exportCapped() || resolution <= FREE_EXPORT_RESOLUTION;

/** A resolution names the output's short side. Saved settings can ask for more than the plan has now. */
export function allowedExport<T extends { video?: { resolution?: number } }>(config: T | undefined): T | undefined {
  const resolution = config?.video?.resolution;
  if (!config?.video || resolution === undefined || canExportAt(resolution)) return config;
  return { ...config, video: { ...config.video, resolution: FREE_EXPORT_RESOLUTION } };
}
