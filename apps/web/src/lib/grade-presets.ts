/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// They belong to the person, not a workspace, like project folders.

import { createSignal } from "solid-js";
import { GRADE_KEYS, NEUTRAL_GRADE } from "@plan.video/runtime";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";

import type { GradeValues } from "@plan.video/runtime";

export type GradePreset = {
  id: string;
  name: string;
  /** Neutral values left out. */
  grade: Partial<GradeValues>;
  createdAt: string;
};

const MAX_NAME = 40;

export const gradePresetsKey = (userId: string) => `plan.video.grade-presets.${userId}`;

const [presets, setPresets] = createSignal<GradePreset[]>([]);
let loadedKey: string | undefined;

/** Oldest first, so a new one lands at the end of the grid. */
export const gradePresets = () => [...presets()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export function isGradePreset(value: unknown): value is GradePreset {
  if (!value || typeof value !== "object") return false;
  const row = value as GradePreset;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    !!row.grade &&
    typeof row.grade === "object" &&
    Object.entries(row.grade).every(([key, entry]) => key in NEUTRAL_GRADE && typeof entry === typeof NEUTRAL_GRADE[key as keyof GradeValues])
  );
}

/** `loadGradePresets` does nothing when this person's are already loaded. */
export function reloadGradePresets(userId: string | undefined) {
  loadedKey = undefined;
  loadGradePresets(userId);
}

export function loadGradePresets(userId: string | undefined) {
  // A guest keeps theirs under the guest id, and they never sync.
  const owner = ownerOf(userId);
  if (!owner) {
    loadedKey = undefined;
    setPresets([]);
    return;
  }
  const key = gradePresetsKey(owner);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setPresets(Array.isArray(parsed) ? parsed.filter(isGradePreset) : []);
  } catch {
    setPresets([]);
  }
}

function write(update: (current: GradePreset[]) => GradePreset[]) {
  if (!loadedKey) return;
  setPresets(update);
  try {
    localStorage.setItem(loadedKey, JSON.stringify(presets()));
  } catch {
    // Storage full or blocked: the change holds until the page reloads.
    return;
  }
  queueAccountSync();
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}

export function definedGrade(values: GradeValues): Partial<GradeValues> {
  const grade: Partial<GradeValues> = {};
  for (const key of GRADE_KEYS) {
    if (values[key] !== NEUTRAL_GRADE[key]) (grade as Record<string, unknown>)[key] = values[key];
  }
  return grade;
}

/** Signed in, or a guest with a store. */
export const canSaveGradePresets = () => loadedKey !== undefined;

/** Undefined when the name is empty or nothing is loaded. */
export function saveGradePreset(name: string, values: GradeValues): GradePreset | undefined {
  const clean = cleanName(name);
  if (!loadedKey || !clean) return;
  const preset: GradePreset = { id: crypto.randomUUID(), name: clean, grade: definedGrade(values), createdAt: new Date().toISOString() };
  write((current) => [...current, preset]);
  return preset;
}

/** False when the name is empty, which keeps the old one. */
export function renameGradePreset(id: string, name: string): boolean {
  const clean = cleanName(name);
  if (!clean) return false;
  write((current) => current.map((preset) => (preset.id === id && preset.name !== clean ? { ...preset, name: clean } : preset)));
  return true;
}

export function deleteGradePreset(id: string) {
  write((current) => current.filter((preset) => preset.id !== id));
}
