/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { getDocumentEditor } from '@/engine/editor';
import { t } from '@/lib/i18n';
import { toast } from 'somoto';

import { writeProject } from './host';

import type { EntityEdit, InsertEdit, MoveEdit, RemoveEdit, UnrollEdit, VariableEdit } from '@/engine/editor';
import type { SourceEdit, WriteResult } from './host';
import type { World } from 'koota';

/** Long enough that a drag is one write, short enough that the file shows the canvas's value on release. */
const DEBOUNCE = 120;

class EditWriter {
	private readonly dir: string;
	private readonly world: World;

	// Write order matters: unrolls first (later edits address their copies), inserts in creation order, moves,
	// then the last value per prop; removes last, since cutting an unnamed element shifts its neighbours.
	private unrolls = new Map<string, UnrollEdit>();
	private inserts = new Map<string, InsertEdit>();
	private moves = new Map<string, MoveEdit>();
	private pending = new Map<string, InsertEdit['props']>();
	// Its own map: the file spells a text between the tags, not as a prop.
	private texts = new Map<string, string>();
	private removes = new Set<string>();
	private variables = new Map<string, VariableEdit>();
	private inflight = new Set<string>();
	// A declined unroll is taken back (its entities return to the loop) rather than discarded like a failed insert.
	private sent: UnrollEdit[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	public constructor(dir: string, world: World) {
		this.dir = dir;
		this.world = world;
	}

	public push(edit: EntityEdit): void {
		if (this.disposed) return;

		if (edit.kind === 'unroll') {
			this.unrolls.set(edit.source, edit);
		} else if (edit.kind === 'insert') {
			this.inserts.set(edit.source, edit);
		} else if (edit.kind === 'remove') {
			this.remove(edit);
		} else if (edit.kind === 'move') {
			// Where an element still waiting to be inserted goes is part of its insert, not a move.
			const insert = this.inserts.get(edit.source);

			if (insert) {
				const moved: InsertEdit = { ...insert, parent: edit.parent };
				if (edit.before === undefined) delete moved.before;
				else moved.before = edit.before;
				this.inserts.set(edit.source, moved);
			} else {
				this.moves.set(edit.source, edit);
			}
		} else if (edit.kind === 'variable') {
			this.variables.set(`${edit.file}\n${edit.name}`, edit);
		} else if (edit.kind === 'text') {
			// Part of how a still-waiting element is inserted, like a prop of it.
			const insert = this.inserts.get(edit.source);
			if (insert) insert.text = edit.value;
			else this.texts.set(edit.source, edit.value);
		} else {
			// Part of how a still-waiting element is inserted.
			const insert = this.inserts.get(edit.source);
			if (insert) insert.props = { ...insert.props, [edit.name]: edit.value };
			else this.pending.set(edit.source, { ...this.pending.get(edit.source), [edit.name]: edit.value });
		}

		this.schedule();
	}

	public dispose(): void {
		clearTimeout(this.timer);
		// The last edits still belong in the file, though their entities are on their way out.
		this.flush();
		this.disposed = true;
	}

	/**
	 * An element the file never had (an insert still waiting here) is simply not inserted; one it has,
	 * or that an in-flight write names, is removed by name.
	 */
	private remove(edit: RemoveEdit): void {
		const doomed = new Set([edit.source]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const insert of this.inserts.values()) {
				if (doomed.has(insert.parent) && !doomed.has(insert.source)) {
					doomed.add(insert.source);
					grew = true;
				}
			}
		}

		if (!this.inserts.has(edit.source)) this.removes.add(edit.source);
		for (const source of doomed) {
			this.inserts.delete(source);
			this.pending.delete(source);
			this.texts.delete(source);
			this.moves.delete(source);
		}

		// An anchor that is gone means "last", the same answer the write gives to one it can't find.
		for (const [source, insert] of this.inserts) {
			if (insert.before !== undefined && doomed.has(insert.before)) {
				const { before: _, ...rest } = insert;
				this.inserts.set(source, rest);
			}
		}
		for (const [source, move] of [...this.moves]) {
			if (doomed.has(move.parent)) this.moves.delete(source);
			else if (move.before !== undefined && doomed.has(move.before)) {
				const { before: _, ...rest } = move;
				this.moves.set(source, rest);
			}
		}
	}

