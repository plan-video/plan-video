/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType } from '../../constants';
import { AssetId, Caption, ChildOf, Paint, Shadow, Source, TextRange, TextStyle, CaptionDecoderHandle } from '../../traits';
import { getAsset } from '../../actions/assets';
import { deleteEntity } from '../../actions/entities';
import { ClassicCaptionDecoder, CLASSIC_TEXT_STYLE } from './classic';
import { CascadeCaptionDecoder, CASCADE_TEXT_STYLE } from './cascade';
import { SpotlightCaptionDecoder, SPOTLIGHT_TEXT_STYLE } from './spotlight';
import { WhisperCaptionDecoder, WHISPER_TEXT_STYLE } from './whisper';
import { PaperCaptionDecoder, PAPER_TEXT_STYLE } from './paper';
import { GuineaCaptionDecoder, GUINEA_TEXT_STYLE } from './guinea';
import { StarkCaptionDecoder, STARK_TEXT_STYLE } from './stark';
import { PopCaptionDecoder, POP_TEXT_STYLE } from './pop';
import { BoxCaptionDecoder, BOX_TEXT_STYLE } from './box';
import { MarkerCaptionDecoder, MARKER_TEXT_STYLE } from './marker';
import { DeepCaptionDecoder, DEEP_TEXT_STYLE } from './deep';
import { RiseCaptionDecoder, RISE_TEXT_STYLE } from './rise';
import { FocusCaptionDecoder, FOCUS_TEXT_STYLE } from './focus';
import { captionPlacementKey } from './position';
import { wearCaptionLook } from './look';
import { store } from '../../world/store';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';
import type { CaptionPacing } from './utils';

export type { CaptionDecoder, CaptionPresetStyle } from './types';
export { ClassicCaptionDecoder, CLASSIC_PRESET_WIDTH, CLASSIC_PRESET_HEIGHT } from './classic';
export { CascadeCaptionDecoder } from './cascade';
export { SpotlightCaptionDecoder } from './spotlight';
export { WhisperCaptionDecoder } from './whisper';
export { PaperCaptionDecoder } from './paper';
export { GuineaCaptionDecoder } from './guinea';
export { StarkCaptionDecoder } from './stark';
export { PopCaptionDecoder } from './pop';
export { BoxCaptionDecoder, BOX_COLOR } from './box';
export { MarkerCaptionDecoder, MARKER_COLOR } from './marker';
export { DeepCaptionDecoder, DEEP_HIGHLIGHT } from './deep';
export { RiseCaptionDecoder } from './rise';
export { FocusCaptionDecoder } from './focus';
export * from './position';
export * from './subtitles';
export * from './utils';
export { wearCaptionLook } from './look';

/** Written onto a `<captions>` entity when the preset is (re)applied, then the authored style props are re-run over them. */
export const CAPTION_PRESET_STYLES: Record<CaptionType, CaptionPresetStyle> = {
	[CaptionType.CLASSIC]: CLASSIC_TEXT_STYLE,
	[CaptionType.CASCADE]: CASCADE_TEXT_STYLE,
	[CaptionType.SPOTLIGHT]: SPOTLIGHT_TEXT_STYLE,
	[CaptionType.WHISPER]: WHISPER_TEXT_STYLE,
	[CaptionType.PAPER]: PAPER_TEXT_STYLE,
	[CaptionType.GUINEA]: GUINEA_TEXT_STYLE,
	[CaptionType.STARK]: STARK_TEXT_STYLE,
	[CaptionType.POP]: POP_TEXT_STYLE,
	[CaptionType.BOX]: BOX_TEXT_STYLE,
	[CaptionType.MARKER]: MARKER_TEXT_STYLE,
	[CaptionType.DEEP]: DEEP_TEXT_STYLE,
	[CaptionType.RISE]: RISE_TEXT_STYLE,
	[CaptionType.FOCUS]: FOCUS_TEXT_STYLE,
};

/** Seeded under the paint children; the authored `fill` overwrites it, so a recolor survives a reload. Stark has none: its DIFFERENCE-blend fill child can't be an intrinsic solid. */
export const CAPTION_PRESET_FILLS: Record<CaptionType, number | undefined> = {
	[CaptionType.CLASSIC]: 0xFFFFFF,
	[CaptionType.CASCADE]: 0xFFFFFF,
	[CaptionType.SPOTLIGHT]: 0xFFFFFF,
	[CaptionType.WHISPER]: 0xFFFFFF,
	[CaptionType.PAPER]: 0xFFFFFF,
	[CaptionType.GUINEA]: 0xFFFFFF,
	[CaptionType.STARK]: undefined,
	[CaptionType.POP]: 0xFFCC00,
	[CaptionType.BOX]: 0xFFFFFF,
	[CaptionType.MARKER]: 0xFFFFFF,
	[CaptionType.DEEP]: 0xFFFFFF,
	[CaptionType.RISE]: 0xFFFFFF,
	[CaptionType.FOCUS]: 0xFFFFFF,
};

