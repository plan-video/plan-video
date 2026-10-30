/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps address elements by `Source` stamp, never by entity: entities die on remount, stamps survive it.
// Cleared on every mount: edits recorded against the old document can't replay against the new one.

import type { Transcript } from '@plan.video/assets';
import { Source, getEntityChildren } from '@plan.video/runtime';
import { authoredElement, renderAuthored } from '@plan.video/reconciler';
import { createSignal } from 'solid-js';

import { getDocumentEditor } from './editor';

import type { AuthoredTree } from '@plan.video/reconciler';
import type { InspectValue, PropValue } from '@plan.video/jsx';
import type { Entity, World } from 'koota';
import type { CapturedNode, DocumentEditor, EntityEdit } from './editor';

// Pointing and viewing, not composition: passes to the file without entering the history.
const EXCLUDED_PROPS: ReadonlySet<string> = new Set(['selected', 'active', 'camera', 'expanded', 'clipHeight', 'timeline', 'playhead']);

// Inspector sliders and repeated nudges arrive as bursts of tiny transactions; repeats within this window merge.
const COALESCE_WINDOW = 600;

const MAX_TRANSACTIONS = 100;

interface PropOp {
	kind: 'prop';
	source: string;
	name: string;
	before: unknown;
	after: unknown;
}

interface TextOp {
	kind: 'text';
	source: string;
	before: string;
	after: string;
}

interface InsertOp {
	kind: 'insert';
	parent: string;
	before?: string;
	node: CapturedNode;
}

interface RemoveOp {
	kind: 'remove';
	parent: string;
	before?: string;
	node: CapturedNode;
}

interface MoveOp {
	kind: 'move';
	source: string;
	fromParent?: string;
	fromBefore?: string;
	toParent: string;
	toBefore?: string;
}

// Addressed by file and variable name, so renames never touch it.
interface VariableOp {
	kind: 'variable';
	file: string;
	name: string;
	before: InspectValue;
	after: InspectValue;
}

interface TranscriptOp {
	kind: 'transcript';
	assetId: string;
	before: Transcript;
	after: Transcript;
}

type HistoryOp = PropOp | TextOp | InsertOp | RemoveOp | MoveOp | VariableOp | TranscriptOp;

type CaptionTranscriptApplier = (world: World, assetId: string, transcript: Transcript) => void;

let applyCaptionTranscript: CaptionTranscriptApplier | null = null;

export function setCaptionTranscriptApplier(applier: CaptionTranscriptApplier): void {
	applyCaptionTranscript = applier;
}

const slidingKey = (op: HistoryOp): string | undefined => {
	if (op.kind === 'prop') return `prop ${op.source} ${op.name}`;
	if (op.kind === 'text') return `text ${op.source}`;
	if (op.kind === 'variable') return `variable ${op.file} ${op.name}`;
	if (op.kind === 'transcript') return `transcript ${op.assetId}`;
	return undefined;
};

// `broken`: holds an edit that couldn't be captured whole; replaying around it would lie, so committing clears the history.
interface Transaction {
	ops: HistoryOp[];
	gesture: boolean;
	committedAt: number;
	broken?: boolean;
}

export class EditHistory {
	private readonly world: World;
	private readonly editor: DocumentEditor;

	private undos: Transaction[] = [];
	private redos: Transaction[] = [];
	private open: Transaction | null = null;
	// Renames must reach the step being replayed too.
	private replaying: Transaction | null = null;
	private gesture = false;
	private scheduled = false;
	private applying = false;

	private readonly changed: () => void;
	private readonly version: () => number;

	public constructor(world: World) {
		this.world = world;
		this.editor = getDocumentEditor(world);
		this.editor.onEdit((edit) => this.record(edit));
		this.editor.onRename((ids) => this.rename(ids));

		const [version, setVersion] = createSignal(0);
		this.version = version;
		this.changed = () => setVersion((current) => current + 1);
	}

	public canUndo(): boolean {
		this.version();
		return this.undos.length > 0 || (this.open?.ops.length ?? 0) > 0;
	}

	public canRedo(): boolean {
		this.version();
		return this.redos.length > 0;
	}

