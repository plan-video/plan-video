/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Text tab's text box and text styles. The box is white text in the
 * default face, the same the canvas's text tool puts in with a click. A style
 * is one text with a face, a fill (a colour or a gradient), outlines and
 * shadows, nothing else: every part of it is in the inspector afterwards, and
 * typing over it keeps the look. Both go on the active scene at the playhead,
 * centred on it.
 */

import { ColorStop, LinearGradientPaint, Shadow, Stroke, Text } from '@plan.video/reconciler';
import { Computed, getActiveEntity, getNextName, isScene, loadWebFont, store, TEXT_LOOKS } from '@plan.video/runtime';

import { msg, t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';
import type { TextLook, TextLookId, WebFonts } from '@plan.video/runtime';

/** How long a text stays on, from the playhead. */
const SECONDS = 4;

const WHITE = '#FFFFFF';

/**
 * A look from the runtime's TEXT_LOOKS as the Text tab offers it: what the
 * layer is called and the words it goes in with, ready to type over.
 */
export type TextStyle = TextLook & { id: TextLookId; name: string; sample: string };

/** In the order the tab shows them, two to a row. */
export const TEXT_STYLES: TextStyle[] = ([
	{ id: 'commentary', name: msg('Commentary'), sample: msg('Each time') },
	{ id: 'hook', name: msg('Hook'), sample: msg('The hook.') },
	{ id: 'punch', name: msg('Punch'), sample: msg('Watch this') },
	{ id: 'yellow', name: msg('Yellow'), sample: msg('No way') },
	{ id: 'glow', name: msg('Glow'), sample: msg('Shine') },
	{ id: 'neon', name: msg('Neon'), sample: msg('Let it bloom.') },
	{ id: 'cinema', name: msg('Cinema'), sample: msg('Chapter one') },
	{ id: 'teal', name: msg('Teal'), sample: msg('Here we go') },
	{ id: 'fire', name: msg('Fire'), sample: msg('On fire') },
	{ id: 'alert', name: msg('Alert'), sample: msg('Breaking') },
	{ id: 'sticker', name: msg('Sticker'), sample: msg('Sing it back') },
	{ id: 'slime', name: msg('Slime'), sample: msg('The secret') },
	{ id: 'bubblegum', name: msg('Bubblegum'), sample: msg('the good part.') },
	{ id: 'magenta', name: msg('Magenta'), sample: msg('Vibes') },
	{ id: 'lime', name: msg('Lime'), sample: msg('Fresh') },
	{ id: 'chrome', name: msg('Chrome'), sample: msg('Main event') },
	{ id: 'gold', name: msg('Gold'), sample: msg('Level up') },
	{ id: 'retro', name: msg('Retro'), sample: msg('Cute chaos.') },
	{ id: 'comic', name: msg('Comic'), sample: msg('Boom!') },
	{ id: 'cute', name: msg('Cute'), sample: msg('So cute') },
	{ id: 'plain', name: msg('Plain'), sample: msg('The spotlight finds you.') },
	{ id: 'soft', name: msg('Soft'), sample: msg('stack ’em up.') },
	{ id: 'handwritten', name: msg('Handwritten'), sample: msg('Wait for it') },
	{ id: 'ink', name: msg('Ink'), sample: msg('Plot twist') },
] satisfies { id: TextLookId; name: string; sample: string }[]).map((style) => ({ ...TEXT_LOOKS[style.id], ...style }));

/** Pixels per em of a style at size 1, on a frame whose short side is 1080. */
const EM = 112;

type Font = { family: keyof typeof WebFonts; weight: number; italic?: boolean; size: number; letterSpacing?: number };

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** How wide and tall `text` is drawn in `font`, once the font has loaded, the way the renderer lays out a line. */
function measure(text: string, font: Font): { width: number; height: number } {
	if (!measureCtx) {
		measureCtx = typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(1, 1).getContext('2d')
			: document.createElement('canvas').getContext('2d');
	}
	if (!measureCtx) return { width: text.length * font.size * 0.6, height: font.size * 1.2 };
	measureCtx.font = `${font.italic ? 'italic ' : ''}${font.weight} ${font.size}px "${font.family}"`;
	measureCtx.letterSpacing = `${font.letterSpacing ?? 0}px`;
	const metrics = measureCtx.measureText(text);
	return { width: metrics.width, height: metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent };
}

/** The words as the style draws them, cased. */
export function textStyleWords(style: TextStyle, text: string): string {
	if (style.textCase === 'upper') return text.toUpperCase();
	if (style.textCase === 'lower') return text.toLocaleLowerCase();
	return text;
}

const r = (value: number) => Math.round(value);

/** The scene at the playhead, its size and where the playhead is in it, or null when there is none. */
function target(world: World) {
	const scene = getActiveEntity(world);
	if (!scene || !isScene(scene)) return null;

	const computed = store(world, Computed);
	const width = r(computed.width[scene.id()] || 1920);
	const height = r(computed.height[scene.id()] || 1080);
	const start = Math.round((computed.localTimeInSeconds[scene.id()] ?? 0) * 1000) / 1000;
	const end = Math.round((start + SECONDS) * 1000) / 1000;
	return { scene, width, height, start, end };
}

/**
 * Puts a text box on the active scene at the playhead and selects it. Null
 * when there is no scene to put it on.
 */
export async function addTextBox(world: World): Promise<Entity | null> {
	const at = target(world);
	if (!at) return null;

	// Measured in the face the scene draws with, so the box fits its words.
	await loadWebFont(world, 'Inter').catch(() => {});

	// The text tool's size, a 22.5th of the scene's height, centred on it.
	const font: Font = { family: 'Inter', weight: 400, size: Math.max(8, r(at.height / 22.5)) };
	const label = t('Text');
	const name = getNextName(world, t('Text'));
	const editor = getDocumentEditor(world);
	const [entity] = editor.insertElement(at.scene, () => (
		<Text
			name={name}
			x={r((at.width - measure(label, font).width) / 2)}
			y={r((at.height - font.size * 1.2) / 2)}
			start={at.start}
			end={at.end}
			fontSize={font.size}
			color={WHITE}
		>
			{label}
		</Text>
	));
	if (entity) editor.select(entity);
	return entity ?? null;
}

/**
 * Puts a text in `style` on the active scene at the playhead, centred, and
 * selects it. Null when there is no scene to put it on.
 */
export async function addTextStyle(world: World, style: TextStyle): Promise<Entity | null> {
	const at = target(world);
	if (!at) return null;

	await loadWebFont(world, style.font).catch(() => {});

	const size = Math.max(8, r((Math.min(at.width, at.height) / 1080) * EM * style.size));
	const em = (value: number) => Math.round(value * size * 100) / 100;
	const font: Font = { family: style.font, weight: style.weight, italic: style.italic, size, letterSpacing: em(style.letterSpacing ?? 0) };
	const label = t(style.sample);
	const box = measure(textStyleWords(style, label), font);
	const name = getNextName(world, t(style.name));
	const fill = style.fill;

	const editor = getDocumentEditor(world);
	const [entity] = editor.insertElement(at.scene, () => (
		<Text
			name={name}
			x={r((at.width - box.width) / 2)}
			y={r((at.height - box.height) / 2)}
			start={at.start}
			end={at.end}
			fontFamily={style.font}
			fontWeight={style.weight}
			fontStyle={style.italic ? 'italic' : undefined}
			fontSize={size}
			letterSpacing={style.letterSpacing ? font.letterSpacing : undefined}
			textCase={style.textCase}
			color={typeof fill === 'string' ? fill : fill.from}
		>
			{label}
			{typeof fill === 'string' ? null : (
				<LinearGradientPaint rotation={90}>
					<ColorStop offset={0} color={fill.from} />
					<ColorStop offset={1} color={fill.to} />
				</LinearGradientPaint>
			)}
			{(style.strokes ?? []).map((stroke) => (
				<Stroke color={stroke.color} width={em(stroke.width)} join="round" />
			))}
			{(style.shadows ?? []).map((shadow) => (
				<Shadow
					color={shadow.color}
					opacity={shadow.opacity ?? 1}
					blur={em(shadow.blur)}
					offsetX={shadow.x ? em(shadow.x) : undefined}
					offsetY={shadow.y ? em(shadow.y) : undefined}
				/>
			))}
		</Text>
	));
	if (entity) editor.select(entity);
	return entity ?? null;
}
