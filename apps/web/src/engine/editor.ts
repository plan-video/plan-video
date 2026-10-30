/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Active, Background, Chars, colorToHex, Computed, DEFAULT_BACKGROUND, FrameRate, framesToSeconds, getActiveEntity, getEntityChildren, getEntityTree, getIntrinsicPaint, getParentEntity, getEntityBounds, getNextName, getTimelineOrigin, isScene, isText, Loop, PaintType, Root, Selected, Sequential, setActive, Size, Source, Stage } from '@plan.video/runtime';
import { isAssetRef, isPropValue, serializeAssetRef, SOURCE_ATTR } from '@plan.video/jsx';
import { createRoot } from 'solid-js';

import { authoredElement, authoredTree, getRuntimeDocument, insert, isSceneNode, renderAuthored, withDocument } from '@plan.video/reconciler';

import { findInspectEntry } from './inspect';
import { findEmptyPlacement } from './placement';
import { clearCaptionWordSelection } from './timeline/caption-word-selection';
import { AssetSelection } from './traits';

import type { Rect, SceneNode } from '@plan.video/runtime';
import type { AssetRef, InspectValue, PropValue, SerializedAssetRef } from '@plan.video/jsx';
import type { Entity, World } from 'koota';
import type { AuthoredTree, ProjectDocument, RuntimeDocument } from '@plan.video/reconciler';

export type EditValue = PropValue | SerializedAssetRef;

export interface PropEdit {
	kind: 'prop';
	source: string;
	name: string;
	value: EditValue;
	/** The value before this edit (`false` if unauthored); the history inverts from it. Absent: not invertible. */
	previous?: unknown;
}

export interface TextEdit {
	kind: 'text';
	source: string;
	value: string;
	previous?: string;
}

/** The entity already exists when reported, stamped with a pending `source` the writer answers with the real one. */
export interface InsertEdit {
	kind: 'insert';
	source: string;
	parent: string;
	tag: string;
	props: Record<string, EditValue>;
	before?: string;
	text?: string;
}

/** Reported after the entity has moved. */
export interface MoveEdit {
	kind: 'move';
	source: string;
	parent: string;
	before?: string;
	fromParent?: string;
	fromBefore?: string;
}

/** Holds live values, `AssetRef`s included: never send it over a wire. */
export interface CapturedNode {
	source: string;
	tag: string;
	props: Record<string, unknown>;
	text?: string;
	children: CapturedNode[];
}

/**
 * Only the top of a deleted subtree is reported, after the entity is gone.
 * `parent`, `before` and `node` are absent when the subtree could not be captured whole.
 */
export interface RemoveEdit {
	kind: 'remove';
	source: string;
	parent?: string;
	before?: string;
	node?: CapturedNode;
}

/** Every iteration but the first carries the pending source its entity was re-stamped with. */
export type LoopIteration = Record<string, { props: Record<string, EditValue>; text?: string; pending?: string }>;

/**
 * Reported before the edit that needed it, with the entities already re-stamped.
 * `loop` is the stamp `unsettle` gives back if the write declines.
 */
export interface UnrollEdit {
	kind: 'unroll';
	source: string;
	loop: string;
	iterations: LoopIteration[];
}

export interface VariableEdit {
	kind: 'variable';
	file: string;
	name: string;
	value: InspectValue;
	previous: InspectValue;
}

export type EntityEdit = PropEdit | TextEdit | InsertEdit | MoveEdit | RemoveEdit | UnrollEdit | VariableEdit;

/** Shaped so `parseSource` rejects them (no `:`): they must never reach a file as an address. */
const PENDING_PREFIX = 'pending#';
let pendingCounter = 0;

export const isPendingSource = (source: string): boolean => source.startsWith(PENDING_PREFIX);

const nextPendingSource = (): string => `${PENDING_PREFIX}${++pendingCounter}`;

/** Whether an entity was rendered by a loop the source has not been asked to unroll yet. */
export const isLooped = (entity: Entity): boolean => entity.isAlive() && entity.has(Loop);

