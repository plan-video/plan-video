/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Whatever hands out the asset's bytes: a real File on desktop, an OPFS
 *  file on the web, a fetched blob for a URL. */
export interface AssetFileHandle {
	getFile(): Promise<File>;
}

/** Directory of numbered frame files backing a SEQUENCE asset. Typed to the
 *  web FileSystemDirectoryHandle surface the decoders iterate. */
export interface AssetDirectoryHandle {
	entries(): AsyncIterableIterator<[string, { kind: string; getFile?: () => Promise<File> }]>;
}

/** Enum-valued fields hold the runtime's enum values. */
export type TranscriptWordText = {
	fontFamily?: string;
	fontWeight?: string;
	fontSize?: number;
	fontStyle?: number;
	letterSpacing?: number;
	textCase?: number;
	textBaseline?: number;
};

/**
 * One paint of a word, and what is under it (a gradient's stops), as the
 * runtime's entity records: plain data. `eid` 0 is the word, so the paint
 * itself is the record whose `ChildOf` is 0.
 */
export type TranscriptWordLayer = Record<string, unknown> & { eid: number; ChildOf?: number };

/** Left-out fields are the caption's. `color` is 0xRRGGBB; a paint list replaces the caption's (empty = none). Animations play when the word is spoken. */
export type TranscriptWordStyle = {
	text?: TranscriptWordText;
	color?: number;
	opacity?: number;
	blendMode?: number;
	hidden?: boolean;
	offsetX?: number;
	offsetY?: number;
	fills?: TranscriptWordLayer[];
	strokes?: TranscriptWordLayer[];
	shadows?: TranscriptWordLayer[];
	effects?: TranscriptWordLayer[];
	animations?: TranscriptWordLayer[];
};

export type TranscriptWord = { text: string; start: number; end: number; style?: TranscriptWordStyle };

export type WordGroup = TranscriptWord[];

export type Transcript = { text: string; words: TranscriptWord[] }[];

/** Size and mtime of a source when it was last hashed/probed; a mismatch
 *  means the bytes may have changed and the asset is re-examined. */
export interface AssetStat {
	size: number;
	mtime: number;
}

/** How a generated asset came to be: the content key of the fully-resolved
 *  `generate.*` spec (dedup across runs) and the backend generation id. */
export interface AssetGeneration {
	key: string;
	id?: string | null;
}

interface AssetBase {
	id: string;
	/** `folder/sub/name.ext`, `/`-separated, no leading slash; what JSX `src` names. Renaming or moving changes only this. */
	path: string;
	/**
	 * Where the bytes are: an absolute OS path (a linked file, left where the
	 * user had it), an `http(s)://` URL, or a project-relative path (`assets/…`,
	 * bytes the app itself produced: generations, downloads, transcodes).
	 */
	source: string;
	createdAt: string;
	mimeType: string;
	stat?: AssetStat;
	generation?: AssetGeneration;
	/**
	 * The line a post using this asset has to carry, from a library track
	 * whose license asks for credit.
	 */
	credit?: string;
	/**
	 * Resolved on the fly for a `src` that names a path or URL outside the
	 * library; lives in memory only and is never written to the manifest.
	 */
	transient?: boolean;
	handle: AssetFileHandle;
}

export interface ImageAsset extends AssetBase {
	type: 'IMAGE';
	width: number;
	height: number;
}

export interface AudioAsset extends AssetBase {
	type: 'AUDIO';
	duration: number;
	sampleRate: number;
	channels: number;
	transcript?: Transcript;
}

export interface VideoAsset extends AssetBase {
	type: 'VIDEO';
	duration: number;
	width: number;
	height: number;
	frameRate: number;
	bitRate: number;
	sampleRate?: number;
	channels?: number;
	transcript?: Transcript;
}

export interface TranscriptAsset extends AssetBase {
	type: 'TRANSCRIPT';
}

export interface ScriptAsset extends AssetBase {
	type: 'SCRIPT';
}

// `source` is the frames directory; `handle` points to the first frame's
// file so generic preview code works.
export interface SequenceAsset extends AssetBase {
	type: 'SEQUENCE';
	width: number;
	height: number;
	frameRate: number;
	duration: number;
	directoryHandle: AssetDirectoryHandle;
}

export type Asset =
	| ImageAsset
	| AudioAsset
	| VideoAsset
	| TranscriptAsset
	| ScriptAsset
	| SequenceAsset;

export type AssetType = Asset['type'];

export type PartialAssetState = 'pending' | 'error';

/**
 * Written `pending` when a run starts, replaced by the asset when it lands, kept as `error` when it
 * doesn't. The error record stops a refused generation being run (and paid for) again on every
 * reopen; removing it asks for the run again. Never bound to an entity.
 */
export interface PartialAsset {
	/** Hash of the generation key: there are no bytes to hash. */
	id: string;
	/** Library path, like any asset's; provisional until the bytes name themselves. */
	path: string;
	type: AssetType;
	createdAt: string;
	generation: AssetGeneration;
	state: PartialAssetState;
	error?: string;
}

export type AssetEntry = Asset | PartialAsset;

export const isPartialAsset = (entry: AssetEntry): entry is PartialAsset => 'state' in entry;

export const assetName = (asset: Pick<AssetEntry, 'path'>): string => basename(asset.path);

/** '' at root. */
export const assetFolder = (asset: Pick<AssetEntry, 'path'>): string => dirname(asset.path);

export function basename(path: string): string {
	let end = path.length;
	while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end--;
	const trimmed = path.slice(0, end);
	const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	return at < 0 ? trimmed : trimmed.slice(at + 1);
}

export function dirname(path: string): string {
	const at = path.lastIndexOf('/');
	return at < 0 ? '' : path.slice(0, at);
}

export const joinPath = (...parts: string[]): string =>
	parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/** Normalizes a library path: `/`-separated, no leading/trailing/double slashes. */
export const normalizePath = (path: string): string =>
	path.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.').join('/');
