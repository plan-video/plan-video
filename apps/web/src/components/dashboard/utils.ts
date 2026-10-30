/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { TRASH_RETENTION_DAYS, TRASH_RETENTION_MS } from "@/lib/db";
import { t } from "@/lib/i18n";

export function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatEditedAt(modifiedAt: string): string {
  return formatRelative(modifiedAt);
}

/** How the trash card says when a project will be permanently deleted. */
export function formatTrashRemaining(trashedAt: string, now = Date.now()): string {
  const trashed = parseTimestamp(trashedAt);
  if (!trashed) return t("Deletes in {days, plural, one {# day} other {# days}}", { days: TRASH_RETENTION_DAYS });
  const days = Math.ceil((trashed + TRASH_RETENTION_MS - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t("Deletes today");
  return t("Deletes in {days, plural, one {# day} other {# days}}", { days });
}

function formatRelative(iso: string): string {
  const timestamp = parseTimestamp(iso);
  if (!timestamp) return t("Edited just now");

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) return t("Edited just now");

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return t("Edited {minutes, plural, one {# minute} other {# minutes}} ago", { minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("Edited {hours, plural, one {# hour} other {# hours}} ago", { hours });

  const days = Math.floor(hours / 24);
  if (days < 30) return t("Edited {days, plural, one {# day} other {# days}} ago", { days });

  const months = Math.floor(days / 30);
  if (months < 12) return t("Edited {months, plural, one {# month} other {# months}} ago", { months });

  const years = Math.floor(days / 365);
  return t("Edited {years, plural, one {# year} other {# years}} ago", { years });
}

const AVATAR_MAX_SIZE = 256;

export async function cropAndResizeAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const size = Math.min(bitmap.width, bitmap.height, AVATAR_MAX_SIZE);

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;

  // Center-crop to square
  const sx = (bitmap.width - Math.min(bitmap.width, bitmap.height)) / 2;
  const sy = (bitmap.height - Math.min(bitmap.width, bitmap.height)) / 2;
  const sSize = Math.min(bitmap.width, bitmap.height);

  ctx.drawImage(bitmap, sx, sy, sSize, sSize, 0, 0, size, size);
  bitmap.close();

  return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
}
