/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The colours of the site's cards, kept apart from the site so the dashboard
// can wear them too (its Plans cards, components/dashboard/plans-view.tsx).

import type { JSX } from "solid-js";

/**
 * The colours a card can take in place of grey, buffer.com's own: soft and
 * light, so the dark pieces of the product set on them stand out. Cards side
 * by side, and sections one after another, take different ones.
 */
export const CARD_COLORS = {
  green: "#b0ec9c",
  yellow: "#ffd88a",
  pink: "#f3bdff",
  teal: "#9feae2",
  coral: "#ffb2a8",
  lavender: "#d4c2ff",
  sky: "#9ed4ef",
  peach: "#ffbb8a",
  /** The brand's own blue, deep rather than soft: the hero's card alone, with white words on it. */
  royal: "#2563eb",
} as const;

export type CardColor = keyof typeof CARD_COLORS;

/** Each colour's deep shade, strong enough to mark a highlight on a white panel. */
export const CARD_DEEP: Record<CardColor, string> = {
  green: "#2f8a3e",
  yellow: "#a87400",
  pink: "#a03cbd",
  teal: "#0f8276",
  coral: "#cc4636",
  lavender: "#6747d6",
  sky: "#2b78c9",
  peach: "#bd5d17",
  royal: "#1e40af",
};

/** `a` taken `share` of the way to `b`, both #rrggbb. */
const mixHex = (a: string, b: string, share: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - share) + parseInt(b.slice(i, i + 2), 16) * share).toString(16).padStart(2, "0")).join("");

/** How far toward white a card's colour has gone by the card's bottom edge. */
const PALE = 0.7;

/**
 * Each colour's pale shade, the bottom of a card of it. The hero's card
 * spells the sky's out in its classes (HOME_CARD in lib/hero-shell.ts), so
 * its HTML copy paints it first: keep the two the same.
 */
export const CARD_PALE = Object.fromEntries(Object.entries(CARD_COLORS).map(([name, hex]) => [name, mixHex(hex, "#ffffff", PALE)])) as Record<CardColor, string>;

/**
 * A card's colour alone, for its pieces to be inked in, on a card whose own
 * classes draw its sky: the hero's (HOME_CARD), which a phone cuts shorter.
 */
export const cardInk = (color: CardColor): JSX.CSSProperties => ({
  "--card-color": CARD_COLORS[color],
  "--card-deep": CARD_DEEP[color],
});

/**
 * A card's style for one of the card colours, as the hero's card wears its
 * sky: the colour itself along the top, paler toward the bottom, plain and
 * still.
 */
export const cardColor = (color: CardColor): JSX.CSSProperties => ({
  ...cardInk(color),
  "background-color": "var(--card-color)",
  "background-image": `linear-gradient(to bottom, ${CARD_COLORS[color]}, ${CARD_PALE[color]})`,
});

/**
 * A card's style in a colour's pale shade alone, the tone a card of it ends
 * on: for the quiet tiles under a job's card on the homepage, which take the
 * card's colour without its weight, their pieces inked in it all the same.
 */
export const cardPale = (color: CardColor): JSX.CSSProperties => ({
  ...cardInk(color),
  "background-color": CARD_PALE[color],
});
