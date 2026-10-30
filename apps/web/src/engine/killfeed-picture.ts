/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Asset } from '@plan.video/assets';

export const KILLFEED_FOLDER = 'killfeed';

// Drawn this many times the placed height in a 1080-wide frame, so an entry scales up and stays sharp.
export const PICTURE_SCALE = 3;

// A 1080-wide vertical frame is unit 1; the unit follows the frame's short side.
export function killfeedUnit(width: number, height: number): number {
	return Math.min(2, Math.max(0.5, Math.min(width, height) / 1080));
}

export function isKillfeedPicture(asset: Asset): boolean {
	return asset.type === 'IMAGE' && asset.path.startsWith(`${KILLFEED_FOLDER}/`);
}

export function killfeedPictureSize(asset: { width: number; height: number }, width: number, height: number): { width: number; height: number } {
	const scale = killfeedUnit(width, height) / PICTURE_SCALE;
	return { width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) };
}
