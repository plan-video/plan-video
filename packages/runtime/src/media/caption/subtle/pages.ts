/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Subtle's paging (scripts/group.py) and rule-picked highlights (scripts/emphasis.py), without beats or cuts.

import type { PageRules, SPage, SWord } from './engine';

export type TimedWord = { text: string; startMs: number; endMs: number; color?: string; forced?: boolean };

const SENTENCE_END = /[.!?…]['")\]]*$/;
const CLAUSE_END = /[,;:–—]['")\]]*$/;

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

const WEAK_END = words(`a an the of to in on at for from with by and or but nor so as if than that this these those my your his
her its our their is are was were be been am i'm it's we're you're they're i you we he she they not no very just`);
const STOP = new Set([...WEAK_END, ...words(`it there here what when where who how why which do does did have has had will would can could should
may might must also then now about into over under up down out off again more most some any all each every`)]);
const NUMBER_WORDS = words(`two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty
ninety dozen dozens hundred hundreds thousand thousands million millions billion billions trillion half double twice triple zero`);
const CONTRAST = words(`never nothing nobody none free broke zero always worst best biggest first only wrong secret impossible
banned illegal dead`);
const NOT_NAMES = words(`i i'm i'll i've i'd ok okay yes no hi hello hey so and but well now actually maybe monday tuesday wednesday
thursday friday saturday sunday`);
const DULL = words(`that's there's what's actually really basically literally something anything everything someone anyone
everyone thing things saying said going being having doing getting making because through before after between
together another other others always maybe quite rather though although while where which their there these those
people person today tomorrow yesterday`);

/** Plain pages stay this long after their last word; a highlighted one a beat longer. */
export const HOLD_MS = 400;
export const EMPHASIS_HOLD_MS = 700;

export const bare = (text: string) => text.replace(/[^\p{L}\p{N}_']+/gu, '').toLowerCase();
const capitalised = (text: string) => {
	const first = text.replace(/^["'“‘(]+/, '').charAt(0);
	return first !== first.toLowerCase() && first === first.toUpperCase();
};

/** Splits a page into as few even lines as fit, preferring breaks after punctuation and never after "the". */
export function splitLines(page: readonly { text: string }[], maxChars: number, maxLines: number): number[] {
	const texts = page.map((w) => w.text);
	const n = texts.length;
	if (maxLines < 2 || n < 2 || texts.join(' ').length <= maxChars) return texts.map(() => 0);

	const score = (cuts: number[]) => {
		const bounds = [0, ...cuts, n];
		const lens = bounds.slice(1).map((b, i) => texts.slice(bounds[i], b).join(' ').length);
		let sc = Math.max(...lens) - Math.min(...lens) + lens.filter((v) => v > maxChars).length * 1000;
		for (const k of cuts) {
			const before = texts[k - 1]!;
			if (CLAUSE_END.test(before) || SENTENCE_END.test(before)) sc -= 3;
			if (WEAK_END.has(bare(before))) sc += 4;
		}
		return sc;
	};
	const combos = (from: number, count: number): number[][] => {
		if (count === 0) return [[]];
		const out: number[][] = [];
		for (let k = from; k < n; k++) for (const rest of combos(k + 1, count - 1)) out.push([k, ...rest]);
		return out;
	};

	let best: number[] = [];
	for (let lines = 2; lines <= Math.min(maxLines, n); lines++) {
		let bestScore = Infinity;
		for (const cuts of combos(1, lines - 1)) {
			const sc = score(cuts);
			if (sc < bestScore) {
				bestScore = sc;
				best = cuts;
			}
		}
		if (bestScore < 500) break;
	}
	let line = 0;
	return texts.map((_, k) => {
		if (line < best.length && k === best[line]) line++;
		return line;
	});
}

/** `holdMs`: how long a page stays after its last word; unset, the style's own hold. */
export function groupPages(list: readonly TimedWord[], rules: PageRules, wide: boolean, holdMs?: number): SPage[] {
	const maxWords = rules.maxWords ?? 3;
	const maxLines = rules.maxLines ?? 1;
	const perLine = (wide ? rules.maxCharsPerLineWide : rules.maxCharsPerLine) ?? (wide ? 30 : 18);
	const maxChars = perLine * maxLines;
	const gapBreak = rules.gapBreakMs ?? 350;
	const minMs = ((rules.minFrames ?? 10) * 1000) / 30;
	const maxMs = ((rules.maxFrames ?? 90) * 1000) / 30;
	const textLen = (ws: readonly TimedWord[]) => ws.map((w) => w.text).join(' ').length;

	let phrases: TimedWord[][] = [];
	let current: TimedWord[] = [];
	for (const w of list) {
		const prev = current[current.length - 1];
		if (prev && (SENTENCE_END.test(prev.text) || CLAUSE_END.test(prev.text) || w.startMs - prev.endMs > gapBreak)) {
			phrases.push(current);
			current = [];
		}
		current.push(w);
	}
	if (current.length) phrases.push(current);

	const merged: TimedWord[][] = [];
	for (const phrase of phrases) {
		const last = merged[merged.length - 1];
		if (last && last.length === 1 && !SENTENCE_END.test(last[0]!.text)
			&& phrase[0]!.startMs - last[0]!.endMs <= gapBreak && phrase.length + 1 <= maxWords
			&& textLen([...last, ...phrase]) <= maxChars) {
			merged[merged.length - 1] = [...last, ...phrase];
		} else {
			merged.push(phrase);
		}
	}
	phrases = merged;

	const fits = (c: readonly TimedWord[]) =>
		c.length === 1 || (c.length <= maxWords && textLen(c) <= maxChars && c[c.length - 1]!.endMs - c[0]!.startMs <= maxMs);

	const pages: TimedWord[][] = [];
	for (const phrase of phrases) {
		const n = Math.max(1, Math.ceil(phrase.length / maxWords));
		const base = Math.floor(phrase.length / n);
		const extra = phrase.length % n;
		let chunks: TimedWord[][] = [];
		let at = 0;
		for (let k = 0; k < n; k++) {
			const size = base + (k < extra ? 1 : 0);
			chunks.push(phrase.slice(at, at + size));
			at += size;
		}
		if (!chunks.every(fits)) {
			chunks = [];
			let cur: TimedWord[] = [];
			for (const w of phrase) {
				if (cur.length && !fits([...cur, w])) {
					chunks.push(cur);
					cur = [];
				}
				cur.push(w);
			}
			if (cur.length) chunks.push(cur);
			const last = chunks[chunks.length - 1]!;
			const before = chunks[chunks.length - 2];
			if (before && last.length === 1 && before.length > 2 && fits([before[before.length - 1]!, ...last])) {
				last.unshift(before.pop()!);
			}
		}
		for (let k = 0; k < chunks.length - 1; k++) {
			const c = chunks[k]!;
			const next = chunks[k + 1]!;
			if (c.length > 1 && WEAK_END.has(bare(c[c.length - 1]!.text)) && !WEAK_END.has(bare(c[c.length - 2]!.text)) && fits([c[c.length - 1]!, ...next])) {
				next.unshift(c.pop()!);
			}
		}
		pages.push(...chunks.filter((c) => c.length));
	}

	const out = pages.map((p): SPage => {
		const lines = splitLines(p, perLine, maxLines);
		return {
			startMs: p[0]!.startMs,
			endMs: p[p.length - 1]!.endMs,
			words: p.map((w, i): SWord => ({
				text: w.text,
				startMs: w.startMs,
				endMs: w.endMs,
				line: lines[i]!,
				emphasis: w.forced === true,
				...(w.color ? { color: w.color } : {}),
			})),
		};
	});
	pickEmphasis(out);
	setPageEnds(out, minMs, holdMs);
	return out;
}

/** A page ends when the next starts, or a hold after its last word; one too short to read stays a while. */
function setPageEnds(pages: SPage[], minMs: number, holdMs?: number): void {
	pages.forEach((page, i) => {
		const last = page.words[page.words.length - 1]!.endMs;
		const next = pages[i + 1]?.startMs;
		const hold = holdMs ?? (page.words.some((w) => w.emphasis) ? EMPHASIS_HOLD_MS : HOLD_MS);
		let end = last + hold;
		if (next !== undefined) end = Math.min(end, next);
		if (end - page.startMs < minMs) end = next !== undefined ? Math.min(page.startMs + minMs, next) : page.startMs + minMs;
		page.endMs = Math.max(end, next === undefined ? last : Math.min(last, next));
	});
}

function numberKind(text: string): 'price' | 'percentage' | 'year' | 'number' | null {
	const core = text.replace(/^[^\p{L}\p{N}_$₹€£]+|[^\p{L}\p{N}_%]+$/gu, '');
	if (!core) return null;
	if (/[$₹€£]/.test(core)) return 'price';
	if (!/\d/.test(core)) return null;
	if (core.endsWith('%')) return 'percentage';
	if (/^(1[5-9]|20)\d\d$/.test(core)) return 'year';
	return 'number';
}

const NUMBER_SCORES = { price: 10, percentage: 9.6, year: 9.2, number: 9 } as const;

function classify(flat: readonly SWord[], i: number, names: ReadonlySet<string>): [number, string | null] {
	const text = flat[i]!.text;
	const b = bare(text);
	if (!b) return [0, null];
	const kind = numberKind(text);
	if (kind) return [NUMBER_SCORES[kind], kind];
	if (STOP.has(b) && !CONTRAST.has(b)) return [0, null];
	const letters = text.replace(/[^A-Za-zÀ-ɏ]/g, '');
	if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !NOT_NAMES.has(b)) return [7.5, 'name'];
	if (capitalised(text) && !NOT_NAMES.has(b) && b.length > 1) {
		const start = i === 0 || SENTENCE_END.test(flat[i - 1]!.text);
		const stem = b.endsWith("'s") ? b.slice(0, -2) : b;
		if (!start || names.has(stem)) return [7, 'name'];
	}
	if (CONTRAST.has(b)) return [6, 'contrast'];
	if (NUMBER_WORDS.has(b)) return [5.5, 'count'];
	return [0, null];
}

function guessScore(text: string): number {
	const b = bare(text);
	if (!b || STOP.has(b) || DULL.has(b) || b.length < 4) return 0;
	return Math.min(b.length, 10) / 2 + (SENTENCE_END.test(text) ? 1 : 0);
}

/** Numbers first, then names, contrast words and counts; one highlight a page, two on pages of five words or more. */
export function pickEmphasis(pages: SPage[]): void {
	const flat = pages.flatMap((p) => p.words);
	const stem = (text: string) => {
		const b = bare(text);
		return b.endsWith("'s") ? b.slice(0, -2) : b;
	};
	const names = new Set<string>();
	flat.forEach((w, i) => {
		const b = bare(w.text);
		if (i && !SENTENCE_END.test(flat[i - 1]!.text) && capitalised(w.text) && !NOT_NAMES.has(b) && !STOP.has(b)) names.add(stem(w.text));
	});

	const seen = new Map<string, number>();
	let at = 0;
	let quiet = 1;
	for (const page of pages) {
		const ws = page.words;
		const slots = ws.length >= 5 ? 2 : 1;
		let used = ws.filter((w) => w.emphasis).length;
		if (used < slots) {
			const cands: { score: number; j: number; reason: string }[] = [];
			ws.forEach((w, j) => {
				if (w.emphasis) return;
				let [score, reason] = classify(flat, at + j, names);
				if (!reason) return;
				if (!numberKind(w.text)) score -= 2 * (seen.get(stem(w.text)) ?? 0);
				if (score >= 5) cands.push({ score, j, reason });
			});
			cands.sort((a, b) => b.score - a.score || a.j - b.j);
			for (const { j, reason } of cands) {
				if (used >= slots) break;
				if (ws[j]!.emphasis) continue;
				ws[j]!.emphasis = true;
				used++;
				const next = ws[j + 1];
				if (reason === 'name' && next && !next.emphasis && !SENTENCE_END.test(ws[j]!.text) && classify(flat, at + j + 1, names)[1] === 'name') {
					next.emphasis = true;
				}
			}
			if (used === 0 && quiet >= 2) {
				let best = -1;
				let bestScore = 0;
				ws.forEach((w, j) => {
					const score = guessScore(w.text);
					if (score > bestScore) {
						bestScore = score;
						best = j;
					}
				});
				if (best !== -1 && bestScore >= 4 && !seen.get(stem(ws[best]!.text))) ws[best]!.emphasis = true;
			}
		}
		let hit = false;
		for (const w of ws) {
			if (!w.emphasis) continue;
			seen.set(stem(w.text), (seen.get(stem(w.text)) ?? 0) + 1);
			hit = true;
		}
		quiet = hit ? 0 : quiet + 1;
		at += ws.length;
	}
}

/** The page on screen at `ms`, or -1. */
export function pageAt(pages: readonly SPage[], ms: number): number {
	let lo = 0;
	let hi = pages.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const page = pages[mid]!;
		if (ms < page.startMs) hi = mid - 1;
		else if (ms >= page.endMs) lo = mid + 1;
		else return mid;
	}
	return -1;
}
