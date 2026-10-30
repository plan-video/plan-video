/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";

import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n";

/** The asset names are version-independent (see the makers in `forge.config.ts`), so `/releases/latest/download/` resolves. */
const RELEASES = "https://github.com/plan-video/plan-video/releases/latest/download/";

const DOWNLOADS = {
  macos: { url: `${RELEASES}Plan-Video-arm64.dmg`, label: "macOS" },
  windows: { url: `${RELEASES}Plan-Video-x64-Setup.exe`, label: "Windows" },
} as const;

export type DesktopAppPlatform = keyof typeof DOWNLOADS;

/** So the promos can be compared. */
export type DesktopAppDownloadSource = "canvas_banner" | "dashboard_footer" | "main_menu" | "chat_panel";

export function desktopAppPlatform(): DesktopAppPlatform | null {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform;
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  return null;
}

/** Null where there is no build. */
export function desktopAppPlatformLabel(): string | null {
  const platform = desktopAppPlatform();
  return platform ? DOWNLOADS[platform].label : null;
}

export function desktopAppDownloadLabel(): string {
  const label = desktopAppPlatformLabel();
  return label ? t("Download for {platform}", { platform: label }) : t("Download desktop app");
}

/**
 * GitHub serves the asset with `Content-Disposition: attachment`, so this downloads rather than navigates.
 * Only macOS and Windows have builds; elsewhere this explains that instead.
 */
export function downloadDesktopApp(source: DesktopAppDownloadSource) {
  const platform = desktopAppPlatform();
  track("desktop_app_download", { source, supported: platform !== null, platform: platform ?? "other" });

  if (!platform) {
    toast(t("Available for macOS and Windows"), {
      description:
        t("The desktop app ships for macOS and Windows."),
    });
    return;
  }

  const a = document.createElement("a");
  a.href = DOWNLOADS[platform].url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
