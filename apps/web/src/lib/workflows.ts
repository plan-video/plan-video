/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only settings are saved, never the clips or the words.

import { createSignal } from "solid-js";
import { NEUTRAL_GRADE } from "@plan.video/runtime";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { readPostTemplate, type PostTemplate } from "@/lib/post-templates";
import { STREAM_LAYOUTS, type CropId, type CropShape, type CropStyles, type Crops } from "@/lib/stream-layouts";

import type { GradeValues } from "@plan.video/runtime";
import type { CaptionLook } from "@/lib/caption-brand";
import type { AutoZoomOptions } from "@/engine/auto-zoom";
import type { ProgressBarOptions } from "@/engine/progress-bar";

/** In the order a run takes them. */
export const WORKFLOW_STEPS = ["size", "layout", "grade", "autoZoom", "captions", "keywords", "emoji", "progressBar", "post"] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number];

export type WorkflowLayout = {
  id: string;
  /** As fractions. Without them the run asks. */
  crops?: Crops;
  styles?: CropStyles;
};

export type WorkflowSteps = {
  size?: { width: number; height: number };
  layout?: WorkflowLayout;
  grade?: Partial<GradeValues>;
  autoZoom?: AutoZoomOptions;
  captions?: { look: CaptionLook };
  keywords?: { color: number };
  emoji?: { on: true };
  progressBar?: ProgressBarOptions;
  /** A copy of a post template. */
  post?: PostTemplate;
};

export type Workflow = {
  id: string;
  name: string;
  steps: WorkflowSteps;
  /** Kept so turning one back on brings its settings back. */
  off: WorkflowStepId[];
  /** Small, as a data URL. */
  thumb?: string;
  createdAt: string;
  updatedAt: string;
};

const MAX_NAME = 40;
/** The whole account copy has a size limit. */
const MAX_THUMB = 24_000;

const EPOCH = new Date(0).toISOString();

export const workflowsKey = (userId: string) => `plan.video.workflows.${userId}`;

const [items, setItems] = createSignal<Workflow[]>([]);
let loadedKey: string | undefined;

/** Newest first. */
export const workflows = () => [...items()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

export function findWorkflow(id: string | undefined): Workflow | undefined {
  if (!id) return undefined;
  return items().find((item) => item.id === id);
}

export function activeSteps(workflow: Workflow): WorkflowStepId[] {
  return WORKFLOW_STEPS.filter((id) => {
    if (workflow.off.includes(id) || workflow.steps[id] === undefined) return false;
    // A stream layout sets the size; captions are what keywords and emoji go on.
    if (id === "size" && hasStep(workflow, "layout")) return false;
    if ((id === "keywords" || id === "emoji") && !hasStep(workflow, "captions")) return false;
    return true;
  });
}

const hasStep = (workflow: Workflow, id: WorkflowStepId) => workflow.steps[id] !== undefined && !workflow.off.includes(id);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => typeof value === "string" && (options as readonly string[]).includes(value);

const CROP_IDS: readonly CropId[] = ["facecam", "facecam2", "gameplay", "ui"];
const CROP_SHAPES: readonly CropShape[] = ["freeform", "fullscreen", "wide", "classic", "square", "circle"];

function readBox(value: unknown) {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(isNumber) || (width as number) <= 0 || (height as number) <= 0) return undefined;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

export function readLayout(value: unknown): WorkflowLayout | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !STREAM_LAYOUTS.some((layout) => layout.id === value.id)) return undefined;
  const layout: WorkflowLayout = { id: value.id };
  if (isRecord(value.crops)) {
    const crops: Crops = {};
    for (const id of CROP_IDS) {
      const box = readBox(value.crops[id]);
      if (box) crops[id] = box;
    }
    if (Object.keys(crops).length) layout.crops = crops;
  }
  if (isRecord(value.styles)) {
    const styles: CropStyles = {};
    for (const id of CROP_IDS) {
      const style = value.styles[id];
      if (isRecord(style) && oneOf(style.shape, CROP_SHAPES) && isNumber(style.rounding)) styles[id] = { shape: style.shape, rounding: style.rounding };
    }
    if (Object.keys(styles).length) layout.styles = styles;
  }
  return layout;
}

function readGrade(value: unknown): Partial<GradeValues> | undefined {
  if (!isRecord(value)) return undefined;
  const grade: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key in NEUTRAL_GRADE && typeof entry === typeof NEUTRAL_GRADE[key as keyof GradeValues]) grade[key] = entry;
  }
  return Object.keys(grade).length ? (grade as Partial<GradeValues>) : undefined;
}

function readLook(value: unknown): CaptionLook | undefined {
  if (!isRecord(value) || !isRecord(value.props) || !Array.isArray(value.children)) return undefined;
  return value as CaptionLook;
}

function readAutoZoom(value: unknown): AutoZoomOptions | undefined {
  if (!isRecord(value)) return undefined;
  const { strength, frequency, motion } = value;
  if (!oneOf(strength, ["subtle", "medium", "strong"] as const)) return undefined;
  if (!oneOf(frequency, ["fewer", "normal", "more"] as const)) return undefined;
  if (!oneOf(motion, ["snap", "smooth"] as const)) return undefined;
  return { strength, frequency, motion };
}

