/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Takes the background out of a picture on this device. bg0 runs BiRefNet
// (lite, 512 px) through ONNX Runtime on WebGPU, or WebAssembly where there
// is none. Nothing is uploaded: the model downloads once and the browser
// keeps it.

import type { BackgroundRemovalResult, RemovalProgress } from "@bg0/browser";

import { msg, t } from "@/lib/i18n";

export type CutoutProgress = RemovalProgress;
export type Cutout = BackgroundRemovalResult;

export const CUTOUT_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
export const CUTOUT_FORMATS = msg("PNG, JPG or WebP up to 40 MB");

const READY_KEY = "plan.video.cutout.ready";
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** One run at a time: the model holds one session, and two runs would fight over the GPU. */
let queue: Promise<unknown> = Promise.resolve();

/** Where bg0 notes that WebGPU gave it a bad mask in this browser, keyed to the model revision it pins. */
const WEBGPU_FAILURE_KEY = "bg0:webgpu-failure:4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7";

let proxied: Promise<void> | undefined;

/**
 * On the CPU, ONNX Runtime runs on the page's thread and freezes it for
 * seconds while the model loads and runs. Its proxy worker moves that off,
 * but only for WebAssembly, and only if set before the first session: so
 * it is on when this browser has no WebGPU, or bg0 found it unusable here.
 */
function keepOffMainThread(): Promise<void> {
  proxied ??= import("@huggingface/transformers").then(({ env }) => {
    let webGpuFailed = false;
    try {
      webGpuFailed = localStorage.getItem(WEBGPU_FAILURE_KEY) === navigator.userAgent;
    } catch {
      // Storage blocked: bg0 tries WebGPU first, as it would anyway.
    }
    const wasm = env.backends.onnx.wasm;
    if (!wasm) return;
    // transformers.js points ONNX Runtime at its files on cdn.jsdelivr.net.
    // The website's build carries them (the glue in the bundle, the .wasm
    // beside it), and its Content-Security-Policy runs no script from that CDN.
    if (import.meta.env.PROD && !window.desktop) wasm.wasmPaths = undefined;
    if (!hasWebGpu() || webGpuFailed) wasm.proxy = true;
  });
  return proxied;
}

const typeOf = (file: File): string | undefined => file.type || TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""];

/** The picture's type as bg0 checks it, read off the name when the browser left it blank. */
function typed(image: Blob): Blob {
  if (image.type || !(image instanceof File)) return image;
  const type = typeOf(image);
  return type ? new Blob([image], { type }) : image;
}

/** Whether bg0 takes the file: a PNG, JPG or WebP. */
export const isCutoutImage = (file: File): boolean => Object.values(TYPES).includes(typeOf(file) ?? "");

/**
 * The picture with its background taken out, as a PNG at the original size.
 * Aborting rejects at once with a `cancelled` error; a run already on the
 * GPU finishes in the background before the next one starts.
 */
export function removeImageBackground(
  image: Blob,
  options: { onProgress?(progress: CutoutProgress): void; signal?: AbortSignal } = {},
): Promise<Cutout> {
  const { signal, onProgress } = options;
  const run = queue.then(async () => {
    await keepOffMainThread();
    const { BackgroundRemovalError, removeBackground } = await import("@bg0/browser");
    if (signal?.aborted) throw new BackgroundRemovalError("cancelled", t("Processing was cancelled."));
    const result = await removeBackground(typed(image), {
      signal,
      onProgress: (progress) => !signal?.aborted && onProgress?.(progress),
    });
    try {
      localStorage.setItem(READY_KEY, "1");
    } catch {
      // Storage blocked: the first-run note shows again, nothing else changes.
    }
    return result;
  });
  queue = run.catch(() => undefined);
  if (!signal) return run;

  return new Promise<Cutout>((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error(t("Processing was cancelled.")), { code: "cancelled" }));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    run.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Whether the model has run here before, so the first-run download note can stay out of the way. */
export function cutoutModelReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the GPU path is there; without it the model runs, slower, on the CPU. */
export const hasWebGpu = (): boolean => typeof navigator !== "undefined" && "gpu" in navigator;

/** How much the model download weighs on this machine: half precision on the GPU, full on the CPU. */
export const modelDownloadSize = (): string => (hasWebGpu() ? t("about 95 MB") : t("about 190 MB"));

const codeOf = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;

export const isCancelled = (error: unknown): boolean => codeOf(error) === "cancelled";

/** Whether running again could go differently: not for a file the model can't take. */
export const canRetryCutout = (error: unknown): boolean =>
  !["unsupported-image", "image-too-large", "decode-failed"].includes(codeOf(error) ?? "");

/** bg0's errors are written for people; anything else gets a plain sentence. */
export function cutoutError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error instanceof Error) return error.message;
  return t("The background could not be removed. Try again, or use a smaller image.");
}

/** The file name the result goes by, as the editor's transform names it: `<name> (Background removed).png`. */
export function cutoutName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "") || "Image";
  return `${stem} (Background removed).png`;
}
