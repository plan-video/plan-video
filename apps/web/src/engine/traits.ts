/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Editor state only: none of it belongs in `@plan.video/runtime` (a headless world has
// no pointer), and none of it is authored, so it never reaches the source.

import { trait } from 'koota';

import type { CanvasPointerEvent, Point } from '@plan.video/runtime';
import type { ProjectConfig as ProjectConfigStore } from './project-config';

export type PointerPhase = 'pressed' | 'lifted';

/**
 * In canvas device pixels. `over` (pointer on the stage) tells a key press whether it
 * could start a canvas gesture (see the space shortcut).
 */
export const Pointer = trait({
	phase: 'lifted' as PointerPhase,
	button: 0,
	clientX: 0,
	clientY: 0,
	dragStartX: 0,
	dragStartY: 0,
	over: false,
});

/**
 * Lowercased, 'mod' standing in for meta/control. Mutated in place; the frame loop empties
 * `pressed` and `lifted` after the systems run, so a key movement lasts exactly one frame.
 */
export const Keys = trait({
	held: () => new Set<string>(),
	pressed: () => new Set<string>(),
	lifted: () => new Set<string>(),
});

/**
 * Modifiers qualify a shortcut but never trigger one. Only their key-ups can be trusted:
 * macOS does not deliver the key-up of a key released while ⌘ is held.
 */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set(['mod', 'meta', 'control', 'shift', 'alt']);

export type SnapLine = { from: Point; to: Point };

/** Snap guides for the gesture in flight; the HUD draws and empties them. */
export const SnapLines = trait({ list: () => [] as SnapLine[] });

export type HudMode = 'idle' | 'moving' | 'marquee';

/** 'moving' hides the selection mask; 'marquee' turns the drag rectangle into a selection. */
export const Hud = trait({ mode: 'idle' as HudMode });

export type EditorThemeMode = 'dark' | 'light';

export const EditorTheme = trait({ mode: 'dark' as EditorThemeMode });

export const PointerEvents = trait({ queue: () => [] as CanvasPointerEvent[] });

/** By id. Editor state, not a document property; a click on empty canvas clears it. */
export const AssetSelection = trait({ id: null as string | null });

/** The handle only, attached while a project is open; the values are its own reactive state. */
export const ProjectConfig = trait(() => null as ProjectConfigStore | null);
