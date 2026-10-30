/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { intlLocale, t } from "@/lib/i18n";

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatBytes(bytes: number) {
  // English keeps its old size format; other languages get Intl's digits and units.
  const locale = intlLocale();
  const write = (value: number, exponent: number, decimals: number) =>
    new Intl.NumberFormat(locale, { style: "unit", unit: BYTE_UNITS[exponent], unitDisplay: "short", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return locale ? write(0, 0, 0) : "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const base = 1024;
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(base)),
  );
  const value = bytes / Math.pow(base, exponent);
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  if (locale) return write(value, exponent, decimals);
  return `${value.toFixed(decimals)} ${units[exponent]}`;
}

function gcd(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

export function formatAspectRatio(width: number, height: number) {
  const d = gcd(width, height);
  if (!d) return `${width}:${height}`;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

export function formatMimeTypeLabel(mimeType: string) {
  mimeType = mimeType.split(';')[0].trim();

  const mapping: Record<string, string> = {
    "video/mp4": t("MPEG-4 Movie"),
    "video/quicktime": t("QuickTime Movie"),
    "video/webm": t("WebM Video"),
    "audio/mpeg": t("MP3 Audio"),
    "audio/wav": t("WAV Audio"),
    "image/jpeg": t("JPEG Image"),
    "image/png": t("PNG Image"),
    "image/webp": t("WebP Image"),
  };

  return mapping[mimeType] ?? mimeType;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${remaining
    .toString()
    .padStart(2, "0")}`;
}

export function formatChannels(channels: number | undefined) {
  if (!channels) return null;
  if (channels === 1) return t("Mono");
  if (channels === 2) return t("Stereo");
  return t("{count} ch", { count: channels });
}

export function formatAssetDate(value: string | number | null | undefined) {
  if (value == null) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString(intlLocale(), {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isSameDay) return t("Today, {time}", { time });

  const datePart = date.toLocaleDateString(intlLocale(), {
    month: "short",
    day: "numeric",
  });

  return t("{date}, {time}", { date: datePart, time });
}