interface Recorded {
	tag: string;
	props: Record<string, EditValue>;
}

/** The one place that decides what a prop value can travel as; undefined is left to the project, not guessed at. */
function wireValue(value: unknown): EditValue | undefined {
	if (isPropValue(value)) return value;
	if (isAssetRef(value)) return serializeAssetRef(value);
	return undefined;
}

function wireProps(props: Record<string, unknown>): Record<string, EditValue> {
	const wired: Record<string, EditValue> = {};
	for (const [name, value] of Object.entries(props)) {
		const wire = wireValue(value);
		if (wire !== undefined) wired[name] = wire;
	}
	return wired;
}

/** `authoredElement` already copies the props, so the capture does not change under the caller. */
function captureNode(world: World, entity: Entity): CapturedNode | undefined {
	const element = authoredElement(entity);
	const source = entity.get(Source)?.value;
	if (!element || !source) return undefined;

	const children: CapturedNode[] = [];
	for (const child of getEntityChildren(world, entity)) {
		const node = captureNode(world, child);
		if (node) children.push(node);
	}

	return {
		source,
		tag: element.tag,
		// The timeline's scene is held on the trait, not the element: an undo
		// that puts the scene back has to put the timeline back on it too.
		props: entity.has(Active) ? { ...element.props, active: true } : element.props,
		...(element.text === undefined ? {} : { text: element.text }),
		children,
	};
}

function nextSourceAfter(world: World, entity: Entity): string | undefined {
	const parent = getParentEntity(entity);
	if (!parent) return undefined;
	const siblings = getEntityChildren(world, parent);
	for (const sibling of siblings.slice(siblings.indexOf(entity) + 1)) {
		const source = sibling.get(Source)?.value;
		if (source) return source;
	}
	return undefined;
}

/** Props that only mean something while the node plays media. `start`/`end` stay: they place the clip, media or not. */
const MEDIA_PROPS = ['src', 'objectFit', 'cropX', 'cropY', 'cropWidth', 'cropHeight', 'frameRate', 'sourceIn', 'sourceOut', 'volume', 'muted', 'syncTo'] as const;

/**
 * The parent is kept by stamp so it outlives a remount. `stage` is captured at copy
 * time since the copied nodes may be cut or moved before the paste.
 */
interface Clipboard {
	trees: AuthoredTree[];
	parent?: string;
	stage?: Rect;
}

const STAGE_PASTE_GAP = 40;

function shiftPosition(value: unknown, delta: number): unknown {
	if (value === undefined) return delta;
	return typeof value === 'number' ? value + delta : value;
}

export class DocumentEditor {
	private readonly world: World;
	private readonly sinks = new Set<(edit: EntityEdit) => void>();
	private readonly renames = new Set<(ids: Record<string, string>) => void>();
	private readonly asides = new Map<Entity, { sources: Set<string>; listener: () => void }>();
	private clipboard: Clipboard = { trees: [] };

	public constructor(world: World) {
		this.world = world;
	}

	private get document(): RuntimeDocument {
		return getRuntimeDocument(this.world);
	}

	/** Every listener hears every edit, in the order they subscribed. */
	public onEdit(sink: (edit: EntityEdit) => void): () => void {
		this.sinks.add(sink);
		return () => {
			this.sinks.delete(sink);
		};
	}

	public onRename(listener: (ids: Record<string, string>) => void): () => void {
		this.renames.add(listener);
		return () => {
			this.renames.delete(listener);
		};
	}

	/**
	 * Keeps edits under `root` out of the file and the history; `listener` runs instead.
	 * For nodes that stand in for something the file does not hold.
	 */
	public aside(root: Entity, listener: () => void): () => void {
		this.asides.set(root, { sources: new Set(), listener });
		return () => {
			this.asides.delete(root);
		};
	}

