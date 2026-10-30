/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Swapping what a clip plays for another file while the clip stays where it
 * is: the same place on the timeline, the same box on the canvas, the same
 * effects and keyframes. Only the media changes — and with it whatever only
 * meant something for the old file (its crop, its source window, a sync to
 * another clip's sound).
 *
 * A clip keeps its length where the new file has enough to fill it, and ends
 * early where it does not. Everything goes through the editor, so one replace
 * of several clips is one undo step.
 */

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

/** What a clip shows or plays, as far as replacing it goes. */
export type MediaKind = 'picture' | 'sound';

/** The kind of media `asset` is, or null for one a clip cannot play (a transcript). */
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

/** The selected clips that play a file, which are the ones a replace can reach. */
export function selectedMediaClips(world: World): Entity[] {
	return [...world.query(Selected, NODES)].filter((entity) => clipMediaKind(world, entity) !== null);
}

/** What `clip` plays, or null when it plays no file (text, a shape, captions, a group). */
export function clipMediaKind(world: World, clip: Entity): MediaKind | null {
	if (isCaption(clip)) return null;
	return mediaKind(findGeometryAsset(world, clip));
}

/** The props of a media element that only describe the file it played. */
const SOURCE_PROPS = ['cropX', 'cropY', 'cropWidth', 'cropHeight', 'frameRate', 'syncTo'] as const;

/** The paint element each kind of picture is drawn with. */
const PAINT_TAG = { VIDEO: 'videoPaint', SEQUENCE: 'videoPaint', IMAGE: 'imagePaint' } as const;

/**
 * Points every clip in `clips` at `asset`. A clip only takes media of its own
 * kind — a sound for a sound, a picture or a video for a picture or a video —
 * and the rest are left as they were. Returns how many now play `asset`.
 */
export function replaceClipMedia(world: World, clips: Entity[], asset: Asset): number {
	let replaced = 0;
	for (const clip of clips) {
		if (clip.isAlive() && replaceOne(world, clip, asset)) replaced++;
	}
	return replaced;
}

/**
 * `replaceClipMedia`, telling the user about the clips that could not take
 * `asset`; the ones that did show the change themselves.
 */
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
	// Already playing it: nothing to change, and nothing to complain about.
	if (before.id === asset.id) return true;

	const editor = getDocumentEditor(world);
	const computed = clip.get(Computed);
	const start = computed?.start ?? 0;
	const length = Math.max(1, (computed?.end ?? 0) - start);

	// A video and a picture are drawn by different paints, so swapping one for
	// the other swaps the paint. A clip that is its own media (a `<video>`) has
	// no paint to swap and keeps its kind.
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

	// The new file plays from its beginning, for as long as the clip lasted
	// or the file does, whichever is shorter.
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

/**
 * A clip still called after the file it played ("beach", "beach 2") takes
 * the new file's name; one the user named keeps its own.
 */
function renameAfter(world: World, clip: Entity, before: Asset, after: Asset): void {
	const name = clip.get(Name)?.value ?? '';
	const old = baseName(before);
	if (name !== old && !new RegExp(`^${escapeRegExp(old)} \\d+$`).test(name)) return;
	getDocumentEditor(world).editProperty(clip, 'name', getNextName(world, baseName(after)));
}

const baseName = (asset: Asset): string => assetName(asset).replace(/\.[^.]+$/, '');

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
