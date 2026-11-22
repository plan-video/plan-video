/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign } from '../../../constants';
import { Computed, RenderSurface, TextStyle } from '../../../traits';
import { store } from '../../../world/store';
import { colorToHex } from '../../../utils/color';
import { captionFrame, placeCaption } from '../position';
import { resolveTranscript } from '../utils';
import { baseFontSize } from './engine';
import { pageAt } from './pages';
import { loadStyleFonts, paintSubtlePage, subtlePages } from './style';

import type { Entity, World } from 'koota';
import type { Asset, WordGroup } from '@plan.video/assets';
import type { CaptionType } from '../../../constants';
import type { CaptionDecoder } from '../types';
import type { CaptionPacing } from '../utils';
import type { Frame, SPage, Style } from './engine';
import type { TimedWord } from './pages';
import type { SubtleStyle } from './style';

/** Draws one of Subtle's styles itself, on the whole frame, instead of laying out the caption's text. */
export class SubtleCaptionDecoder implements CaptionDecoder {
	public groups: WordGroup[] = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	private words: TimedWord[] = [];
	private paged: { wide: boolean; pages: SPage[] } | null = null;
	private time = 0;
	private loadId = 0;

	constructor(
		public readonly type: CaptionType,
		private readonly style: SubtleStyle,
		private readonly fontSize: number,
		private readonly asset: Asset,
		pacing: CaptionPacing = {},
	) {
		this.pacing = pacing;
		this.loaded = this.load();
	}

	public reload(): Promise<void> {
		return this.load();
	}

	public repace(pacing: CaptionPacing): Promise<void> {
		this.pacing = pacing;
		this.paged = null;
		return Promise.resolve();
	}

	private async load(): Promise<void> {
		const loadId = ++this.loadId;
		const [transcript] = await Promise.all([resolveTranscript(this.asset), loadStyleFonts(this.style)]);
		if (loadId !== this.loadId) return;
		const words: TimedWord[] = [];
		this.groups = [];
		for (const segment of transcript) {
			const group: WordGroup = [];
			for (const word of segment.words) {
				group.push(word);
				const text = word.text.trim();
				if (!text || word.style?.hidden) continue;
				const color = word.style?.color;
				words.push({
					text,
					startMs: word.start * 1000,
					endMs: word.end * 1000,
					...(color !== undefined ? { color: colorToHex(color), forced: true } : {}),
				});
			}
			if (group.length) this.groups.push(group);
		}
		this.words = words;
		this.paged = null;
		this.ready = true;
	}

	private pages(wide: boolean): SPage[] {
		if (!this.paged || this.paged.wide !== wide) this.paged = { wide, pages: subtlePages(this.style, this.words, wide, this.pacing) };
		return this.paged.pages;
	}

	private frameOf(world: World, entity: Entity): { W: number; H: number } | null {
		const parent = captionFrame(entity);
		if (!parent) return null;
		const computed = store(world, Computed);
		const W = computed.width[parent.id()] ?? 0;
		const H = computed.height[parent.id()] ?? 0;
		return W > 0 && H > 0 ? { W, H } : null;
	}

	/** The style with the inspector's font size over its own. */
	private styleFor(world: World, entity: Entity): Style {
		const st = this.style.style;
		const size = store(world, TextStyle).fontSize[entity.id()];
		const k = size && this.fontSize ? size / this.fontSize : 1;
		return k === 1 ? st : { ...st, size: st.size * k };
	}

	/** A band across the frame around the style's line; the words are drawn about its centre. */
	public reposition(world: World, entity: Entity): boolean {
		const frame = this.frameOf(world, entity);
		if (!frame) return false;
		const st = this.styleFor(world, entity);
		const f = { ...frame, fps: 30, wide: frame.W > frame.H, unit: 1 };
		const lines = Math.max(1, st.page.maxLines ?? 1);
		const width = Math.round(frame.W * (1 - (2 * st.position.marginX) / 100));
		const height = Math.round(Math.min(frame.H, baseFontSize(st.size, st, f) * (st.lineHeight ?? 1.15) * lines * 1.8));
		return placeCaption(world, entity, {
			width,
			height,
			x: Math.round((frame.W * (st.position.x ?? 50)) / 100 - width / 2),
			y: Math.round((frame.H * st.position.y) / 100 - height / 2),
			defaultAlign: CaptionAlign.CENTER,
		});
	}

	public applyStyles(world: World, entity: Entity): boolean {
		return this.reposition(world, entity);
	}

	public seekTo(_world: World, _entity: Entity, relativeTime: number): void {
		this.time = relativeTime;
	}

	public draw(world: World, entity: Entity): void {
		const ctx = world.get(RenderSurface)?.ctx;
		const frame = this.frameOf(world, entity);
		if (!ctx || !frame || !this.ready) return;
		const pages = this.pages(frame.W > frame.H);
		const ms = this.time * 1000;
		const index = pageAt(pages, ms);
		if (index === -1) return;

		const st = this.styleFor(world, entity);
		const computed = store(world, Computed);
		const w = computed.width[entity.id()] ?? 0;
		const h = computed.height[entity.id()] ?? 0;
		ctx.save();
		ctx.translate(w / 2 - (frame.W * (st.position.x ?? 50)) / 100, h / 2 - (frame.H * st.position.y) / 100);
		const m = ctx.getTransform();
		const f: Frame = { ...frame, fps: 30, wide: frame.W > frame.H, unit: Math.hypot(m.a, m.b) || 1 };
		paintSubtlePage(ctx, this.style, st, f, pages[index]!, index, ms);
		ctx.restore();
	}

	public dispose(): void {
		this.loadId++;
		this.words = [];
		this.paged = null;
		this.groups = [];
	}
}