	private asideFor(edit: EntityEdit): (() => void) | undefined {
		if (!('source' in edit)) return undefined;
		for (const [root, aside] of this.asides) {
			// Remembered as well as read: a removal names a node that has
			// already left the subtree.
			if (root.isAlive()) {
				for (const entity of getEntityTree(this.world, root)) {
					const source = entity.get(Source)?.value;
					if (source) aside.sources.add(source);
				}
			}
			const parent = 'parent' in edit ? edit.parent : undefined;
			if (aside.sources.has(edit.source) || (parent !== undefined && aside.sources.has(parent))) {
				return aside.listener;
			}
		}
		return undefined;
	}

	private emit(edit: EntityEdit): void {
		const aside = this.asides.size > 0 ? this.asideFor(edit) : undefined;
		if (aside) {
			aside();
			return;
		}
		for (const sink of [...this.sinks]) sink(edit);
	}

	/** Writes a prop to the document and reports it. */
	public editProperty(entity: Entity, name: string, value: PropValue | AssetRef): void {
		const node = this.document.node(entity);
		let previous = node.props[name];
		// The stage keeps no authored record (see RuntimeDocument.setProperty), so its
		// previous value is read off the trait; the default spells as the attribute's absence.
		if (name === 'background' && previous === undefined) {
			const background = entity.get(Background)?.value;
			if (background !== undefined && background !== DEFAULT_BACKGROUND) previous = colorToHex(background);
		}
		this.document.setProperty(node, name, value);
		this.reportEdit(entity, name, wireValue(value)!, wireValue(previous) ?? false);
	}

	/** A name the mount did not declare is ignored: an undo can outlive the registry entry it was recorded against. */
	public editVariable(file: string, name: string, value: InspectValue): void {
		const entry = findInspectEntry(this.world, file, name);
		if (!entry) return;
		// Against the committed value, not the live one
		const previous = entry.committed();
		entry.commit(value);
		if (previous === value) return;
		this.emit({ kind: 'variable', file, name, value, previous });
	}

	/** Settled first: one iteration of a loop cannot say something the others do not. */
	public editText(entity: Entity, text: string): void {
		const previous = entity.get(Chars)?.value ?? '';
		this.document.setText(entity, text);
		this.settle(entity);
		const source = entity.get(Source)?.value;

		if (source) {
			this.emit({ kind: 'text', source, value: text, previous });
		}
	}

	/**
	 * A looped entity is settled first, so the file hears the unroll before the value.
	 * Without `previous` the edit is not undoable.
	 */
	public reportEdit(entity: Entity, name: string, value: EditValue, previous?: unknown): void {
		this.settle(entity);
		const source = entity.get(Source)?.value;

		if (source) {
			this.emit({ kind: 'prop', source, name, value, ...(previous === undefined ? {} : { previous }) });
		}
	}

	/** Entities without a source only get the trait; the stage is not selectable. */
	public select(entities: Entity | Entity[], options: { extend?: boolean } = {}): void {
		if (!options.extend) clearCaptionWordSelection();

		const next = new Set(Array.isArray(entities) ? entities : [entities]);

		if (this.world.has(AssetSelection) && this.world.get(AssetSelection)?.id !== null) {
			this.world.set(AssetSelection, { id: null });
		}

		if (!options.extend) {
			for (const entity of [...this.world.query(Selected)]) {
				if (!next.has(entity)) this.setSelected(entity, false);
			}
		}

		for (const entity of next) {
			this.setSelected(entity, true);
		}
	}

	public deselect(entities: Entity | Entity[]): void {
		for (const entity of Array.isArray(entities) ? entities : [entities]) {
			this.setSelected(entity, false);
		}
	}

	public clearSelection(): void {
		this.select([]);
	}

	public activate(entity: Entity | null): void {
		const current = getActiveEntity(this.world);
		if (current === entity) return;
		setActive(this.world, entity);
		if (current?.isAlive() && !isLooped(current)) this.reportEdit(current, 'active', false);
		if (entity && !isLooped(entity)) this.reportEdit(entity, 'active', true);
	}

