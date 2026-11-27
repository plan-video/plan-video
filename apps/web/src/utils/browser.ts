/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mimeTypeToExtension } from "./media";
import { colord } from "colord";

export function getCssVar(name: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  return colord(value);
}

/** Null if cancelled or unsupported. */
export async function pickScreenColor(): Promise<string | null> {
  try {
    const eyeDropper = new (window as any).EyeDropper();
    const result = await eyeDropper.open();
    return result.sRGBHex;
  } catch {
    return null;
  }
}

export async function verifyHandlePermission(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  const options = { mode };

  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

/** Prompts in parallel in one task so Chromium merges them into one dialog. Must run during a user activation (a click). */
export async function verifyHandlePermissions(
  handles: (FileSystemDirectoryHandle | FileSystemFileHandle)[],
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  if (handles.length === 0) return true;

  const options = { mode };
  const states = await Promise.all(handles.map(h => h.queryPermission(options)));
  const pending = handles.filter((_, i) => states[i] !== 'granted');
  if (pending.length === 0) return true;

  const results = await Promise.all(pending.map(h => h.requestPermission(options)));
  return results.every(state => state === 'granted');
}

export async function showFileDialog(
  accept = 'image/*,video/*,audio/*,text/*',
  multiple = true
): Promise<(File | FileSystemFileHandle)[]> {
  try {
    if ('showOpenFilePicker' in window) {
      return await window.showOpenFilePicker({
        multiple,
        startIn: 'downloads',
      });
    }

    return new Promise<File[]>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = (fileEvent: Event) => {
        const files = Array.from((fileEvent.target as HTMLInputElement)?.files ?? []);
        resolve(files);
      };
      input.oncancel = () => resolve([]);
      input.click();
    });
  } catch {
    return [];
  }
}

export async function downloadObject(source: Blob, name?: string): Promise<void> {
  const a = document.createElement('a');
  document.head.appendChild(a);
  a.target = '_blank';

  if (name && !name.match(/\.[^.]+$/)) {
    if (source instanceof File) {
      name = name + mimeTypeToExtension(source.type);
    } else if (source instanceof FileSystemFileHandle) {
      const file = await source.getFile();
      name = name + mimeTypeToExtension(file.type);
    }
  }

  if (name) {
    a.download = name;
  } else if (source instanceof File) {
    a.download = source.name;
  } else if (source instanceof Blob) {
    a.download = 'untitled';
  }

  a.href = URL.createObjectURL(source);

  a.click();
  a.remove();
}

const SAVES = "saves";

/** False in Firefox and Safari: they have no save dialog, so saves go through the site's own storage and download from there. */
export const canPickSaveLocation = () => "showSaveFilePicker" in window;

/**
 * The file a save streams into: the one the person picks, or where the browser can't ask, a file in the
 * site's own storage that `handOver` then downloads. Null when the dialog was cancelled.
 */
export async function pickSaveFile(suggestedName: string, types?: FilePickerAcceptType[]): Promise<FileSystemFileHandle | null> {
  if (canPickSaveLocation()) {
    try {
      return await window.showSaveFilePicker({ suggestedName, types });
    } catch (error) {
      if ((error as Error).name === "AbortError") return null;
      throw error;
    }
  }
  const root = await navigator.storage.getDirectory();
  // Only the latest save stays: the storage is the person's disk, and earlier ones have long been downloaded.
  await root.removeEntry(SAVES, { recursive: true }).catch(() => {});
  const folder = await root.getDirectoryHandle(SAVES, { create: true });
  return folder.getFileHandle(suggestedName.replace(/[\\/]/g, "-"), { create: true });
}

/** Downloads a file `pickSaveFile` wrote into the site's storage; a picked file is already where it belongs. */
export async function handOver(handle: FileSystemFileHandle): Promise<void> {
  if (!canPickSaveLocation()) await downloadObject(await handle.getFile(), handle.name);
}

/** For browsers that can't pick a folder to write into: the files go out as one zip, folders kept as paths. */
export async function saveZip(name: string, files: { name: string; input: Blob | string }[]): Promise<boolean> {
  const handle = await pickSaveFile(name, [{ description: "ZIP", accept: { "application/zip": [".zip"] } }]);
  if (!handle) return false;
  const { downloadZip } = await import("client-zip");
  await downloadZip(files).body!.pipeTo(await handle.createWritable());
  await handOver(handle);
  return true;
}

export function isInputTarget(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
