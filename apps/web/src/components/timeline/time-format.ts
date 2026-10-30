/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg, t } from '@/lib/i18n';

export type TimeFormat = 'standard' | 'timecode' | 'frames';

export const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string; example: string }[] = [
  { value: 'standard', label: msg('Standard'), example: msg('MM:SS:CS') },
  { value: 'timecode', label: msg('Timecode'), example: msg('HH:MM:SS:FF') },
  { value: 'frames', label: msg('Frames'), example: msg('30f') },
];

function pad(value: number) {
  return Math.floor(value).toString().padStart(2, '0');
}

export function formatFrames(frame: number, fps: number, format: TimeFormat) {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeFrame = Number.isFinite(frame) ? Math.max(0, frame) : 0;

  switch (format) {
    case 'frames':
      return t('{count}f', { count: Math.round(safeFrame) });
    case 'timecode': {
      const totalSeconds = Math.floor(safeFrame / safeFps);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const frames = Math.floor(safeFrame % safeFps);
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
    }
    case 'standard':
    default: {
      const time = safeFrame / safeFps;
      const minutes = Math.floor(time / 60);
      const seconds = Math.floor(time % 60);
      const centiseconds = Math.floor((time % 1) * 100);
      return `${pad(minutes)}:${pad(seconds)}:${pad(centiseconds)}`;
    }
  }
}