	/**
	 * Selecting a looped entity stays on the canvas: it is no reason to unroll the loop,
	 * and the loop body cannot say which iteration is meant.
	 */
	private setSelected(entity: Entity, selected: boolean): void {
		if (!entity.isAlive() || entity.has(Stage) || entity.has(Selected) === selected) return;
		if (selected) entity.add(Selected);
		else entity.remove(Selected);
		if (!isLooped(entity)) this.reportEdit(entity, 'selected', selected);
	}

	/**
	 * Unrolls the loop that rendered `entity` before its first edit, so a write lands on
	 * one iteration, not all. Iterations after the first are re-stamped pending; `unsettle`
	 * reverts if the write declines. Left alone when the loop cannot be spelled out
	 * (iterations differ, nested loop, no source): the writer refuses to write into a loop.
	 */
	private settle(entity: Entity): void {
		if (!isLooped(entity)) return;
		const loop = entity.get(Loop)!.value;
		const stamped = (candidate: Entity | null): boolean => candidate !== null && candidate.get(Loop)?.value === loop;

		let top = entity;
		while (stamped(getParentEntity(top))) top = getParentEntity(top)!;
		const container = getParentEntity(top);
		if (container === null || isLooped(container)) return;

		const roots = getEntityChildren(this.world, container).filter(stamped);
		const first = roots[0]?.get(Source)?.value;
		if (!first) return;

		// The body's top-level sources repeat once per iteration.
		const width = roots.findIndex((root, index) => index > 0 && root.get(Source)?.value === first);
		const stride = width === -1 ? roots.length : width;
		if (roots.length % stride !== 0) return;
		const count = roots.length / stride;
		if (!roots.every((root, index) => root.get(Source)?.value === roots[index % stride]!.get(Source)?.value)) return;

		const iterations: LoopIteration[] = [];
		const restamp: [Entity, string][] = [];
		for (let index = 0; index < count; index++) {
			const iteration: LoopIteration = {};
			for (const root of roots.slice(index * stride, (index + 1) * stride)) {
				for (const member of getEntityTree(this.world, root)) {
					// The runtime's own sub-entities are derived, not written.
					const authored = authoredElement(member);
					if (!authored) continue;
					const source = member.get(Source)?.value;
					// Nested loop, unknown element, or one the body renders twice: not spellable.
					if (!source || !stamped(member) || source in iteration) return;
					const pending = index > 0 ? nextPendingSource() : undefined;
					iteration[source] = { props: wireProps(authored.props), ...(authored.text === undefined ? {} : { text: authored.text }), ...(pending ? { pending } : {}) };
					if (pending) restamp.push([member, pending]);
				}
			}
			iterations.push(iteration);
		}

		for (const [member, pending] of restamp) member.set(Source, { value: pending });
		for (const root of roots) {
			for (const member of getEntityTree(this.world, root)) member.remove(Loop);
		}

		this.emit({ kind: 'unroll', source: first, loop, iterations });
	}

	public unsettle(edit: UnrollEdit): void {
		const originals = new Map<string, string>();
		const members = new Set<string>();
		for (const iteration of edit.iterations) {
			for (const [source, { pending }] of Object.entries(iteration)) {
				members.add(source);
				if (pending) originals.set(pending, source);
			}
		}

		for (const entity of this.world.query(Source)) {
			const current = entity.get(Source)!.value;
			const original = originals.get(current);
			if (original) entity.set(Source, { value: original });
			if (original || members.has(current)) {
				entity.add(Loop);
				entity.set(Loop, { value: edit.loop });
			}
		}
	}

