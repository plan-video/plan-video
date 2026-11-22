/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Registered under their own names so the text inspector's font list stays as it is.

export type SubtleFamily =
	| 'Inter' | 'Montserrat' | 'Poppins' | 'Anton' | 'Instrument Serif' | 'Pinyon Script'
	| 'Libre Baskerville' | 'Courier Prime' | 'Archivo Black' | 'Caveat' | 'Playfair Display';

/** `family` is one of the faces below; `italic` picks its italic file. */
export type FontSpec = { family: SubtleFamily; weight: number; italic?: boolean };

type Face = { url: string; weight: string; italic?: boolean };

const GSTATIC = 'https://fonts.gstatic.com/s/';

const FACES: Record<SubtleFamily, Face[]> = {
	Inter: [{ url: 'inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2', weight: '100 900' }],
	Montserrat: [{ url: 'montserrat/v26/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2', weight: '100 900' }],
	Poppins: [
		{ url: 'poppins/v24/pxiByp8kv8JHgFVrLGT9Z1xlFd2JQEk.woff2', weight: '500' },
		{ url: 'poppins/v24/pxiByp8kv8JHgFVrLEj6Z1xlFd2JQEk.woff2', weight: '600' },
		{ url: 'poppins/v24/pxiByp8kv8JHgFVrLCz7Z1xlFd2JQEk.woff2', weight: '700' },
		{ url: 'poppins/v24/pxiByp8kv8JHgFVrLDD4Z1xlFd2JQEk.woff2', weight: '800' },
		{ url: 'poppins/v24/pxiByp8kv8JHgFVrLBT5Z1xlFd2JQEk.woff2', weight: '900' },
		{ url: 'poppins/v24/pxiDyp8kv8JHgFVrJJLmr19VF9eOYktMqg.woff2', weight: '600', italic: true },
	],
	Anton: [{ url: 'anton/v27/1Ptgg87LROyAm3Kz-C8CSKlv.woff2', weight: '400' }],
	'Instrument Serif': [
		{ url: 'instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjnTLgNs.woff2', weight: '400' },
		{ url: 'instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjjH7Motmp5g.woff2', weight: '400', italic: true },
	],
	'Pinyon Script': [{ url: 'pinyonscript/v24/6xKpdSJbL9-e9LuoeQiDRQR8WOXaOqTimDc.woff2', weight: '400' }],
	'Libre Baskerville': [{ url: 'librebaskerville/v24/kmKnZrc3Hgbbcjq75U4uslyuy4kn0qNZaxMaC82U.woff2', weight: '400 700' }],
	'Courier Prime': [
		{ url: 'courierprime/v11/u-450q2lgwslOqpF_6gQ8kELawFpWs39pvk.woff2', weight: '400' },
		{ url: 'courierprime/v11/u-4k0q2lgwslOqpF_6gQ8kELY7pMT-Dfq9PrNX0.woff2', weight: '700' },
	],
	'Archivo Black': [{ url: 'archivoblack/v23/HTxqL289NzCGg4MzN6KJ7eW6CYyF_jzx13E.woff2', weight: '400' }],
	Caveat: [{ url: 'caveat/v23/Wnz6HAc5bAfYB2Q7ZjYYiAzcPA.woff2', weight: '400 700' }],
	'Playfair Display': [
		{ url: 'playfairdisplay/v40/nuFiD-vYSZviVYUb_rj3ij__anPXDTzYgEM86xQ.woff2', weight: '400 900' },
		{ url: 'playfairdisplay/v40/nuFkD-vYSZviVYUb_rj3ij__anPXDTnogkk7yRZrPA.woff2', weight: '400 900', italic: true },
	],
};

const familyName = (family: SubtleFamily) => `pv ${family}`;

/** A canvas `font` string. */
export function fontString(font: FontSpec, size: number): string {
	return `${font.italic ? 'italic ' : ''}${font.weight} ${size}px "${familyName(font.family)}"`;
}

function fontFaceSet(): FontFaceSet | null {
	const scope = globalThis as { document?: { fonts?: FontFaceSet }; fonts?: FontFaceSet };
	return scope.document?.fonts ?? scope.fonts ?? null;
}

const loads = new Map<string, Promise<void>>();

function loadFace(family: SubtleFamily, face: Face): Promise<void> {
	const key = `${family} ${face.url}`;
	let loading = loads.get(key);
	if (loading) return loading;
	const set = fontFaceSet();
	if (!set || typeof FontFace === 'undefined') return Promise.resolve();
	const fontFace = new FontFace(familyName(family), `url(${GSTATIC}${face.url})`, {
		weight: face.weight,
		style: face.italic ? 'italic' : 'normal',
	});
	loading = fontFace.load().then((loaded) => {
		set.add(loaded);
	}, () => {
		loads.delete(key);
	});
	loads.set(key, loading);
	return loading;
}

/** Settles when every face is in, or has failed (a failed one is drawn in a fallback and tried again next time). */
export function loadSubtleFonts(fonts: readonly FontSpec[]): Promise<void> {
	const wanted = new Set<Face>();
	const all: Promise<void>[] = [];
	for (const font of fonts) {
		for (const face of FACES[font.family]) {
			if (Boolean(face.italic) !== Boolean(font.italic) || wanted.has(face)) continue;
			wanted.add(face);
			all.push(loadFace(font.family, face));
		}
	}
	return Promise.all(all).then(() => {});
}
