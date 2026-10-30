/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { GeometryType, PaintType, CaptionType, CaptionAlign } from '../constants';

import type { AssetRef } from '@plan.video/jsx';

// Geometric primitive: RECT or TEXT (see GeometryType). Other node-like roles
// (group, audio, scene, caption) are layered on top via tag traits.
export const Geometry = trait({ value: GeometryType.RECT as GeometryType });

export const Paint = trait({ value: PaintType.SOLID as PaintType });

/** Groups have no Size of their own: Computed.width/height come from their children's local AABB. */
export const Group = trait();

// Tag marking a geometry as a scene: a clipped, playable frame. Scenes have a
// fixed Size like any frame; the tag layers playback + clipping on top.
// Scenes are NOT Groups.
export const Scene = trait();

export const Audio = trait();

export const AdjustmentLayer = trait();

// Tag marking an entity as a mask. Masks are ChildOf their target;
// Cache.masks on the target is derived from IsMask + ChildOf queries.
export const IsMask = trait();

// Tag for shadow sub-entities (distinguishes them from other Effect
// sub-entities in ChildOf queries).
export const Shadow = trait();

// Tag for stroke sub-entities: the entity is the stroke's paint (Paint/Color/
// Opacity/BlendMode like a fill; a missing Paint reads as solid) and carries
// its own StrokeStyle.
export const Stroke = trait();

export const Hidden = trait();

export const ClipsContent = trait();

export const Generating = trait();

export const Name = trait({ value: '' });

export const Key = trait({ value: '' });

/** `<file>:<key or position>` (see SOURCE_ATTR). Deliberately not serialized: a copy of an entity is not the element it was copied from. */
export const Source = trait({ value: '' });

/** Iterations share one Source, so this tells the editor an element can't be written alone. Not serialized, for the same reason as Source. */
export const Loop = trait({ value: '' });

export const AssetId = trait({ value: '' });

// The requests below are left by the document for the asset system, which stamps AssetId when the
// asset lands. Never serialized: re-derived from the src on any re-render.

// The `generate.*` declaration a src names, to run through the world's Ai.
export const GenerationRequest = trait(() => ({ ref: null as AssetRef | null }));

// A source outside the library — a path or URL — to load into memory
// through the library.
export const LoadRequest = trait({ value: '' });

/** On a `<captions>` without a src. The transcript is cached by scene id + seed; bumping the seed transcribes again. */
export const TranscriptionRequest = trait({ seed: 0 });

/** Asset system waits for both assets, cross-correlates the recordings and derives Delay/Trim. Counts as a pending source, so a transcription waits for the clip's placement. */
export const SyncRequest = trait({ value: '' });

// The syncTo measurement inflight, kept while the asset system correlates, so
// a result that arrives after the element was pointed at another target (or
// none) is dropped. The document clears it whenever a new syncTo arrives.
export const PendingSync = trait(() => ({ value: undefined as unknown }));

// The src whose resolution is inflight, kept while the asset system works,
// so a resolution that arrives after the element was given another source
// (or none) is dropped. The document clears it whenever a new src arrives.
export const PendingSource = trait(() => ({ value: undefined as unknown }));

/** Session state, never written back to the source; a failed generation also stands in the library as a partial. `generated` tells a failed generation from a failed load. */
export const SourceError = trait({ value: '', generated: false });

// Sibling order under a ChildOf parent.
export const ItemIndex = trait({ value: 0 });

// On a mount's root entity: the compiled module (a SCRIPT asset) that a world
// re-executes to rebuild this mount's reactive graph and runtime hosts.
export const MountScript = trait({ mountId: '', scriptAssetId: '' });

// On every entity a mount materializes: its stable structural key (an index
// path from the mount root), so a re-run in adopt mode can bind to the
// existing entity instead of minting a new one.
export const MountPath = trait({ mountId: '', path: '' });

/** Only on CAPTION nodes; the transcript is a TRANSCRIPT asset or embedded in an AUDIO/VIDEO one, via AssetId. */
export const Caption = trait({
	type: CaptionType.CLASSIC as CaptionType,
	colors: () => [] as number[],
	verticalAlign: undefined as CaptionAlign | undefined, // unset = the preset's default
	// How the words are paced; unset = the preset's own (see CaptionPacing).
	words: undefined as number | undefined, // most words on screen at once
	chars: undefined as number | undefined, // most characters on screen at once, spaces not counted
	linger: undefined as number | undefined, // seconds words stay after the last is said
	look: undefined as string | undefined, // a TEXT_LOOKS id worn over the preset; unset = the preset's own
});