	/**
	 * `element` must use the PascalCase components of "./elements": an app's own JSX
	 * compiles for the DOM. Inserts are reported parents first, so a nested tree lands in one write.
	 */
	public insertElement(parent: Entity, element: () => unknown, anchor?: Entity): Entity[] {
		if (!parent.get(Source)?.value) return [];
		// A child of one iteration's element, not of every iteration's.
		this.settle(parent);
		if (anchor) this.settle(anchor);

		const created = new Map<Entity, Recorded>();
		const document = this.document;
		const dispose = createRoot((dispose) => {
			withDocument(this.recording(created), () =>
				insert(document.node(parent), element, anchor ? document.node(anchor) : null),
			);
			return dispose;
		});
		// Nothing here stays reactive: the values were the tool's, and the
		// entities outlive the graph that produced them (as on unmount).
		dispose();

		for (const [entity, { tag, props }] of created) {
			const parentEntity = getParentEntity(entity);
			const parentSource = parentEntity?.get(Source)?.value;
			if (!parentEntity || !parentSource) continue;

			// Placed in front of the next sibling that was already there. New siblings are
			// skipped: either way the order in the file comes out right.
			const siblings = getEntityChildren(this.world, parentEntity);
			const before = siblings
				.slice(siblings.indexOf(entity) + 1)
				.find((sibling) => !created.has(sibling))
				?.get(Source)?.value;

			// A text element's content arrived as text nodes, which the document
			// has already folded into Chars; that is what the file gets.
			const text = isText(entity) ? entity.get(Chars)?.value : undefined;

			this.emit({
				kind: 'insert',
				source: entity.get(Source)!.value,
				parent: parentSource,
				tag,
				props,
				...(before ? { before } : {}),
				...(text === undefined ? {} : { text }),
			});
		}

		return [...created.keys()].filter((entity) => !created.has(getParentEntity(entity)!));
	}

	/**
	 * Two clips at the same time conflict in a sequence, so a copy from inside one goes
	 * to the nearest non-sequence parent, on top of the sequence.
	 */
	public duplicate(entities: Entity | Entity[]): Entity[] {
		const copies: Entity[] = [];
		for (const source of this.subtreeRoots(entities)) {
			const tree = this.spell(source);
			if (!tree) continue;

			let below = source;
			let parent = getParentEntity(below);
			while (parent && parent.has(Sequential)) {
				below = parent;
				parent = getParentEntity(below);
			}
			if (!parent) continue;

			const siblings = getEntityChildren(this.world, parent);
			const anchor = siblings[siblings.indexOf(below) + 1];

			const renamed = this.renameScene(tree);
			copies.push(...this.insertElement(parent, () => renderAuthored(renamed), anchor));
		}

		if (copies.length) this.select(copies);
		return copies;
	}

	/**
	 * Each copy goes right after its original, inside any sequence: only for callers
	 * about to move the two apart (a split).
	 */
	public duplicateInPlace(entities: Entity | Entity[]): { original: Entity; copy: Entity }[] {
		const pairs: { original: Entity; copy: Entity }[] = [];

		for (const original of this.subtreeRoots(entities)) {
			const parent = getParentEntity(original);
			if (!parent) continue;

			this.settle(original);
			const tree = this.spell(original);
			if (!tree) continue;

			const siblings = getEntityChildren(this.world, parent);
			const anchor = siblings[siblings.indexOf(original) + 1];

			const [copy] = this.insertElement(parent, () => renderAuthored(tree), anchor);
			if (copy) pairs.push({ original, copy });
		}

		return pairs;
	}

	/**
	 * Children's positions are not rewritten, which suits a `<sequence>` (no space or time
	 * of its own) but not a wrapper that sits somewhere.
	 */
	public wrap(entities: Entity | Entity[], element: () => unknown): Entity | null {
		const roots = new Set(this.subtreeRoots(entities));
		const first = [...roots][0];
		if (!first) return null;

		const parent = getParentEntity(first);
		if (!parent) return null;

		const members = getEntityChildren(this.world, parent).filter((entity) => roots.has(entity));
		if (members.length === 0) return null;

		// In front of the first member, so the wrapper takes their place among
		// the siblings rather than landing at the end of them.
		const [wrapper] = this.insertElement(parent, element, members[0]);
		if (!wrapper) return null;

		// Moved back to front, each in front of the one after it. Appending in order reads
		// the same on the canvas but not in the file, where an element still waiting to be
		// inserted lands before a move of one the file has.
		const moved: Entity[] = [];
		for (const member of [...members].reverse()) {
			if (this.reparent(member, wrapper, moved[0])) moved.unshift(member);
		}
		if (moved.length === 0) {
			this.remove(wrapper);
			return null;
		}

		return wrapper;
	}