function readProgressBar(value: unknown): ProgressBarOptions | undefined {
  if (!isRecord(value)) return undefined;
  const { position, thickness, color, track } = value;
  if (!oneOf(position, ["top", "bottom"] as const) || !oneOf(thickness, ["thin", "medium", "thick"] as const)) return undefined;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  return { position, thickness, color, track: track === true };
}

export function readSteps(value: unknown): WorkflowSteps {
  const steps: WorkflowSteps = {};
  if (!isRecord(value)) return steps;
  const size = value.size;
  if (isRecord(size) && isNumber(size.width) && isNumber(size.height) && size.width >= 16 && size.height >= 16) {
    steps.size = { width: Math.round(size.width), height: Math.round(size.height) };
  }
  const layout = readLayout(value.layout);
  if (layout) steps.layout = layout;
  const grade = readGrade(value.grade);
  if (grade) steps.grade = grade;
  const autoZoom = readAutoZoom(value.autoZoom);
  if (autoZoom) steps.autoZoom = autoZoom;
  const look = isRecord(value.captions) ? readLook(value.captions.look) : undefined;
  if (look) steps.captions = { look };
  if (isRecord(value.keywords) && isNumber(value.keywords.color)) steps.keywords = { color: value.keywords.color };
  if (isRecord(value.emoji) && value.emoji.on === true) steps.emoji = { on: true };
  const progressBar = readProgressBar(value.progressBar);
  if (progressBar) steps.progressBar = progressBar;
  const post = readPostTemplate(value.post);
  if (post) steps.post = post;
  return steps;
}

export function readWorkflow(value: unknown): Workflow | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const off = Array.isArray(value.off) ? WORKFLOW_STEPS.filter((id) => (value.off as unknown[]).includes(id)) : [];
  const thumb = typeof value.thumb === "string" && value.thumb.startsWith("data:image/") && value.thumb.length <= MAX_THUMB ? value.thumb : undefined;
  return {
    id: value.id,
    name: cleanName(value.name) || "Workflow",
    steps: readSteps(value.steps),
    off,
    ...(thumb ? { thumb } : {}),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : EPOCH,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : EPOCH,
  };
}

export function isWorkflow(value: unknown): value is Workflow {
  return readWorkflow(value) !== null;
}

/** `loadWorkflows` does nothing when this person's are already loaded. */
export function reloadWorkflows(userId: string | undefined) {
  loadedKey = undefined;
  loadWorkflows(userId);
}

export function loadWorkflows(userId: string | undefined) {
  // A guest keeps theirs under the guest id, and they never sync.
  const owner = ownerOf(userId);
  if (!owner) {
    loadedKey = undefined;
    setItems([]);
    return;
  }
  const key = workflowsKey(owner);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setItems(Array.isArray(parsed) ? parsed.map(readWorkflow).filter((item): item is Workflow => item !== null) : []);
  } catch {
    setItems([]);
  }
}

/** Signed in, or a guest with a store. */
export const canSaveWorkflows = () => loadedKey !== undefined;

function write(update: (current: Workflow[]) => Workflow[]): boolean {
  if (!loadedKey) return false;
  setItems(update);
  try {
    localStorage.setItem(loadedKey, JSON.stringify(items()));
  } catch {
    // Storage full or blocked: the change holds until the page reloads.
    return true;
  }
  queueAccountSync();
  return true;
}

export function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}

const keptThumb = (thumb: string | undefined) => (thumb && thumb.length <= MAX_THUMB ? thumb : undefined);

/** Undefined when the name is empty or nothing is loaded. */
export function createWorkflow(name: string, steps: WorkflowSteps, thumb?: string): Workflow | undefined {
  const clean = cleanName(name);
  if (!clean || !loadedKey) return;
  const now = new Date().toISOString();
  const workflow: Workflow = { id: crypto.randomUUID(), name: clean, steps, off: [], createdAt: now, updatedAt: now };
  const still = keptThumb(thumb);
  if (still) workflow.thumb = still;
  return write((current) => [...current, workflow]) ? workflow : undefined;
}

export function replaceWorkflow(id: string, name: string, steps: WorkflowSteps, thumb?: string): boolean {
  const clean = cleanName(name);
  if (!clean) return false;
  const still = keptThumb(thumb);
  return write((current) =>
    current.map((item) => {
      if (item.id !== id) return item;
      const next: Workflow = { ...item, name: clean, steps, off: [], updatedAt: new Date().toISOString() };
      if (still) next.thumb = still;
      return next;
    }),
  );
}

/** False when the name is empty, which keeps the old one. */
export function renameWorkflow(id: string, name: string): boolean {
  const clean = cleanName(name);
  if (!clean) return false;
  write((current) => current.map((item) => (item.id === id && item.name !== clean ? { ...item, name: clean, updatedAt: new Date().toISOString() } : item)));
  return true;
}

export function updateWorkflow(id: string, change: Pick<Workflow, "steps" | "off">) {
  write((current) => current.map((item) => (item.id === id ? { ...item, steps: change.steps, off: change.off, updatedAt: new Date().toISOString() } : item)));
}

export function deleteWorkflow(id: string) {
  write((current) => current.filter((item) => item.id !== id));
}

export function restoreWorkflow(workflow: Workflow) {
  write((current) => (current.some((item) => item.id === workflow.id) ? current : [...current, workflow]));
}
