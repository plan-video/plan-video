/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Widths measured before the web fonts land describe the fallback, so the cache is dropped when they swap in.
const WIDTHS = new Map<string, number>();

document?.fonts.addEventListener('loadingdone', () => WIDTHS.clear());

/** `font` keys the cache, since the same string measures differently in two fonts. */
export function truncateText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	font: string = 'default',
): string | null {
	const measure = (value: string): number => {
		const key = `${font}-${value}`;
		const cached = WIDTHS.get(key);
		if (cached !== undefined) return cached;

		const width = ctx.measureText(value).width;
		WIDTHS.set(key, width);
		return width;
	};

	if (measure(text) <= maxWidth) return text;

	const available = maxWidth - measure('...');
	if (available <= 0) return null;

	let low = 0;
	let high = text.length;
	let best = 0;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (measure(text.slice(0, mid)) <= available) {
			best = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return best > 0 ? `${text.slice(0, best)}...` : null;
}