	/**
	 * Rewrites a `<video>`/`<image>` as the `<rect>` it otherwise was. The box and span the
	 * media implied are pinned so only the picture goes away: media defaults to 1920x1080
	 * where a rect is 100x100, and a clip lasts its footage (see `pinTrimToCurrentBounds`).
	 */
	public removeIntrinsicPaint(node: Entity): Entity | null {
		const intrinsic = getIntrinsicPaint(node);
		if (intrinsic !== PaintType.VIDEO && intrinsic !== PaintType.IMAGE) return null;

		const parent = getParentEntity(node);
		if (!parent) return null;

		// Spelled as its own element, not every iteration's of a loop.
		this.settle(node);
		const tree = this.spell(node);
		if (!tree) return null;

		const props = { ...tree.props };
		for (const name of MEDIA_PROPS) {
			delete props[name];
		}

		const size = node.get(Size);
		if (size) {
			props.width ??= size.width;
			props.height ??= size.height;
		}

		const fps = this.world.get(FrameRate)?.value ?? 30;
		if (props.start === undefined) {
			// A start the runtime derived (a syncTo correlation) rather than the element authored.
			const start = Math.round((node.get(Computed)?.start ?? 0) - getTimelineOrigin(node));
			if (start > 0) props.start = framesToSeconds(start, fps);
		}
		if (props.end === undefined) {
			const end = (node.get(Computed)?.end ?? 0) - getTimelineOrigin(node);
			if (end > 0) props.end = framesToSeconds(end, fps);
		}

		const rect: AuthoredTree = { tag: 'rect', props, children: tree.children };

		const wasSelected = node.has(Selected);
		const wasActive = node.has(Active);

		const [next] = this.insertElement(parent, () => renderAuthored(rect), node);
		if (!next) return null;
		this.remove(node);

		if (wasSelected) this.select(next);
		if (wasActive) this.activate(next);

		return next;
	}

	/** Nothing is reported: the file only changes when the copy lands. */
	public copy(entities: Entity | Entity[]): void {
		const roots = this.subtreeRoots(entities);
		const trees = roots.map((root) => this.spell(root)).filter((tree) => tree !== undefined);
		if (!trees.length) return;
		const onStage = roots.every((root) => getParentEntity(root)?.has(Stage));
		const stage = onStage ? getEntityBounds(this.world, roots) ?? undefined : undefined;
		this.clipboard = { trees, parent: getParentEntity(roots[0]!)?.get(Source)?.value, stage };
	}

	/**
	 * Pasting back into the sequence it came from goes to the sequence's parent instead
	 * (`duplicate`'s rule). Stage copies go back on the stage, moved as a block to a free
	 * spot so they never land on the original.
	 */
	public paste(parent: Entity, anchor?: Entity): Entity[] {
		const { trees, parent: copiedFrom, stage } = this.clipboard;
		if (!trees.length) return [];
		if (stage) return this.pasteOnStage(trees, stage);

		if (parent.has(Sequential) && copiedFrom !== undefined && parent.get(Source)?.value === copiedFrom) {
			const outer = getParentEntity(parent);
			if (!outer) return [];
			const siblings = getEntityChildren(this.world, outer);
			anchor = siblings[siblings.indexOf(parent) + 1];
			parent = outer;
		}

		const copies: Entity[] = [];
		for (const tree of trees) {
			copies.push(...this.insertElement(parent, () => renderAuthored(tree), anchor));
		}

		if (copies.length) this.select(copies);
		return copies;
	}