	public reset(): void {
		this.undos = [];
		this.redos = [];
		this.open = null;
		this.gesture = false;
		this.changed();
	}

	public beginGesture(): void {
		if (this.open) this.commit();
		this.gesture = true;
	}

	public endGesture(): void {
		if (!this.gesture) return;
		this.gesture = false;
		if (this.open) this.commit();
	}

	public recordTranscript(assetId: string, before: Transcript, after: Transcript): void {
		if (this.applying || !assetId) return;
		const previous = cloneTranscript(before);
		const next = cloneTranscript(after);
		if (JSON.stringify(previous) === JSON.stringify(next)) return;

		const transaction = this.ensureOpen();
		const existing = transaction.ops.find(
			(op): op is TranscriptOp => op.kind === 'transcript' && op.assetId === assetId,
		);
		if (existing) {
			existing.after = next;
			return;
		}
		transaction.ops.push({ kind: 'transcript', assetId, before: previous, after: next });
	}

	public undo(): void {
		if (this.open) this.commit();
		const transaction = this.undos.pop();
		if (!transaction) return;

		this.replay(transaction, [...transaction.ops].reverse(), (op) => this.revert(op));
		this.redos.push(transaction);
		this.changed();
	}

	public redo(): void {
		if (this.open) this.commit();
		const transaction = this.redos.pop();
		if (!transaction) return;

		this.replay(transaction, transaction.ops, (op) => this.apply(op));
		this.undos.push(transaction);
		this.changed();
	}

	// `applying` keeps the recorder from hearing the replay as new edits. A reinsert mid-replay
	// renames sources the step's later ops refer to, hence `replaying`.
	private replay(transaction: Transaction, ops: HistoryOp[], step: (op: HistoryOp) => void): void {
		this.applying = true;
		this.replaying = transaction;
		try {
			for (const op of ops) step(op);
		} finally {
			this.applying = false;
			this.replaying = null;
		}
	}

	private record(edit: EntityEdit): void {
		if (this.applying) return;

		switch (edit.kind) {
			// An unroll renders exactly what the loop rendered: nothing to invert.
			case 'unroll':
				return;

			case 'prop': {
				if (EXCLUDED_PROPS.has(edit.name)) return;
				// No inverse reported: not undoable, and a step would restore the wrong value.
				if (!('previous' in edit)) return;
				const transaction = this.ensureOpen();
				const existing = transaction.ops.find(
					(op): op is PropOp => op.kind === 'prop' && op.source === edit.source && op.name === edit.name,
				);
				if (existing) {
					existing.after = edit.value;
					return;
				}
				transaction.ops.push({ kind: 'prop', source: edit.source, name: edit.name, before: edit.previous, after: edit.value });
				return;
			}

			case 'text': {
				const transaction = this.ensureOpen();
				const existing = transaction.ops.find(
					(op): op is TextOp => op.kind === 'text' && op.source === edit.source,
				);
				if (existing) {
					existing.after = edit.value;
					return;
				}
				transaction.ops.push({ kind: 'text', source: edit.source, before: edit.previous ?? '', after: edit.value });
				return;
			}

			case 'variable': {
				const transaction = this.ensureOpen();
				const existing = transaction.ops.find(
					(op): op is VariableOp => op.kind === 'variable' && op.file === edit.file && op.name === edit.name,
				);
				if (existing) {
					existing.after = edit.value;
					return;
				}
				transaction.ops.push({ kind: 'variable', file: edit.file, name: edit.name, before: edit.previous, after: edit.value });
				return;
			}

			case 'insert': {
				const transaction = this.ensureOpen();
				// Live values rather than the edit's wire form, so a redo renders it like `duplicate`.
				// Children arrive as inserts of their own (parents first), so the node holds none.
				const entity = this.resolve(edit.source);
				const element = entity ? authoredElement(entity) : undefined;
				transaction.ops.push({
					kind: 'insert',
					parent: edit.parent,
					...(edit.before ? { before: edit.before } : {}),
					node: {
						source: edit.source,
						tag: edit.tag,
						props: element ? element.props : { ...edit.props },
						...(edit.text === undefined ? {} : { text: edit.text }),
						children: [],
					},
				});
				return;
			}

			case 'move': {
				const transaction = this.ensureOpen();
				transaction.ops.push({
					kind: 'move',
					source: edit.source,
					toParent: edit.parent,
					...(edit.before ? { toBefore: edit.before } : {}),
					...(edit.fromParent ? { fromParent: edit.fromParent } : {}),
					...(edit.fromBefore ? { fromBefore: edit.fromBefore } : {}),
				});
				return;
			}

			case 'remove': {
				const transaction = this.ensureOpen();
				if (!edit.parent || !edit.node) {
					// Gone without a capture: nothing can put it back, and older steps referring into it would replay wrong.
					transaction.broken = true;
					return;
				}
				transaction.ops.push({
					kind: 'remove',
					parent: edit.parent,
					...(edit.before ? { before: edit.before } : {}),
					node: edit.node,
				});
				return;
			}
		}
	}

