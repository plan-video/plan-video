/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Everything goes through the editor, so replacing several clips is one undo step.

import { authoredTree, renderAuthored } from '@plan.video/reconciler';
import {
	AdjustmentLayer,
	Computed,
	FrameRate,
	Geometry,
	Group,
	Name,
	Selected,
	findGeometryAsset,
	findGeometryAssetSource,
	getNextName,
	getSourceDuration,
	getTimelineOrigin,
	isCaption,
} from '@plan.video/runtime';
import { assetName } from '@plan.video/assets';
import { Or } from 'koota';
import { toast } from 'somoto';

import { t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';
import { authoredTime, editTime } from './timing';

import type { Asset } from '@plan.video/assets';
import type { Entity, World } from 'koota';

const NODES = Or(Geometry, Group, AdjustmentLayer);

export type MediaKind = 'picture' | 'sound';

export function mediaKind(asset: Pick<Asset, 'type'> | null | undefined): MediaKind | null {
	switch (asset?.type) {
		case 'VIDEO':
		case 'SEQUENCE':
		case 'IMAGE':
			return 'picture';
		case 'AUDIO':
			return 'sound';
		default:
			return null;
	}
}

export function selectedMediaClips(world: World): Entity[] {
	return [...world.query(Selected, NODES)].filter((entity) => clipMediaKind(world, entity) !== null);
}

export function clipMediaKind(world: World, clip: Entity): MediaKind | null {
	if (isCaption(clip)) return null;
	return mediaKind(findGeometryAsset(world, clip));
}

const SOURCE_PROPS = ['cropX', 'cropY', 'cropWidth', 'cropHeight', 'frameRate', 'syncTo'] as const;

const PAINT_TAG = { VIDEO: 'videoPaint', SEQUENCE: 'videoPaint', IMAGE: 'imagePaint' } as const;

/** A clip only takes media of its own kind (sound for sound, picture or video for either); the rest are left alone. */
export function replaceClipMedia(world: World, clips: Entity[], asset: Asset): number {
	let replaced = 0;
	for (const clip of clips) {
		if (clip.isAlive() && replaceOne(world, clip, asset)) replaced++;
	}
	return replaced;
}

export function replaceClipMediaAndReport(world: World, clips: Entity[], asset: Asset): void {
	const replaced = replaceClipMedia(world, clips, asset);
	const kept = clips.length - replaced;
	if (kept === 0) return;
	toast(t('{count, plural, one {# clip kept its media} other {# clips kept their media}}', { count: kept }), {
		description: t('A sound is replaced by a sound, a picture or video by a picture or video.'),
	});
}

function replaceOne(world: World, clip: Entity, asset: Asset): boolean {
	const kind = mediaKind(asset);
	const before = findGeometryAsset(world, clip);
	let source = findGeometryAssetSource(world, clip);
	if (!kind || !before || !source || clipMediaKind(world, clip) !== kind) return false;
	if (before.id === asset.id) return true;

	const editor = getDocumentEditor(world);
	const computed = clip.get(Computed);
	const start = computed?.start ?? 0;
	const length = Math.max(1, (computed?.end ?? 0) - start);

	// A video and a picture are drawn by different paints, so swapping one for the
	// other swaps the paint. A clip that is its own media (a `<video>`) keeps its kind.
	const paint = asset.type === 'AUDIO' ? null : PAINT_TAG[asset.type as keyof typeof PAINT_TAG];
	const tree = authoredTree(world, source);
	if (paint && tree && tree.tag !== paint) {
		if (source === clip) return false;
		const props: Record<string, unknown> = { ...tree.props, src: asset.path };
		for (const name of [...SOURCE_PROPS, 'volume', 'muted']) delete props[name];
		const [next] = editor.insertElement(clip, () => renderAuthored({ ...tree, tag: paint, props }), source);
		if (!next) return false;
		editor.remove(source);
		source = next;
	} else {
		editor.editProperty(source, 'src', asset.path);
		for (const name of SOURCE_PROPS) {
			if (tree?.props[name] !== undefined) editor.editProperty(source, name, false);
		}
	}

	if (authoredTime(world, clip, 'sourceIn') !== undefined) editTime(world, clip, 'sourceIn', null);
	if (authoredTime(world, clip, 'sourceOut') !== undefined) editTime(world, clip, 'sourceOut', null);
	const seconds = getSourceDuration(source, asset);
	const fps = world.get(FrameRate)?.value ?? 30;
	const rate = computed?.playbackRate || 1;
	const fits = seconds === null ? length : Math.max(1, Math.floor((seconds * fps) / rate));
	editTime(world, clip, 'end', start - getTimelineOrigin(clip) + Math.min(length, fits));

	renameAfter(world, clip, before, asset);
	return true;
}

/** A clip still named after its old file ("beach", "beach 2") takes the new name; one the user named keeps its own. */
function renameAfter(world: World, clip: Entity, before: Asset, after: Asset): void {
	const name = clip.get(Name)?.value ?? '';
	const old = baseName(before);
	if (name !== old && !new RegExp(`^${escapeRegExp(old)} \\d+$`).test(name)) return;
	getDocumentEditor(world).editProperty(clip, 'name', getNextName(world, baseName(after)));
}

const baseName = (asset: Asset): string => assetName(asset).replace(/\.[^.]+$/, '');

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