	private pasteOnStage(trees: AuthoredTree[], bounds: Rect): Entity[] {
		const center = findEmptyPlacement(this.world, bounds.width, bounds.height, STAGE_PASTE_GAP);
		const dx = Math.round(center.x - (bounds.x + bounds.width / 2));
		const dy = Math.round(center.y - (bounds.y + bounds.height / 2));

		const copies: Entity[] = [];
		for (const tree of trees) {
			const renamed = this.renameScene(tree);
			const moved: AuthoredTree = {
				...renamed,
				props: { ...renamed.props, x: shiftPosition(tree.props.x, dx), y: shiftPosition(tree.props.y, dy) },
			};
			copies.push(...this.insertElement(this.world.get(Root)!, () => renderAuthored(moved)));
		}

		if (copies.length) this.select(copies);
		return copies;
	}

	/** Called once per copy right before its insert, so each sees the names inserted before it. */
	private renameScene(tree: AuthoredTree): AuthoredTree {
		const name = tree.props.name;
		if (tree.tag !== 'scene' || typeof name !== 'string' || !name) return tree;

		const numbered = name.match(/^(.*\S) \d+$/);
		let next = getNextName(this.world, numbered ? numbered[1]! : name);
		if (!numbered && next === `${name} 1`) next = `${name} 2`;
		return { ...tree, props: { ...tree.props, name: next } };
	}

	private subtreeRoots(entities: Entity | Entity[]): Entity[] {
		const wanted = new Set(
			(Array.isArray(entities) ? entities : [entities]).filter(
				(entity) => entity.isAlive() && !entity.has(Stage) && !!entity.get(Source)?.value,
			),
		);
		return [...wanted].filter((entity) => {
			for (let parent = getParentEntity(entity); parent; parent = getParentEntity(parent)) {
				if (wanted.has(parent)) return false;
			}
			return true;
		});
	}

	private spell(entity: Entity): AuthoredTree | undefined {
		const tree = authoredTree(this.world, entity);
		if (!tree) return undefined;
		delete tree.props.selected;
		delete tree.props.active;
		return tree;
	}

	public reparent(entity: Entity, parent: Entity, anchor?: Entity): boolean {
		if (!entity.get(Source)?.value || !parent.get(Source)?.value) return false;
		// Appending where it already is, last, is the one no-op; appending from elsewhere
		// in the same parent is how a node is sent to the end.
		if (getParentEntity(entity) === parent && anchor === undefined) {
			const siblings = getEntityChildren(this.world, parent);
			if (siblings[siblings.length - 1] === entity) return false;
		}
		// Checked here: the document treats a move into itself as a no-op and catches one
		// into its own subtree only after the node has left its parent.
		if (entity === parent || getEntityTree(this.world, entity).includes(parent)) return false;

		// Each end of the move has to be one element, not every iteration's.
		this.settle(entity);
		this.settle(parent);
		if (anchor) this.settle(anchor);
		const source = entity.get(Source)!.value;
		const parentSource = parent.get(Source)!.value;

		// Where it stands now, before the document moves it: the inverse move.
		const fromParent = getParentEntity(entity)?.get(Source)?.value;
		const fromBefore = nextSourceAfter(this.world, entity);

		const wasActive = entity.has(Active);

		try {
			const document = this.document;
			document.insertNode(document.node(parent), document.node(entity), anchor ? document.node(anchor) : undefined);
		} catch {
			return false;
		}

		// An anchor the file does not name cannot be pointed at; appending matches where the document put it.
		const before = anchor?.get(Source)?.value;

		this.emit({
			kind: 'move',
			source,
			parent: parentSource,
			...(before ? { before } : {}),
			...(fromParent ? { fromParent } : {}),
			...(fromBefore ? { fromBefore } : {}),
		});

		// Only a root holds the active tag (see world/observers); the file hears it lost here
		// rather than keeping an `active` its own rules would strip on reload.
		if (wasActive && !entity.has(Active)) {
			this.reportEdit(entity, 'active', false);
		}

		return true;
	}