	// Outside a gesture a burst commits on the microtask, so everything one event handler did is one step.
	private ensureOpen(): Transaction {
		if (!this.open) {
			this.open = { ops: [], gesture: this.gesture, committedAt: 0 };
			this.changed();
		}
		if (!this.gesture && !this.scheduled) {
			this.scheduled = true;
			queueMicrotask(() => {
				this.scheduled = false;
				if (!this.gesture && this.open) this.commit();
			});
		}
		return this.open;
	}

	private commit(): void {
		const transaction = this.open;
		this.open = null;
		if (!transaction) return;

		if (transaction.broken) {
			this.undos = [];
			this.redos = [];
			this.changed();
			return;
		}

		if (transaction.ops.length === 0) return;

		transaction.committedAt = performance.now();

		const last = this.undos[this.undos.length - 1];
		if (last && this.coalesces(last, transaction)) {
			for (const op of transaction.ops) {
				const key = slidingKey(op);
				if (!key || !('after' in op)) continue;
				const target = last.ops.find((candidate) => slidingKey(candidate) === key);
				if (target && 'after' in target) target.after = op.after;
			}
			last.committedAt = transaction.committedAt;
		} else {
			this.undos.push(transaction);
			if (this.undos.length > MAX_TRANSACTIONS) this.undos.shift();
		}

		this.redos = [];
		this.changed();
	}

	// Two gestures never merge: two drags are two steps.
	private coalesces(last: Transaction, next: Transaction): boolean {
		if (last.gesture || next.gesture) return false;
		if (next.committedAt - last.committedAt > COALESCE_WINDOW) return false;

		const keysOf = (transaction: Transaction): Set<string> | undefined => {
			const keys = new Set<string>();
			for (const op of transaction.ops) {
				const key = slidingKey(op);
				if (key === undefined) return undefined;
				keys.add(key);
			}
			return keys;
		};
		const lastKeys = keysOf(last);
		const nextKeys = keysOf(next);
		if (!lastKeys || !nextKeys) return false;
		return lastKeys.size === nextKeys.size && [...nextKeys].every((entry) => lastKeys.has(entry));
	}

