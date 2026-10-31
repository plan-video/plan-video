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

export function isInputTarget(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
