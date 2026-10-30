/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { join } from "node:path";
import { access, writeFile } from "node:fs/promises";

/**
 * The renderer's Umami script never fires in Electron (its `data-domains` gate does not match
 * `file://`), so main posts to Umami's send API. The install event is sent once, then a marker in
 * `userData` stops it; offline first launches retry next launch.
 */

const UMAMI_ENDPOINT = "https://cloud.umami.is/api/send";
// Nothing is sent while this is empty.
const UMAMI_WEBSITE_ID = "";
const HOSTNAME = "desktop.plan.video";
const MARKER_FILE = "install-tracked";

// Umami's bot filter drops Node's and Electron's default User-Agents, so send a plain browser UA with the right OS.
function userAgent(): string {
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`;
}

export type AnalyticsEventData = Record<string, string | number | boolean>;

/** Never throws. */
async function sendEvent(name: string, url: string, data: AnalyticsEventData): Promise<boolean> {
  if (!UMAMI_WEBSITE_ID) return false;
  try {
    const response = await fetch(UMAMI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": userAgent() },
      body: JSON.stringify({
        type: "event",
        payload: { website: UMAMI_WEBSITE_ID, hostname: HOSTNAME, url, name, data },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Dev builds stay out of the numbers. */
export async function trackEvent(name: string, data: AnalyticsEventData = {}): Promise<void> {
  if (!app.isPackaged) return;
  await sendEvent(name, "/desktop", {
    ...data,
    platform: process.platform,
    version: app.getVersion(),
  });
}

export async function trackInstall(): Promise<void> {
  if (!app.isPackaged) return;

  const marker = join(app.getPath("userData"), MARKER_FILE);
  try {
    await access(marker);
    return;
  } catch {
    // No marker yet: this is the first launch.
  }

  const sent = await sendEvent("desktop_install", "/desktop/install", {
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  });
  if (sent) await writeFile(marker, new Date().toISOString()).catch(() => {});
}
