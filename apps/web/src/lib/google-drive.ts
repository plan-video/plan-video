/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";

import { inGuestMode } from "@/lib/guest";
import { language, t } from "@/lib/i18n";

const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const API_KEY: string = import.meta.env.VITE_GOOGLE_API_KEY ?? "";

/** Served without the app's cross-origin isolation, which keeps Google's Picker frame out of every other page. */
export const DRIVE_PAGE = "/google-drive.html";

export type DriveFile = { id: string; name: string; mimeType: string; size: number; modified: number };

export type DriveReply = { type: "picked"; token: string; files: DriveFile[] } | { type: "cancel" } | { type: "error" };

export const driveAvailable = () => !!CLIENT_ID && !!API_KEY && !inGuestMode();

// The Picker filters by exact types only.
const WILDCARDS: Record<string, string[]> = {
  "video/*": ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
  "image/*": ["image/jpeg", "image/png", "image/gif", "image/webp"],
  "audio/*": ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac"],
};

export function driveMimeTypes(accept: string): string {
  const types = accept
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("/"))
    .flatMap((entry) => WILDCARDS[entry] ?? [entry]);
  return [...new Set(types)].join(",");
}

export type DrivePick = {
  /** Like a file input's. */
  accept: string;
  multiple?: boolean;
  /** Turns a file away before it's downloaded. */
  tooLarge?: (file: DriveFile) => string | null;
};

let superseded: (() => void) | undefined;

/** Call it straight from a click, or the browser blocks the window. Resolves with no files when the person closes it. */
export function pickFromDrive(options: DrivePick): Promise<File[]> {
  superseded?.();
  const id = crypto.randomUUID();
  const params = new URLSearchParams({
    channel: id,
    client: CLIENT_ID,
    key: API_KEY,
    mimes: driveMimeTypes(options.accept),
    multiple: options.multiple === false ? "0" : "1",
    locale: language(),
  });
  const width = Math.min(1100, screen.availWidth);
  const height = Math.min(760, screen.availHeight);
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
  const opened = window.open(`${DRIVE_PAGE}#${params}`, "plan-video-google-drive", `popup,width=${width},height=${height},left=${left},top=${top}`);
  if (!opened) {
    toast.error(t("Couldn't open Google Drive"), { description: t("Allow pop-ups for this site, then try again.") });
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    // The window's opener is cut off on its way through Google's sign-in, so it answers on a channel instead.
    const channel = new BroadcastChannel(`plan.video.drive.${id}`);
    const done = (files: File[]) => {
      channel.close();
      if (superseded === cancel) superseded = undefined;
      resolve(files);
    };
    const cancel = () => done([]);
    superseded = cancel;
    channel.onmessage = ({ data }: MessageEvent<DriveReply>) => {
      channel.onmessage = null;
      if (data.type === "picked") {
        void downloadDriveFiles(data.files, data.token, options.tooLarge).then(done);
        return;
      }
      if (data.type === "error") toast.error(t("Couldn't open Google Drive"), { description: t("Try again in a moment.") });
      done([]);
    };
  });
}

/** Copies them in now: a post that read from Drive when it goes out would fail once the file is moved or unshared. */
export async function downloadDriveFiles(
  files: readonly DriveFile[],
  token: string,
  tooLarge?: (file: DriveFile) => string | null,
  fetcher: typeof fetch = fetch,
): Promise<File[]> {
  const refused = files.flatMap((file) => tooLarge?.(file) ?? []);
  if (refused.length) {
    toast.error(t("{count, plural, =1 {Couldn't add a file} other {Couldn't add # files}}", { count: refused.length }), {
      description: refused.length === 1 ? refused[0] : undefined,
    });
  }
  const wanted = files.filter((file) => !tooLarge?.(file));
  if (!wanted.length) return [];

  const id = toast.loading(t("{count, plural, =1 {Getting a file from Google Drive…} other {Getting # files from Google Drive…}}", { count: wanted.length }));
  const got: File[] = [];
  const failed: string[] = [];
  for (const file of wanted) {
    try {
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      got.push(new File([blob], file.name, { type: file.mimeType || blob.type, lastModified: file.modified || Date.now() }));
    } catch {
      failed.push(file.name);
    }
  }
  toast.dismiss(id);
  if (failed.length) {
    toast.error(t("{count, plural, =1 {Couldn't get a file from Google Drive} other {Couldn't get # files from Google Drive}}", { count: failed.length }), {
      description: failed.join(", "),
    });
  }
  return got;
}
