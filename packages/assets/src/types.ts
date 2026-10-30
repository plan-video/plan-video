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

/** A word's own typography. Enum-valued fields hold the runtime's enum values. */
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

/**
 * How one caption word differs from the rest of its caption. What is left
 * out is the caption's. `color` is the glyph color (a 0xRRGGBB number) and
 * `blendMode` the runtime's enum value. A paint list replaces the caption's,
 * and an empty one means none at all. Effects and animations are the word's
 * alone: its animations play when it is spoken.
 */
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
	/** Short content hash; identity of the asset. */
	id: string;
	/**
	 * Library path: `folder/sub/name.ext`, `/`-separated, no leading slash.
	 * What JSX `src` names, and what the asset panel shows. Folders are the
	 * prefixes; renaming or moving an asset changes only this.
	 */
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

/** Where a generation stands while the library has no bytes for it. */
export type PartialAssetState = 'pending' | 'error';

/**
 * A partial document: the library's record of a generation before — or
 * instead of — its bytes. Written `pending` when a run starts, so the
 * generation is in the library from the moment it is asked for; replaced by
 * the asset when the run lands; kept as `error`, with what went wrong, when
 * it does not. The error record is what keeps a refused or impossible
 * generation from being run — or paid for — again on every reopen: a
 * declaration whose key stands in error resolves to that error, and removing
 * the record is what asks for the run again. Never bound to an entity;
 * elements see the state through their resolution.
 */
export interface PartialAsset {
	/** Hash of the generation key: there are no bytes to hash. */
	id: string;
	/** Library path, like any asset's; provisional until the bytes name themselves. */
	path: string;
	/** What the generation is to become. */
	type: AssetType;
	createdAt: string;
	generation: AssetGeneration;
	state: PartialAssetState;
	/** What the run failed with, on an `error` record. */
	error?: string;
}

/** Anything the library holds at a path: an asset, or a partial standing for one. */
export type AssetEntry = Asset | PartialAsset;

/** Whether a library entry is a partial document rather than an asset with bytes. */
export const isPartialAsset = (entry: AssetEntry): entry is PartialAsset => 'state' in entry;

/** The file name of an asset: the last segment of its library path. */
export const assetName = (asset: Pick<AssetEntry, 'path'>): string => basename(asset.path);

/** The folder of an asset: its library path without the name, '' at root. */
export const assetFolder = (asset: Pick<AssetEntry, 'path'>): string => dirname(asset.path);

export function basename(path: string): string {
	const trimmed = path.replace(/[/\\]+$/, '');
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
