/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The killfeed pictures kept in the library, and the size one is placed at.

import type { Asset } from '@plan.video/assets';

/** Where rendered entries are kept in the library. */
export const KILLFEED_FOLDER = 'killfeed';

/**
 * Every picture is drawn this many times the height it is placed at in a
 * 1080-wide frame, so an entry can be scaled up a long way and stay sharp.
 */
export const PICTURE_SCALE = 3;

/** The feed's size for a frame: a 1080-wide vertical frame is unit 1, and it follows the frame's short side. */
export function killfeedUnit(width: number, height: number): number {
	return Math.min(2, Math.max(0.5, Math.min(width, height) / 1080));
}

/** Whether `asset` is an entry one of the killfeed panels drew. */
export function isKillfeedPicture(asset: Asset): boolean {
	return asset.type === 'IMAGE' && asset.path.startsWith(`${KILLFEED_FOLDER}/`);
}

/** The size a killfeed picture goes on a `width` × `height` frame at: as big as the panel puts it, not its drawn size. */
export function killfeedPictureSize(asset: { width: number; height: number }, width: number, height: number): { width: number; height: number } {
	const scale = killfeedUnit(width, height) / PICTURE_SCALE;
	return { width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) };
}
