/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SOCIAL_PLATFORMS, type PlatformId } from "@/lib/social";

export type CaptionRow = {
  file: string;
  caption?: string;
  day?: string;
  time?: string;
  platforms?: PlatformId[];
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delimiter = detectDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

/** Spreadsheets in some locales save with semicolons or tabs. */
function detectDelimiter(text: string): string {
  const end = text.search(/\r?\n/);
  const header = end < 0 ? text : text.slice(0, end);
  const counts = [",", ";", "\t"].map((delimiter) => [delimiter, header.split(delimiter).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

const HEADERS: Record<keyof CaptionRow, readonly string[]> = {
  file: ["file", "filename", "file name", "name", "video", "media"],
  caption: ["caption", "text", "description", "copy"],
  day: ["date", "day"],
  time: ["time", "hour"],
  platforms: ["platforms", "platform", "networks", "channels"],
};

export function readCaptionRows(text: string): CaptionRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((cell) => cell.trim().toLowerCase());
  const column = (key: keyof CaptionRow) => names.findIndex((name) => HEADERS[key].includes(name));
  const file = column("file");
  if (file < 0) return [];
  const caption = column("caption");
  const day = column("day");
  const time = column("time");
  const platforms = column("platforms");

  return rows
    .map((cells) => ({
      file: cells[file]?.trim() ?? "",
      caption: caption >= 0 ? cells[caption] : undefined,
      day: day >= 0 ? normalizeDay(cells[day]) : undefined,
      time: time >= 0 ? normalizeTime(cells[time]) : undefined,
      platforms: platforms >= 0 ? readPlatforms(cells[platforms]) : undefined,
    }))
    .filter((row) => row.file);
}

/** Accepts 2026-10-01, 2026/10/01 and 01-10-2026 (day first). A day that doesn't exist is left out, not rolled over. */
function normalizeDay(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) return realDay(match[1]!, match[2]!, match[3]!);
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match) return realDay(match[3]!, match[2]!, match[1]!);
  return undefined;
}

function realDay(year: string, month: string, day: string): string | undefined {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const key = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return date.toISOString().slice(0, 10) === key ? key : undefined;
}

/** Accepts 9:00, 09:00 and 9pm. */
function normalizeTime(value: string | undefined): string | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (match[3] === "pm" && hours < 12) hours += 12;
  if (match[3] === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function readPlatforms(value: string | undefined): PlatformId[] | undefined {
  if (!value?.trim()) return undefined;
  const words = value.toLowerCase().split(/[\s,;|/+]+/).filter(Boolean);
  const found = SOCIAL_PLATFORMS.filter(
    (platform) => words.includes(platform.id) || words.includes(platform.name.toLowerCase()) || (platform.id === "x" && words.includes("twitter")),
  );
  return found.length ? found.map((platform) => platform.id) : undefined;
}

export function fileMatchKey(name: string): string {
  return name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").trim().toLowerCase();
}