	/** Only the tops of removed subtrees are reported. The stage and entities without a source stay. */
	public remove(entities: Entity | Entity[]): Entity[] {
		const doomed = new Set(
			(Array.isArray(entities) ? entities : [entities]).filter(
				(entity) => entity.isAlive() && !entity.has(Stage) && !!entity.get(Source)?.value,
			),
		);
		const roots = [...doomed].filter((entity) => {
			for (let parent = getParentEntity(entity); parent; parent = getParentEntity(parent)) {
				if (doomed.has(parent)) return false;
			}
			return true;
		});

		const document = this.document;
		const active = getActiveEntity(this.world);
		for (const entity of roots) {
			if (!entity.isAlive()) continue;
			// Cut from the file as one iteration's element, not the body's.
			this.settle(entity);
			const source = entity.get(Source)!.value;
			// A doomed sibling can be the `before`: the undo reinserts in reverse order,
			// so it is back by the time anything is placed against it.
			const parentSource = getParentEntity(entity)?.get(Source)?.value;
			const before = nextSourceAfter(this.world, entity);
			const node = captureNode(this.world, entity);
			document.removeNode(document.node(getParentEntity(entity) ?? document.stage.entity), document.node(entity));
			this.emit({
				kind: 'remove',
				source,
				...(parentSource ? { parent: parentSource } : {}),
				...(before ? { before } : {}),
				...(node ? { node } : {}),
			});
		}

		// The timeline moves to a remaining scene rather than to nothing. An undo puts it
		// back on the deleted one, which was captured active.
		if (active && !active.isAlive() && !getActiveEntity(this.world)) {
			const next = getEntityChildren(this.world, document.stage.entity).find((child) => isScene(child) && child.isAlive());
			if (next) this.activate(next);
		}

		return roots;
	}

	/** Queried rather than remembered: the surviving entities are the ones the world still holds. */
	public restamp(ids: Record<string, string>): void {
		for (const entity of this.world.query(Source)) {
			const next = ids[entity.get(Source)!.value];
			if (next) entity.set(Source, { value: next });
		}
		for (const listener of [...this.renames]) listener(ids);
	}

	/** An element whose insert could not be written has no place on the canvas either. */
	public discardPending(source: string): void {
		if (!isPendingSource(source)) return;
		const document = this.document;
		// Snapshot: destroying cascades through the subtree, and a live query
		// would hand back children that went with their parent.
		const doomed = [...this.world.query(Source)].filter((entity) => entity.get(Source)?.value === source);
		for (const entity of doomed) {
			if (!entity.isAlive()) continue;
			const parent = getParentEntity(entity);
			document.removeNode(document.node(parent ?? document.stage.entity), document.node(entity));
		}
	}

	private recording(created: Map<Entity, Recorded>): ProjectDocument<SceneNode> {
		const document = this.document;
		return {
			stage: document.stage,
			createElement: (tag) => {
				const node = document.createElement(tag);
				if (isSceneNode(node) && node !== document.stage) {
					document.setProperty(node, SOURCE_ATTR, nextPendingSource());
					created.set(node.entity, { tag: tag.charAt(0).toLowerCase() + tag.slice(1), props: {} });
				}
				return node;
			},
			setProperty: (node, name, value) => {
				const recorded = isSceneNode(node) ? created.get(node.entity) : undefined;
				if (recorded && name !== SOURCE_ATTR && name !== 'children' && name !== 'ref') {
					const wire = wireValue(value);
					if (wire !== undefined) recorded.props[name] = wire;
				}
				document.setProperty(node, name, value);
			},
			createTextNode: (text) => document.createTextNode(text),
			replaceText: (node, text) => document.replaceText(node, text),
			isTextNode: (node) => document.isTextNode(node),
			insertNode: (parent, node, anchor) => document.insertNode(parent, node, anchor),
			removeNode: (parent, node) => document.removeNode(parent, node),
			getParentNode: (node) => document.getParentNode(node),
			getFirstChild: (node) => document.getFirstChild(node),
			getNextSibling: (node) => document.getNextSibling(node),
		};
	}
}

const editors = new WeakMap<World, DocumentEditor>();

/** Outlives mounts: it reads the current document per call. */
export function getDocumentEditor(world: World): DocumentEditor {
	let editor = editors.get(world);
	if (!editor) {
		editor = new DocumentEditor(world);
		editors.set(world, editor);
	}
	return editor;
}
