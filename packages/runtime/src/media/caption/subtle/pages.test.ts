/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { EMPHASIS_HOLD_MS, HOLD_MS, groupPages, pageAt } from './pages';

import type { TimedWord } from './pages';

/** Words 300 ms apart, each said for 250 ms. */
const said = (text: string, from = 0): TimedWord[] =>
	text.split(' ').map((word, i) => ({ text: word, startMs: from + i * 300, endMs: from + i * 300 + 250 }));

const rules = { maxWords: 3, maxCharsPerLine: 30, maxLines: 1, gapBreakMs: 350 };
const texts = (pages: ReturnType<typeof groupPages>) => pages.map((p) => p.words.map((w) => w.text).join(' '));

describe('groupPages', () => {
	it('never shows a word before it is said, and pages never overlap', () => {
		const pages = groupPages(said('India has tried to break up with gold three times'), rules, false);
		for (const [i, page] of pages.entries()) {
			expect(page.startMs).toBe(page.words[0]!.startMs);
			const next = pages[i + 1];
			if (next) expect(page.endMs).toBeLessThanOrEqual(next.startMs);
		}
		expect(texts(pages).join(' ')).toBe('India has tried to break up with gold three times');
	});

	it('does not end a page on a weak word when the phrase goes on', () => {
		const pages = groupPages(said('we went to the big old market'), rules, false);
		for (const page of pages.slice(0, -1)) expect(['the', 'to', 'a']).not.toContain(page.words.at(-1)!.text);
	});

	it('breaks at a sentence end and at a pause', () => {
		const pages = groupPages([...said('Gold won.'), ...said('Hi there', 2000)], { ...rules, maxWords: 6 }, false);
		expect(texts(pages)).toEqual(['Gold won.', 'Hi there']);
	});

	it('holds a highlighted page longer than a plain one', () => {
		const plain = groupPages(said('we went home'), rules, false)[0]!;
		const priced = groupPages(said('it cost $5,000'), rules, false)[0]!;
		expect(plain.endMs).toBe(plain.words.at(-1)!.endMs + HOLD_MS);
		expect(priced.endMs).toBe(priced.words.at(-1)!.endMs + EMPHASIS_HOLD_MS);
	});

	it('highlights numbers first, then names, one a page', () => {
		const pages = groupPages(said('Meera paid 40% more'), { ...rules, maxWords: 4 }, false);
		const hot = pages.flatMap((p) => p.words.filter((w) => w.emphasis).map((w) => w.text));
		expect(hot).toEqual(['40%']);
	});

	it('keeps a word the author coloured as the highlight', () => {
		const words = said('we went home');
		words[1] = { ...words[1]!, forced: true, color: '#FF0000' };
		const page = groupPages(words, rules, false)[0]!;
		expect(page.words.map((w) => w.emphasis)).toEqual([false, true, false]);
		expect(page.words[1]!.color).toBe('#FF0000');
	});

	it('takes the author’s linger over the style’s hold', () => {
		const page = groupPages(said('we went home'), rules, false, 1000)[0]!;
		expect(page.endMs).toBe(page.words.at(-1)!.endMs + 1000);
	});
});

describe('pageAt', () => {
	it('finds the page on screen and nothing in a gap', () => {
		const pages = groupPages([...said('Gold won.'), ...said('Hi there', 3000)], rules, false);
		expect(pageAt(pages, 100)).toBe(0);
		expect(pageAt(pages, 2500)).toBe(-1);
		expect(pageAt(pages, 3000)).toBe(1);
	});
});
