/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { forgetMeasures, layoutPage, pageTiming, wordStates } from './engine';
import { loadSubtleFonts } from './fonts';
import { groupPages } from './pages';

import type { Ctx, Frame, Layout, LayoutOpts, PageRules, PageTiming, SPage, Style, WordSpec, WordState } from './engine';
import type { FontSpec } from './fonts';
import type { TimedWord } from './pages';
import type { CaptionPacing } from '../utils';

/** What a style's `paint` gets for the page on screen; times are frames at `f.fps`. */
export type PaintProps = {
	ctx: Ctx;
	st: Style;
	f: Frame;
	page: SPage;
	pageIndex: number;
	L: Layout;
	t: PageTiming;
	frame: number;
	/** Frames since the page started. */
	since: number;
	/** Frames until the page ends. */
	left: number;
	ws: WordState[];
};

/** One Subtle style: its preset file and how it draws a page. */
export type SubtleStyle = {
	style: Style;
	/** Per-word overrides before layout: mixed fonts, scaled words, replaced text. */
	spec?: (page: SPage, st: Style) => WordSpec[];
	layout?: (st: Style, f: Frame) => LayoutOpts;
	paint: (p: PaintProps) => void;
	/** Frames at 30 fps a page stays up at least, even when its words end sooner. */
	minShow?: number;
};

function fontsOf(st: Style): FontSpec[] {
	const out: FontSpec[] = [];
	const visit = (value: unknown) => {
		if (!value || typeof value !== 'object') return;
		const o = value as Record<string, unknown>;
		if (typeof o.family === 'string' && typeof o.weight === 'number') out.push(o as FontSpec);
		else for (const v of Object.values(o)) visit(v);
	};
	visit(st);
	return out;
}

export function loadStyleFonts(style: SubtleStyle): Promise<void> {
	return loadSubtleFonts(fontsOf(style.style)).then(forgetMeasures);
}

const layouts = new WeakMap<SPage, { key: string; L: Layout }>();

/** Draws `page` as it is at `ms`, in frame coordinates. */
export function paintSubtlePage(ctx: Ctx, style: SubtleStyle, st: Style, f: Frame, page: SPage, pageIndex: number, ms: number): void {
	const key = `${f.W}x${f.H}:${st.size}:${st.position.y}`;
	let laid = layouts.get(page);
	if (!laid || laid.key !== key) {
		const L = layoutPage(page, st, f, { ...style.layout?.(st, f), specs: style.spec?.(page, st) });
		laid = { key, L };
		layouts.set(page, laid);
	}
	const t = pageTiming(page, f.fps);
	const frame = (ms * f.fps) / 1000;
	ctx.save();
	style.paint({ ctx, st, f, page, pageIndex, L: laid.L, t, frame, since: frame - t.s, left: t.e - frame, ws: wordStates(t, frame) });
	ctx.restore();
}

/** The rules with the author's pacing over them. */
export function pacedRules(st: Style, pacing: CaptionPacing): PageRules {
	const rules = { ...st.page };
	if (pacing.words !== undefined) rules.maxWords = pacing.words;
	if (pacing.chars !== undefined) {
		const lines = Math.max(1, rules.maxLines ?? 1);
		rules.maxCharsPerLine = Math.max(1, Math.ceil(pacing.chars / lines));
		rules.maxCharsPerLineWide = rules.maxCharsPerLine;
	}
	return rules;
}

/** Pages for `words`; `minShow` frames at 30 fps hold a page up until the next one starts. */
export function subtlePages(style: SubtleStyle, words: readonly TimedWord[], wide: boolean, pacing: CaptionPacing = {}): SPage[] {
	const pages = groupPages(words, pacedRules(style.style, pacing), wide, pacing.linger === undefined ? undefined : pacing.linger * 1000);
	if (style.minShow) {
		const min = (style.minShow * 1000) / 30;
		pages.forEach((page, i) => {
			const next = pages[i + 1]?.startMs ?? Infinity;
			page.endMs = Math.max(page.endMs, Math.min(page.startMs + min, next));
		});
	}
	return pages;
}
