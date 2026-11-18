/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Animation, ColorStop, LinearGradientPaint, Shadow, Stroke, Text } from '@plan.video/reconciler';
import { Computed, getActiveEntity, getNextName, isScene, loadWebFont, store, TEXT_LOOKS } from '@plan.video/runtime';

import { msg, t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';

import type { AnimationType } from '@plan.video/jsx';
import type { Entity, World } from 'koota';
import type { TextLook, TextLookId, WebFonts } from '@plan.video/runtime';

const SECONDS = 4;

const WHITE = '#FFFFFF';

/** What a tile draws: a look and the words it shows. */
export type LookSample = TextLook & { name: string; sample: string };

/** A look captions can wear. */
export type TextStyle = LookSample & { id: TextLookId };

/** The caption looks, in the order the pickers show them, two to a row. */
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

/** Seconds. An in plays once from the text's start; a loop repeats until its end. */
export type StyleMotion = { type: AnimationType; duration: number };

export type MovingTextStyle = LookSample & { id: string; in?: StyleMotion; loop?: StyleMotion };

const glow = (color: string, wide = 0.6, tight = 0.18, opacity = 1): NonNullable<TextLook['shadows']> => [
	{ color, blur: wide, opacity },
	{ color, blur: tight, opacity },
];
const SOFT_SHADOW = { color: '#000000', blur: 0.22, y: 0.04, opacity: 0.6 };

type StyleDraft = Omit<MovingTextStyle, 'sample'>;

/** The Text tab, two to a row. Each tile shows the style's own name, which is also the text it adds. */
export const MOVING_TEXT_STYLES: MovingTextStyle[] = ([
	{
		id: 'synthwave', name: msg('Synthwave'), font: 'Lilita One', weight: 400, size: 1.05,
		fill: { from: '#C7EDFF', to: '#2B4FD8' },
		strokes: [{ color: '#0B1446', width: 0.14 }],
		shadows: [{ color: '#4FC3FF', blur: 0.5, opacity: 0.7 }],
		in: { type: 'slideUp', duration: 0.6 }, loop: { type: 'float', duration: 2.4 },
	},
	{
		id: 'slow-morning', name: msg('Slow morning'), font: 'Bebas Neue', weight: 400, size: 1.25, textCase: 'upper', letterSpacing: 0.03,
		fill: '#FFF6E8',
		shadows: [SOFT_SHADOW],
		in: { type: 'fade', duration: 1.2 },
	},
	{
		id: 'letterpress', name: msg('Letterpress'), font: 'Rubik Mono One', weight: 400, size: 0.75, textCase: 'upper',
		fill: WHITE,
		strokes: [{ color: '#000000', width: 0.18 }],
		in: { type: 'pop', duration: 0.25 },
	},
	{
		id: 'doodle', name: msg('Doodle'), font: 'Titan One', weight: 400, size: 1,
		fill: '#9A6BFF',
		strokes: [{ color: '#3E8BFF', width: 0.16 }],
		loop: { type: 'wiggle', duration: 1.2 },
	},
	{
		id: 'scorcher', name: msg('Scorcher'), font: 'Luckiest Guy', weight: 400, size: 1,
		fill: { from: '#FFE45C', to: '#FF5A00' },
		strokes: [{ color: '#8A1C00', width: 0.1 }],
		shadows: [{ color: '#FF6A00', blur: 0.5, opacity: 0.8 }],
		loop: { type: 'shake', duration: 1 },
	},
	{
		id: 'goo', name: msg('Goo'), font: 'Luckiest Guy', weight: 400, size: 1.1, italic: true, textCase: 'upper',
		fill: { from: '#E9FF6B', to: '#36D62B' },
		strokes: [{ color: '#0A3A0E', width: 0.16 }],
		in: { type: 'bounce', duration: 0.3 }, loop: { type: 'pulse', duration: 1.4 },
	},
	{
		id: 'splash', name: msg('Splash'), font: 'Fredoka', weight: 700, size: 1.05, textCase: 'upper',
		fill: '#5CF6FF',
		shadows: glow('#00C8FF', 0.6, 0.16, 0.9),
		loop: { type: 'float', duration: 2 },
	},
	{
		id: 'bronze', name: msg('Bronze'), font: 'Playfair Display', weight: 900, size: 1,
		fill: { from: '#F5C79A', to: '#8A4B1E' },
		strokes: [{ color: '#2A1407', width: 0.05 }],
		shadows: [SOFT_SHADOW],
		in: { type: 'grow', duration: 0.8 },
	},
	{
		id: 'rough-draft', name: msg('Rough draft'), font: 'Rubik', weight: 900, size: 0.95, textCase: 'upper',
		fill: '#F2C6FF',
		strokes: [{ color: '#B24BFF', width: 0.12 }],
		shadows: [{ color: '#C05CFF', blur: 0.5, opacity: 0.6 }],
		in: { type: 'appearChar', duration: 0.8 },
	},
	{
		id: 'stardust', name: msg('Stardust'), font: 'Playfair Display', weight: 500, size: 1.05, italic: true,
		fill: WHITE,
		shadows: glow('#FFFFFF', 0.5, 0.12, 0.7),
		loop: { type: 'breathe', duration: 2.4 },
	},
	{
		id: 'puffy', name: msg('Puffy'), font: 'Fredoka', weight: 500, size: 1.15,
		fill: '#3A3E46',
		strokes: [{ color: '#C9CED8', width: 0.1 }],
		in: { type: 'pop', duration: 0.25 }, loop: { type: 'float', duration: 2.8 },
	},
	{
		id: 'memo', name: msg('Memo'), font: 'Source Code Pro', weight: 600, size: 0.8, letterSpacing: 0.04,
		fill: WHITE,
		shadows: [SOFT_SHADOW],
		in: { type: 'appearChar', duration: 1 },
	},
	{
		id: 'invitation', name: msg('Invitation'), font: 'Great Vibes', weight: 400, size: 1.45,
		fill: WHITE,
		shadows: [SOFT_SHADOW],
		in: { type: 'blur', duration: 0.8 },
	},
	{
		id: 'scholar', name: msg('Scholar'), font: 'Playfair Display', weight: 700, size: 1.05,
		fill: '#3E7BFF',
		strokes: [{ color: WHITE, width: 0.12 }],
		in: { type: 'slideUp', duration: 0.6 },
	},
	{
		id: 'loud', name: msg('Loud'), font: 'Rubik Mono One', weight: 400, size: 0.8, textCase: 'upper',
		fill: { from: '#FF3DE0', to: '#5B2BFF' },
		strokes: [{ color: '#14002E', width: 0.12 }],
		loop: { type: 'shake', duration: 0.8 },
	},
	{
		id: 'fizz', name: msg('Fizz'), font: 'Fredoka', weight: 700, size: 1.1,
		fill: '#8CFF3A',
		strokes: [{ color: '#0D4F10', width: 0.14 }],
		loop: { type: 'pulse', duration: 0.8 },
	},
	{
		id: 'royal', name: msg('Royal'), font: 'Great Vibes', weight: 400, size: 1.45,
		fill: '#FFF4FB',
		shadows: glow('#F3B6FF', 0.6, 0.15),
		loop: { type: 'float', duration: 3 },
	},
	{
		id: 'heartbeat', name: msg('Heartbeat'), font: 'Sacramento', weight: 400, size: 1.7,
		fill: WHITE,
		shadows: glow('#FFFFFF', 0.5, 0.12, 0.8),
		loop: { type: 'pulse', duration: 1 },
	},
	{
		id: 'roller', name: msg('Roller'), font: 'Lilita One', weight: 400, size: 1.1,
		fill: { from: '#FFF3DC', to: '#FF9A5C' },
		shadows: [{ color: '#FF7A3D', blur: 0.5, opacity: 0.7 }],
		in: { type: 'bounce', duration: 0.3 }, loop: { type: 'wiggle', duration: 2 },
	},
	{
		id: 'fuzzy', name: msg('Fuzzy'), font: 'Bebas Neue', weight: 400, size: 1.35,
		fill: WHITE,
		shadows: glow('#FFFFFF', 0.8, 0.25, 0.85),
		loop: { type: 'breathe', duration: 1.8 },
	},
	{
		id: 'cupid', name: msg('Cupid'), font: 'Great Vibes', weight: 400, size: 1.5,
		fill: '#FF8CC4',
		shadows: glow('#FF4FA0', 0.6, 0.18),
		loop: { type: 'pulse', duration: 1 },
	},
	{
		id: 'bloom', name: msg('Bloom'), font: 'Fredoka', weight: 700, size: 1.1,
		fill: '#FF5AD9',
		strokes: [{ color: '#6A0B52', width: 0.1 }],
		shadows: [{ color: '#FF5AD9', blur: 0.4, opacity: 0.5 }],
		loop: { type: 'wiggle', duration: 1.6 },
	},
	{
		id: 'after-hours', name: msg('After hours'), font: 'Bebas Neue', weight: 400, size: 1.25, textCase: 'upper', letterSpacing: 0.02,
		fill: '#FFE3F1',
		strokes: [{ color: '#FF2E93', width: 0.04 }],
		shadows: glow('#FF2E93'),
		loop: { type: 'flicker', duration: 2 },
	},
	{
		id: 'blue-note', name: msg('Blue note'), font: 'Titan One', weight: 400, size: 1,
		fill: '#2F5BFF',
		strokes: [{ color: '#0A1A66', width: 0.08 }],
		shadows: [{ color: '#2F5BFF', blur: 0.5, opacity: 0.6 }],
		loop: { type: 'float', duration: 2.2 },
	},
	{
		id: 'bubble', name: msg('Bubble'), font: 'Fredoka', weight: 700, size: 1.1,
		fill: '#A88BFF',
		strokes: [{ color: '#EEE6FF', width: 0.12 }],
		loop: { type: 'float', duration: 1.6 },
	},
	{
		id: 'serious', name: msg('Serious'), font: 'Anton', weight: 400, size: 1.15, textCase: 'upper', letterSpacing: 0.01,
		fill: WHITE,
		strokes: [{ color: '#000000', width: 0.18 }],
		in: { type: 'pop', duration: 0.25 },
	},
	{
		id: 'squish', name: msg('Squish'), font: 'Titan One', weight: 400, size: 1, textCase: 'upper',
		fill: '#46D65E',
		strokes: [{ color: '#0B4A1A', width: 0.16 }],
		in: { type: 'bounce', duration: 0.3 }, loop: { type: 'pulse', duration: 0.9 },
	},
	{
		id: 'metal', name: msg('Metal'), font: 'Rubik Mono One', weight: 400, size: 0.8, textCase: 'upper',
		fill: { from: '#FFFFFF', to: '#7B8494' },
		strokes: [{ color: '#1C2230', width: 0.1 }],
		shadows: [SOFT_SHADOW],
		loop: { type: 'shake', duration: 1.2 },
	},
	{
		id: 'static', name: msg('Static'), font: 'Source Code Pro', weight: 700, size: 0.95, textCase: 'upper',
		fill: '#D6EEFF',
		shadows: glow('#3FA9FF'),
		loop: { type: 'flicker', duration: 1.5 },
	},
	{
		id: 'dance-floor', name: msg('Dance floor'), font: 'Sacramento', weight: 400, size: 1.8,
		fill: { from: '#FF3B3B', to: '#FFB020' },
		shadows: [{ color: '#FF3B3B', blur: 0.4, opacity: 0.5 }],
		loop: { type: 'wiggle', duration: 1 },
	},
	{
		id: 'spooky', name: msg('Spooky'), font: 'Luckiest Guy', weight: 400, size: 1.05, textCase: 'upper',
		fill: { from: '#FFC93D', to: '#FF6A00' },
		shadows: glow('#FF6A00', 0.6, 0.18, 0.9),
		loop: { type: 'shake', duration: 0.5 },
	},
	{
		id: 'headline', name: msg('Headline'), font: 'Bangers', weight: 400, size: 1.25, textCase: 'upper', letterSpacing: 0.03,
		fill: '#FFE14D',
		strokes: [{ color: '#000000', width: 0.14 }],
		shadows: [SOFT_SHADOW],
		in: { type: 'pop', duration: 0.25 },
	},
] satisfies StyleDraft[]).map((style) => ({ ...style, sample: style.name }));

/** Pixels per em of a style at size 1, on a frame whose short side is 1080. */
const EM = 112;

type Font = { family: keyof typeof WebFonts; weight: number; italic?: boolean; size: number; letterSpacing?: number };

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** Measured once the font has loaded, the way the renderer lays out a line. */
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

export function textStyleWords(style: TextLook, text: string): string {
	if (style.textCase === 'upper') return text.toUpperCase();
	if (style.textCase === 'lower') return text.toLocaleLowerCase();
	return text;
}

const r = (value: number) => Math.round(value);

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

export async function addTextStyle(world: World, style: MovingTextStyle): Promise<Entity | null> {
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
			{style.in ? <Animation type={style.in.type} duration={style.in.duration} /> : null}
			{style.loop ? <Animation type={style.loop.type} phase="loop" duration={style.loop.duration} /> : null}
		</Text>
	));
	if (entity) editor.select(entity);
	return entity ?? null;
}
