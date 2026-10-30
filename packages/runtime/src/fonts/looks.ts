/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { WebFonts } from './fixtures';

/** Lengths are in ems of the font size, so a look is the same at any size. A `<captions look>` keeps its preset's grouping and motion but gives up its face, colour, outline and shadow. */
export type TextLook = {
	font: keyof typeof WebFonts;
	weight: number;
	italic?: boolean;
	/** Font size against the other looks, 1 being a plain title. */
	size: number;
	textCase?: 'upper' | 'lower';
	letterSpacing?: number;
	/** A colour, or a gradient from the top of the words to their foot. */
	fill: string | { from: string; to: string };
	/** Outlines, widest first: later ones draw over earlier ones. Widths are the line's, half of it outside the glyph. */
	strokes?: { color: string; width: number }[];
	shadows?: { color: string; blur: number; x?: number; y?: number; opacity?: number }[];
};

const WHITE = '#FFFFFF';
const BLACK_SHADOW = { color: '#000000', blur: 0.24, y: 0.04, opacity: 0.6 };

/** In the order the editor shows them, two to a row. */
export const TEXT_LOOKS = {
	commentary: {
		font: 'Montserrat', weight: 800, size: 1,
		fill: WHITE,
		shadows: [{ color: '#000000', blur: 0.22, y: 0.05, opacity: 0.8 }],
	},
	hook: {
		font: 'Luckiest Guy', weight: 400, size: 1, textCase: 'upper',
		fill: WHITE,
		strokes: [{ color: '#000000', width: 0.2 }],
		shadows: [{ color: '#000000', blur: 0.3, opacity: 0.8 }],
	},
	punch: {
		font: 'Montserrat', weight: 900, size: 1.1, textCase: 'upper', italic: true,
		fill: WHITE,
		strokes: [{ color: '#000000', width: 0.18 }],
		shadows: [{ color: '#000000', blur: 0.3, y: 0.06, opacity: 0.6 }],
	},
	yellow: {
		font: 'Montserrat', weight: 800, size: 1,
		fill: '#FFE14D',
		strokes: [{ color: '#000000', width: 0.16 }],
	},
	glow: {
		font: 'Montserrat', weight: 800, size: 1, textCase: 'upper',
		fill: WHITE,
		shadows: [
			{ color: '#FFFFFF', blur: 0.6, opacity: 0.7 },
			{ color: '#FFFFFF', blur: 0.16, opacity: 0.8 },
		],
	},
	neon: {
		font: 'Rubik', weight: 800, size: 0.9, textCase: 'upper',
		fill: '#D2FFFF',
		shadows: [
			{ color: '#00D8FF', blur: 0.7 },
			{ color: '#00D8FF', blur: 0.2 },
		],
	},
	cinema: {
		font: 'Anton', weight: 400, size: 1.1, textCase: 'upper', letterSpacing: 0.01,
		fill: WHITE,
		shadows: [BLACK_SHADOW],
	},
	teal: {
		font: 'Anton', weight: 400, size: 1.1, textCase: 'upper', letterSpacing: 0.01,
		fill: '#45F2D6',
		shadows: [BLACK_SHADOW],
	},
	fire: {
		font: 'Anton', weight: 400, size: 1.1, textCase: 'upper', letterSpacing: 0.01,
		fill: { from: '#FFE873', to: '#FF8400' },
		shadows: [{ color: '#FF6A00', blur: 0.6, opacity: 0.9 }],
	},
	alert: {
		font: 'Anton', weight: 400, size: 1.1, textCase: 'upper', letterSpacing: 0.01,
		fill: WHITE,
		shadows: [
			{ color: '#FF2A2A', blur: 0.7 },
			{ color: '#FF2A2A', blur: 0.18 },
		],
	},
	sticker: {
		font: 'Luckiest Guy', weight: 400, size: 0.9, textCase: 'upper',
		fill: WHITE,
		strokes: [
			{ color: WHITE, width: 0.44 },
			{ color: '#1E8BFF', width: 0.26 },
		],
		shadows: [{ color: '#000000', blur: 0.24, y: 0.06, opacity: 0.4 }],
	},
	slime: {
		font: 'Luckiest Guy', weight: 400, size: 1, textCase: 'upper',
		fill: { from: '#F4FF80', to: '#6CFF3A' },
		strokes: [{ color: '#0B3D12', width: 0.18 }],
	},
	bubblegum: {
		font: 'Lilita One', weight: 400, size: 1,
		fill: '#FF8CC6',
		strokes: [{ color: '#7A0A3A', width: 0.16 }],
		shadows: [{ color: '#FF3D96', blur: 0.5, opacity: 0.7 }],
	},
	magenta: {
		font: 'Luckiest Guy', weight: 400, size: 1, textCase: 'upper',
		fill: { from: '#FF9CF2', to: '#C13CFF' },
		shadows: [{ color: '#E040FB', blur: 0.5, opacity: 0.9 }],
	},
	lime: {
		font: 'Montserrat', weight: 900, size: 1.1, textCase: 'upper', italic: true,
		fill: '#C6FF4A',
		shadows: [{ color: '#7BFF00', blur: 0.5, opacity: 0.8 }],
	},
	chrome: {
		font: 'Montserrat', weight: 900, size: 1, textCase: 'upper',
		fill: { from: '#FFFFFF', to: '#9EA8B6' },
		shadows: [{ color: '#000000', blur: 0.3, y: 0.05, opacity: 0.7 }],
	},
	gold: {
		font: 'Montserrat', weight: 900, size: 1, textCase: 'upper',
		fill: { from: '#FFF2B0', to: '#E0A022' },
		strokes: [{ color: '#3A2200', width: 0.1 }],
		shadows: [{ color: '#000000', blur: 0.3, y: 0.05, opacity: 0.6 }],
	},
	retro: {
		font: 'Rubik', weight: 900, size: 1, textCase: 'upper',
		fill: '#FFE7A8',
		shadows: [{ color: '#FF4D6D', blur: 0, x: 0.07, y: 0.07 }],
	},
	comic: {
		font: 'Bangers', weight: 400, size: 1.2, textCase: 'upper', letterSpacing: 0.03,
		fill: '#FFD60A',
		strokes: [{ color: '#000000', width: 0.16 }],
		shadows: [{ color: '#000000', blur: 0.2, y: 0.06, opacity: 0.7 }],
	},
	cute: {
		font: 'Chewy', weight: 400, size: 1.1,
		fill: WHITE,
		strokes: [{ color: '#FF5FA2', width: 0.2 }],
	},
	plain: {
		font: 'Inter', weight: 600, size: 0.8,
		fill: WHITE,
		shadows: [{ color: '#000000', blur: 0.2, y: 0.03, opacity: 0.5 }],
	},
	soft: {
		font: 'Nunito', weight: 900, size: 0.9, textCase: 'lower',
		fill: '#FFF1D0',
		shadows: [{ color: '#000000', blur: 0.2, opacity: 0.5 }],
	},
	handwritten: {
		font: 'Permanent Marker', weight: 400, size: 1,
		fill: WHITE,
		shadows: [{ color: '#000000', blur: 0.2, y: 0.03, opacity: 0.5 }],
	},
	ink: {
		font: 'Rubik', weight: 900, size: 1, textCase: 'upper',
		fill: '#111111',
		strokes: [{ color: WHITE, width: 0.22 }],
	},
} satisfies Record<string, TextLook>;

export type TextLookId = keyof typeof TEXT_LOOKS;

export function getTextLook(id: string | undefined): TextLook | null {
	return id !== undefined && Object.hasOwn(TEXT_LOOKS, id) ? TEXT_LOOKS[id as TextLookId] : null;
}