function pacingOf(entity: Entity): CaptionPacing {
	const caption = entity.get(Caption);
	return {
		...(caption?.words !== undefined ? { words: caption.words } : {}),
		...(caption?.chars !== undefined ? { chars: caption.chars } : {}),
		...(caption?.linger !== undefined ? { linger: caption.linger } : {}),
	};
}

const samePacing = (a: CaptionPacing, b: CaptionPacing): boolean =>
	a.words === b.words && a.chars === b.chars && a.linger === b.linger;

function createCaptionDecoder(type: CaptionType, asset: Asset, pacing: CaptionPacing): CaptionDecoder {
	switch (type) {
		case CaptionType.CLASSIC:
			return new ClassicCaptionDecoder(asset, pacing);
		case CaptionType.CASCADE:
			return new CascadeCaptionDecoder(asset, pacing);
		case CaptionType.SPOTLIGHT:
			return new SpotlightCaptionDecoder(asset, pacing);
		case CaptionType.WHISPER:
			return new WhisperCaptionDecoder(asset, pacing);
		case CaptionType.PAPER:
			return new PaperCaptionDecoder(asset, pacing);
		case CaptionType.GUINEA:
			return new GuineaCaptionDecoder(asset, pacing);
		case CaptionType.STARK:
			return new StarkCaptionDecoder(asset, pacing);
		case CaptionType.POP:
			return new PopCaptionDecoder(asset, pacing);
		case CaptionType.BOX:
			return new BoxCaptionDecoder(asset, pacing);
		case CaptionType.MARKER:
			return new MarkerCaptionDecoder(asset, pacing);
		case CaptionType.DEEP:
			return new DeepCaptionDecoder(asset, pacing);
		case CaptionType.RISE:
			return new RiseCaptionDecoder(asset, pacing);
		case CaptionType.FOCUS:
			return new FocusCaptionDecoder(asset, pacing);
		default:
			return new ClassicCaptionDecoder(asset, pacing);
	}
}

/** So the next preset's fills don't stack. The TextStyle stays (the document rewrites it), and animations and keyframe tracks are the file's. */
function clearPresetStyling(world: World, entity: Entity): void {
	for (const child of world.query(ChildOf(entity))) {
		// A child with a Source is the file's (an authored stroke, say), not
		// the preset's; only what a decoder made is cleared.
		if (child.has(Source)) continue;
		if (child.has(Paint) || child.has(Shadow) || child.has(TextRange)) {
			deleteEntity(world, child);
		}
	}
}

const placements = new WeakMap<CaptionDecoder, string>();

const looks = new WeakMap<CaptionDecoder, string>();

/** A look's outlines are cut to the font size, so the size is part of the key. */
function lookKey(world: World, entity: Entity): string {
	const look = entity.get(Caption)?.look;
	return look ? `${look} ${store(world, TextStyle).fontSize[entity.id()] ?? ''}` : '';
}

function style(world: World, entity: Entity, decoder: CaptionDecoder): boolean {
	if (!decoder.applyStyles(world, entity)) return false;
	wearCaptionLook(world, entity);
	looks.set(decoder, lookKey(world, entity));
	return true;
}

/** So a landscape scene turned vertical doesn't keep its captions where the old frame's centre was. */
function keepPlaced(world: World, entity: Entity, decoder: CaptionDecoder): void {
	const key = captionPlacementKey(world, entity);
	if (key === null || placements.get(decoder) === key) return;
	if (decoder.reposition(world, entity)) placements.set(decoder, key);
}

/** Recreated when the caption type changes; null until the transcript asset is available. */
export function resolveCaptionDecoder(world: World, entity: Entity): CaptionDecoder | null {
	const assetId = entity.get(AssetId)?.value;
	if (!assetId) return null;

	const captionType = entity.get(Caption)?.type ?? CaptionType.CLASSIC;
	const existing = entity.get(CaptionDecoderHandle);

	// A new look, or a new size for one, is styled afresh like a new preset.
	const sameLook = !existing?.styled || looks.get(existing) === lookKey(world, entity);

	if (existing && captionType === existing.type && sameLook) {
		// A resolve before the entity was parented had nothing to place
		// against; keep trying until placement lands.
		if (!existing.styled) existing.styled = style(world, entity, existing);
		else keepPlaced(world, entity, existing);
		const pacing = pacingOf(entity);
		if (!samePacing(pacing, existing.pacing)) void existing.repace(pacing);
		return existing;
	}

	existing?.dispose();

	const asset = getAsset(world, assetId);
	if (!asset) return null;

	const decoder = createCaptionDecoder(captionType, asset, pacingOf(entity));
	entity.add(CaptionDecoderHandle);
	entity.set(CaptionDecoderHandle, decoder);

	// Whatever an earlier decoder made goes first: one for another preset or
	// look, or the same one released while its scene was off screen.
	clearPresetStyling(world, entity);
	decoder.styled = style(world, entity, decoder);

	return decoder;
}