	private revert(op: HistoryOp): void {
		switch (op.kind) {
			case 'prop': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editProperty(entity, op.name, op.before as PropValue);
				return;
			}
			case 'text': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editText(entity, op.before);
				return;
			}
			case 'insert': {
				const entity = this.resolve(op.node.source);
				if (entity) this.editor.remove(entity);
				return;
			}
			case 'remove': {
				this.reinsert(op);
				return;
			}
			case 'move': {
				if (!op.fromParent) return;
				const entity = this.resolve(op.source);
				const parent = this.resolve(op.fromParent);
				if (!entity || !parent) return;
				const anchor = op.fromBefore === undefined ? undefined : this.resolve(op.fromBefore);
				this.editor.reparent(entity, parent, anchor);
				return;
			}
			case 'variable': {
				this.editor.editVariable(op.file, op.name, op.before);
				return;
			}
			case 'transcript': {
				applyCaptionTranscript?.(this.world, op.assetId, op.before);
				return;
			}
		}
	}

	private apply(op: HistoryOp): void {
		switch (op.kind) {
			case 'prop': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editProperty(entity, op.name, op.after as PropValue);
				return;
			}
			case 'text': {
				const entity = this.resolve(op.source);
				if (entity) this.editor.editText(entity, op.after);
				return;
			}
			case 'insert': {
				this.reinsert(op);
				return;
			}
			case 'remove': {
				const entity = this.resolve(op.node.source);
				if (entity) this.editor.remove(entity);
				return;
			}
			case 'move': {
				const entity = this.resolve(op.source);
				const parent = this.resolve(op.toParent);
				if (!entity || !parent) return;
				const anchor = op.toBefore === undefined ? undefined : this.resolve(op.toBefore);
				this.editor.reparent(entity, parent, anchor);
				return;
			}
			case 'variable': {
				this.editor.editVariable(op.file, op.name, op.after);
				return;
			}
			case 'transcript': {
				applyCaptionTranscript?.(this.world, op.assetId, op.after);
				return;
			}
		}
	}

	// The reinsert mints fresh pending sources; renaming the recorded ones to them keeps every other step
	// pointing at the reborn element. A missing anchor means last, as the writer does.
	private reinsert(op: InsertOp | RemoveOp): void {
		const parent = this.resolve(op.parent);
		if (!parent) return;
		const anchor = op.before === undefined ? undefined : this.resolve(op.before);

		const [top] = this.editor.insertElement(parent, () => renderAuthored(toAuthored(op.node)), anchor);
		if (!top) return;

		const ids: Record<string, string> = {};
		this.pair(op.node, top, ids);
		this.rename(ids);
	}

	// The render is the capture replayed, so the shapes match position for position.
	private pair(node: CapturedNode, entity: Entity, ids: Record<string, string>): void {
		const source = entity.get(Source)?.value;
		if (source && source !== node.source) ids[node.source] = source;

		const children = getEntityChildren(this.world, entity).filter((child) => authoredElement(child) !== undefined);
		node.children.forEach((child, index) => {
			const live = children[index];
			if (live) this.pair(child, live, ids);
		});
	}

	private rename(ids: Record<string, string>): void {
		if (Object.keys(ids).length === 0) return;
		const next = (source: string): string => ids[source] ?? source;

		const transactions = [
			...this.undos,
			...this.redos,
			...(this.open ? [this.open] : []),
			...(this.replaying ? [this.replaying] : []),
		];
		for (const transaction of transactions) {
			for (const op of transaction.ops) {
				switch (op.kind) {
					case 'prop':
					case 'text':
						op.source = next(op.source);
						break;
					case 'move':
						op.source = next(op.source);
						op.toParent = next(op.toParent);
						if (op.toBefore !== undefined) op.toBefore = next(op.toBefore);
						if (op.fromParent !== undefined) op.fromParent = next(op.fromParent);
						if (op.fromBefore !== undefined) op.fromBefore = next(op.fromBefore);
						break;
					case 'insert':
					case 'remove':
						op.parent = next(op.parent);
						if (op.before !== undefined) op.before = next(op.before);
						renameNode(op.node, next);
						break;
				}
			}
		}
	}

	private resolve(source: string): Entity | undefined {
		for (const entity of this.world.query(Source)) {
			if (entity.isAlive() && entity.get(Source)!.value === source) return entity;
		}
		return undefined;
	}
}

function toAuthored(node: CapturedNode): AuthoredTree {
	return {
		tag: node.tag,
		props: { ...node.props },
		...(node.text === undefined ? {} : { text: node.text }),
		children: node.children.map(toAuthored),
	};
}

function renameNode(node: CapturedNode, next: (source: string) => string): void {
	node.source = next(node.source);
	for (const child of node.children) renameNode(child, next);
}

function cloneTranscript(transcript: Transcript): Transcript {
	return JSON.parse(JSON.stringify(transcript)) as Transcript;
}

const histories = new WeakMap<World, EditHistory>();

// Outlives mounts, like the editor; `reset` it per mount.
export function getEditHistory(world: World): EditHistory {
	let history = histories.get(world);
	if (!history) {
		history = new EditHistory(world);
		histories.set(world, history);
	}
	return history;
}