	private schedule(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), DEBOUNCE);
	}

	private flush(): void {
		this.timer = undefined;
		if (!this.unrolls.size && !this.inserts.size && !this.moves.size && !this.pending.size && !this.texts.size && !this.removes.size && !this.variables.size) return;

		// Anything addressed through an element whose insert is still out waits for its name.
		const waits = (source: string | undefined): boolean => source !== undefined && this.inflight.has(source);
		// Inserts come in dependency order, so the one being waited for is seen before the one waiting.
		const ordered = this.orderedInserts();
		const heldInserts = new Map<string, InsertEdit>();
		const unnamed = (source: string | undefined): boolean => source !== undefined && (waits(source) || heldInserts.has(source));
		for (const insert of ordered) {
			if (unnamed(insert.parent) || unnamed(insert.before)) heldInserts.set(insert.source, insert);
		}
		const heldMoves = new Map([...this.moves].filter(([source, move]) => waits(source) || unnamed(move.parent) || unnamed(move.before)));
		const held = new Map([...this.pending].filter(([source]) => waits(source)));
		const heldTexts = new Map([...this.texts].filter(([source]) => waits(source)));
		const heldRemoves = new Set([...this.removes].filter(waits));
		const edits: SourceEdit[] = [
			// First: the copies an unroll makes are what the rest is addressed to.
			...[...this.unrolls.values()].map(({ kind, source, iterations }): SourceEdit => ({ kind, source, iterations })),
			...ordered
				.filter((insert) => !heldInserts.has(insert.source))
				.map(({ kind, source, parent, tag, props, before, text }): SourceEdit => ({
					kind,
					source,
					parent,
					tag,
					props,
					...(before === undefined ? {} : { before }),
					...(text === undefined ? {} : { text }),
				})),
			// After the inserts: a move may be into an element this same write adds.
			...[...this.moves.values()]
				.filter((move) => !heldMoves.has(move.source))
				.map(({ kind, source, parent, before }): SourceEdit => ({
					kind,
					source,
					parent,
					...(before === undefined ? {} : { before }),
				})),
			...[...new Set([...this.pending.keys(), ...this.texts.keys()])]
				.filter((source) => !held.has(source) && !heldTexts.has(source))
				.map((source): SourceEdit => ({
					kind: 'set',
					source,
					props: this.pending.get(source) ?? {},
					...(this.texts.has(source) ? { text: this.texts.get(source)! } : {}),
				})),
			// Last: cutting an unnamed element moves the positions of everything after it.
			...[...this.removes]
				.filter((source) => !heldRemoves.has(source))
				.map((source): SourceEdit => ({ kind: 'remove', source })),
			// Variables are addressed by name, so nothing above moves them.
			...[...this.variables.values()]
				.map(({ file, name, value }): SourceEdit => ({ kind: 'variable', file, name, value })),
		];
		if (!edits.length) return;

		this.sent = [...this.unrolls.values()];
		this.unrolls = new Map();
		this.variables = new Map();
		this.inflight = new Set([
			...[...this.inflight, ...this.inserts.keys()].filter((source) => !heldInserts.has(source)),
			...this.sent.flatMap((unroll) => pendingsOf(unroll)),
		]);
		this.inserts = heldInserts;
		this.moves = heldMoves;
		this.pending = held;
		this.texts = heldTexts;
		this.removes = heldRemoves;

		writeProject(this.dir, edits)
			.then((result) => this.report(result))
			.catch((error: unknown) => {
				toast.error(t('Could not write to the project'), { description: message(error) });
			});
	}

	/**
	 * An element must come after its parent and its `before` sibling, which have no name until written.
	 * Creation order covers trees built downwards, not a move folded into a waiting insert.
	 */
	private orderedInserts(): InsertEdit[] {
		const ordered: InsertEdit[] = [];
		const placed = new Set<string>();
		const waiting = [...this.inserts.values()];
		const owed = (source: string | undefined): boolean => source !== undefined && this.inserts.has(source) && !placed.has(source);

		// A pass that places nothing ends it: what is left waits on itself, and goes last rather than being dropped.
		for (let moved = true; moved && waiting.length; ) {
			moved = false;
			for (let index = 0; index < waiting.length; ) {
				const insert = waiting[index]!;
				if (owed(insert.parent) || owed(insert.before)) {
					index++;
					continue;
				}
				ordered.push(insert);
				placed.add(insert.source);
				waiting.splice(index, 1);
				moved = true;
			}
		}

		return [...ordered, ...waiting];
	}

	private report(result: WriteResult): void {
		if (result.error) {
			toast.error(t('Could not write to the project'), { description: result.error });
		}

		if (this.disposed) return;
		const ids = result.ids ?? {};
		const editor = getDocumentEditor(this.world);
		editor.restamp(ids);

		// The writer refuses to write into the loop source, so nothing owed to these below reaches the loop body.
		const restored = new Set<string>();
		const unrolled = new Set(result.unrolled ?? []);
		for (const unroll of this.sent) {
			if (unrolled.has(unroll.source)) continue;
			editor.unsettle(unroll);
			for (const pending of pendingsOf(unroll)) restored.add(pending);
		}
		this.sent = [];

		// Edits made under a pending name now belong to the real one, or to nothing if the file refused it.
		const rename = (source: string): string | undefined => (this.inflight.has(source) ? ids[source] : source);
		for (const source of [...this.pending.keys()]) {
			const next = rename(source);
			if (next === source) continue;
			const props = this.pending.get(source)!;
			this.pending.delete(source);
			if (next) this.pending.set(next, { ...this.pending.get(next), ...props });
		}
		for (const source of [...this.texts.keys()]) {
			const next = rename(source);
			if (next === source) continue;
			const text = this.texts.get(source)!;
			this.texts.delete(source);
			if (next) this.texts.set(next, text);
		}
		for (const [source, insert] of [...this.inserts]) {
			const parent = rename(insert.parent);
			if (parent === undefined) {
				// Its parent never made it into the file, so neither can it.
				this.inserts.delete(source);
				editor.discardPending(source);
				continue;
			}
			// An anchor that did not make it just means "last".
			const before = insert.before === undefined ? undefined : rename(insert.before);
			const { before: _, ...rest } = insert;
			this.inserts.set(source, { ...rest, parent, ...(before === undefined ? {} : { before }) });
		}
		for (const [source, move] of [...this.moves]) {
			const next = rename(source);
			const parent = rename(move.parent);
			// The insert's own discard takes the entity with it.
			if (next === undefined || parent === undefined) {
				this.moves.delete(source);
				continue;
			}
			const before = move.before === undefined ? undefined : rename(move.before);
			this.moves.delete(source);
			this.moves.set(next, { ...move, source: next, parent, ...(before === undefined ? {} : { before }) });
		}
		for (const source of [...this.removes]) {
			const next = rename(source);
			if (next === source) continue;
			this.removes.delete(source);
			// An element the file never had needs no removing from it.
			if (next) this.removes.add(next);
		}
		for (const source of this.inflight) {
			if (!ids[source] && !restored.has(source)) editor.discardPending(source);
		}
		this.inflight = new Set();

		if (this.inserts.size || this.moves.size || this.pending.size || this.texts.size || this.removes.size) this.schedule();
	}
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const pendingsOf = (unroll: UnrollEdit): string[] => {
	return unroll.iterations
		.flatMap((iteration) => Object.values(iteration)
			.flatMap(({ pending }) => (pending ? [pending] : [])));
}

/**
 * `world` is read only after a write, to re-stamp entities whose elements just got an `id`; otherwise the next
 * edit would address them by a position the write may have invalidated.
 */
export function createEditWriter(dir: string, world: World): EditWriter {
	return new EditWriter(dir, world);
}

export type { EditWriter };
