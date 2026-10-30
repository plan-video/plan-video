/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	AssetId,
	findGeometryAsset,
	hasHtmlPaint,
	hasSurfacePaint,
	isAdjustmentLayer,
	isCaption,
	isGroup,
	isMask,
	isRect,
	isScene,
	isSequence,
	isText,
} from '@plan.video/runtime';

import { t } from '@/lib/i18n';

import type { TimelineColors } from './constants';

import type { Asset } from '@plan.video/assets';
import type { Entity, World } from 'koota';

export type ClipStyle = {
	background: string;
	foreground: string;
	border?: string;
	primary?: string;
};

export function getClipStyle(colors: TimelineColors, entity: Entity, asset: Asset | null, errored = false): ClipStyle {
	if (errored && !entity.has(AssetId)) return colors.clip.failed;
	if (isCaption(entity)) return colors.clip.caption;
	if (isText(entity)) return colors.clip.text;
	if (isScene(entity)) return colors.clip.scene;
	if (isGroup(entity)) return colors.clip.group;
	if (isMask(entity)) return colors.clip.mask;
	if (isAdjustmentLayer(entity)) return colors.clip.adjustment;
	if (hasHtmlPaint(entity) || hasSurfacePaint(entity)) return colors.clip.html;

	switch (asset?.type) {
		case 'VIDEO':
		case 'SEQUENCE':
			return colors.clip.video;
		case 'IMAGE':
			return colors.clip.image;
		case 'AUDIO':
			return colors.clip.audio;
		default:
			return colors.clip.shape;
	}
}

/** Display-only, never written back. Follows `getClipStyle`'s cascade so the word and the colour agree. */
export function getClipFallbackName(world: World, entity: Entity): string {
	if (isCaption(entity)) return t('Captions');
	if (isText(entity)) return t('Text');
	if (isScene(entity)) return t('Scene');
	if (isSequence(entity)) return t('Sequence');
	if (isGroup(entity)) return t({ message: 'Group', context: 'noun' });
	if (isMask(entity)) return t('Mask');
	if (isAdjustmentLayer(entity)) return t('Adjustment');
	if (hasHtmlPaint(entity)) return 'HTML';
	if (hasSurfacePaint(entity)) return t('Surface');

	switch (getClipAsset(world, entity)?.type) {
		case 'VIDEO':
		case 'SEQUENCE':
			return t('Video');
		case 'IMAGE':
			return t('Image');
		case 'AUDIO':
			return t('Audio');
	}

	return isRect(entity) ? t('Rectangle') : t('Layer');
}

export function getClipAsset(world: World, entity: Entity): Asset | null {
	return findGeometryAsset(world, entity);
}
