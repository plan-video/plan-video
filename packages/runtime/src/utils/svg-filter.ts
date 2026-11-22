/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Filters the canvas has been handed, by what they draw, least recently used
 * first. A value being dragged makes one a step, so the old ones go.
 */
const filters = new Map<string, SVGFilterElement>();
const MAX_FILTERS = 96;
let holder: SVGSVGElement | null = null;
let nextId = 0;

/**
 * A CSS filter the canvas can use (`url(#…)`) for the SVG filter `fill`
 * builds, shared by `key`. Null with no document to hold it in.
 */
export function svgFilterUrl(key: string, fill: (filter: SVGFilterElement) => void): string | null {
	if (typeof document === 'undefined' || !document.body) return null;

	let filter = filters.get(key);
	if (filter?.isConnected) {
		filters.delete(key);
	} else {
		if (!holder?.isConnected) {
			holder = document.createElementNS(SVG_NS, 'svg');
			holder.setAttribute('aria-hidden', 'true');
			holder.setAttribute('width', '0');
			holder.setAttribute('height', '0');
			// Not display:none, which some browsers take as no filter at all.
			holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
			document.body.append(holder);
			filters.clear();
		}
		filter = document.createElementNS(SVG_NS, 'filter');
		filter.id = `pv-filter-${nextId++}`;
		filter.setAttribute('color-interpolation-filters', 'sRGB');
		fill(filter);
		holder.append(filter);
	}

	filters.set(key, filter);
	for (const [stale, element] of filters) {
		if (filters.size <= MAX_FILTERS) break;
		element.remove();
		filters.delete(stale);
	}

	return `url(#${filter.id})`;
}

function primitive(filter: SVGFilterElement, tag: string, attributes: Record<string, string | number>, children: SVGElement[] = []): SVGElement {
	const element = document.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
	element.append(...children);
	filter.append(element);
	return element;
}

const CHANNELS = {
	r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
	g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
	b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
};

/** Red pulled `pixels` (canvas pixels) one way and blue the other; screening the three channels back together keeps an unshifted frame exact. */
export function rgbSplitFilter(pixels: number): string | null {
	const shift = Math.round(pixels * 2) / 2;
	if (shift < 0.5) return null;
	return svgFilterUrl(`rgb-split:${shift}`, (filter) => {
		filter.setAttribute('x', '-5%');
		filter.setAttribute('width', '110%');
		primitive(filter, 'feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: CHANNELS.r, result: 'r' });
		primitive(filter, 'feOffset', { in: 'r', dx: -shift, dy: 0, result: 'r2' });
		primitive(filter, 'feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: CHANNELS.g, result: 'g' });
		primitive(filter, 'feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: CHANNELS.b, result: 'b' });
		primitive(filter, 'feOffset', { in: 'b', dx: shift, dy: 0, result: 'b2' });
		primitive(filter, 'feBlend', { in: 'r2', in2: 'g', mode: 'screen', result: 'rg' });
		primitive(filter, 'feBlend', { in: 'rg', in2: 'b2', mode: 'screen' });
	});
}

/** The highlights, blurred by `radius` canvas pixels and screened back over the frame. */
export function glowFilter(radius: number): string | null {
	const blur = Math.round(radius * 2) / 2;
	if (blur < 0.5) return null;
	return svgFilterUrl(`glow:${blur}`, (filter) => {
		const linear = (slope: number, intercept: number) =>
			(['feFuncR', 'feFuncG', 'feFuncB'] as const).map((tag) => {
				const func = document.createElementNS(SVG_NS, tag);
				func.setAttribute('type', 'linear');
				func.setAttribute('slope', String(slope));
				func.setAttribute('intercept', String(intercept));
				return func;
			});
		// Only the brightest third glows, so a pale sky doesn't wash out.
		primitive(filter, 'feComponentTransfer', { in: 'SourceGraphic', result: 'bright' }, linear(3, -2));
		primitive(filter, 'feGaussianBlur', { in: 'bright', stdDeviation: blur, result: 'soft' });
		primitive(filter, 'feComponentTransfer', { in: 'soft', result: 'halo' }, linear(1.2, 0));
		primitive(filter, 'feBlend', { in: 'halo', in2: 'SourceGraphic', mode: 'screen' });
	});
}
