/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Animation, ImagePaint, Rect } from '@plan.video/reconciler';
import { Computed, getActiveEntity, getNextName, isScene, Library, Source, store } from '@plan.video/runtime';

import { t } from '@/lib/i18n';
import { chatFileName, renderChatMessage, type ChatBackground, type ChatMessage, type ChatPlatform } from '@/lib/live-chat';

import { importFiles } from './asset-actions';
import { getDocumentEditor } from './editor';
import { stackColumn, type KillfeedAnimation } from './killfeed';
import { CHAT_FOLDER, killfeedUnit, PICTURE_SCALE } from './killfeed-picture';

import type { Entity, World } from 'koota';

/** How many times its size in the app a message is placed at, in a 1080-wide frame. */
const CHAT_SIZE = 3;
const CHAT_SECONDS = 5;
const SPACING = 1;
const GAP = 8;
const MARGIN = 40;
/** How far down the frame a message comes in when it isn't dropped somewhere. */
const DROP_LINE = 0.62;

export const CHAT_NAMES: Record<ChatPlatform, string> = { twitch: 'Twitch chat', tiktok: 'TikTok chat' };

export interface ChatStyle {
	background: ChatBackground;
	animation: KillfeedAnimation;
}

export const DEFAULT_CHAT_STYLE: ChatStyle = { background: 'bubble', animation: 'slide' };

export interface ChatDrag {
	platform: ChatPlatform;
	messages: ChatMessage[];
	style: ChatStyle;
}

export function parseChatDrag(raw: string): ChatDrag {
	const data = JSON.parse(raw) as Partial<ChatDrag>;
	return {
		platform: data.platform === 'tiktok' ? 'tiktok' : 'twitch',
		messages: Array.isArray(data.messages) ? data.messages : [],
		style: { ...DEFAULT_CHAT_STYLE, ...data.style },
	};
}

type Box = { left: number; right: number; top: number; bottom: number };

/** Messages come in a second apart from the playhead, one under the other, in one undo step. */
export async function insertChatMessages(
	world: World,
	platform: ChatPlatform,
	messages: ChatMessage[],
	style: ChatStyle,
	options: { parent?: Entity; center?: { x: number; y: number } } = {},
): Promise<Entity[]> {
	const parent = options.parent ?? getActiveEntity(world);
	const library = world.get(Library);
	if (!parent || !isScene(parent) || !parent.get(Source)?.value || !library || !messages.length) return [];

	const drawn = await Promise.all(messages.map((message) => renderChatMessage(platform, message, style.background, PICTURE_SCALE * CHAT_SIZE)));
	const assets = [];
	// One at a time: two of the same name share a file name.
	for (const [index, picture] of drawn.entries()) {
		const blob = await new Promise<Blob>((resolve, reject) => {
			picture.toBlob((png) => (png ? resolve(png) : reject(new Error(t('Could not draw the chat message')))), 'image/png');
		});
		const [asset] = await importFiles(library, [new File([blob], chatFileName(messages[index]!), { type: 'image/png' })], CHAT_FOLDER);
		if (!asset) return [];
		assets.push(asset);
	}

	const computed = store(world, Computed);
	const sceneWidth = computed.width[parent.id()] ?? 1080;
	const sceneHeight = computed.height[parent.id()] ?? 1920;
	const unit = killfeedUnit(sceneWidth, sceneHeight);
	const sizes = drawn.map((picture) => ({
		width: Math.round((picture.width * unit) / PICTURE_SCALE),
		height: Math.round((picture.height * unit) / PICTURE_SCALE),
	}));
	const widest = Math.max(...sizes.map((size) => size.width));
	const stackName = CHAT_NAMES[platform];
	const first = Math.max(0, computed.localTimeInSeconds[parent.id()] ?? 0);

	const editor = getDocumentEditor(world);
	const placed: { box: Box; start: number; end: number }[] = [];
	const entities: Entity[] = [];

	for (const [index, { width, height }] of sizes.entries()) {
		const start = first + index * SPACING;
		const end = start + CHAT_SECONDS;

		// Messages put in just now aren't on the scene's clock yet, so the ones still up join the column by hand.
		let stack: Box | null = options.center ? null : stackColumn(world, parent, start, stackName);
		for (const entry of placed) {
			if (start < entry.start || start >= entry.end) continue;
			stack = stack ? union(stack, entry.box) : entry.box;
		}

		let x: number;
		let y: number;
		if (stack) {
			x = stack.left;
			y = stack.bottom + GAP * unit;
		} else if (options.center) {
			x = options.center.x - widest / 2;
			y = options.center.y - height / 2;
		} else {
			x = (sceneWidth - widest) / 2;
			y = sceneHeight * DROP_LINE;
		}
		x = Math.round(Math.max(0, Math.min(x, sceneWidth - width)));
		y = Math.round(Math.max(0, Math.min(y, sceneHeight - MARGIN * unit - height)));

		const name = getNextName(world, stackName);
		const src = assets[index]!.path;
		const [entity] = editor.insertElement(parent, () => (
			<Rect name={name} keepAspectRatio x={x} y={y} width={width} height={height} start={round(start)} end={round(end)}>
				<ImagePaint src={src} objectFit="fill" />
				{style.animation === 'slide' && <Animation type="slideUp" duration={0.25} />}
				{style.animation === 'fade' && <Animation type="fade" duration={0.25} />}
				{style.animation !== 'none' && <Animation type="fade" phase="out" duration={0.3} />}
			</Rect>
		));
		if (!entity) break;
		entities.push(entity);
		placed.push({ box: { left: x, right: x + width, top: y, bottom: y + height }, start, end });
	}

	if (entities.length) editor.select(entities);
	return entities;
}

const union = (a: Box, b: Box): Box => ({
	left: Math.min(a.left, b.left),
	right: Math.max(a.right, b.right),
	top: Math.min(a.top, b.top),
	bottom: Math.max(a.bottom, b.bottom),
});

const round = (value: number) => Math.round(value * 1000) / 1000;
