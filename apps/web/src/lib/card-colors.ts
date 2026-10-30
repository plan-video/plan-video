/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Kept apart from the site so the dashboard can use them too (components/dashboard/plans-view.tsx).

import type { JSX } from "solid-js";

export const CARD_COLORS = {
  green: "#b0ec9c",
  yellow: "#ffd88a",
  pink: "#f3bdff",
  teal: "#9feae2",
  coral: "#ffb2a8",
  lavender: "#d4c2ff",
  sky: "#9ed4ef",
  peach: "#ffbb8a",
  /** The hero's card alone, with white words on it. */
  royal: "#2563eb",
} as const;

export type CardColor = keyof typeof CARD_COLORS;

/** Strong enough to mark a highlight on a white panel. */
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

const mixHex = (a: string, b: string, share: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - share) + parseInt(b.slice(i, i + 2), 16) * share).toString(16).padStart(2, "0")).join("");

/** How far toward white a card's colour has gone by its bottom edge. */
const PALE = 0.7;

/** HOME_CARD in lib/hero-shell.ts spells the hero's sky out in its classes for the HTML copy: keep the two the same. */
export const CARD_PALE = Object.fromEntries(Object.entries(CARD_COLORS).map(([name, hex]) => [name, mixHex(hex, "#ffffff", PALE)])) as Record<CardColor, string>;

/** For a card whose own classes draw its sky: the hero's (HOME_CARD), which a phone cuts shorter. */
export const cardInk = (color: CardColor): JSX.CSSProperties => ({
  "--card-color": CARD_COLORS[color],
  "--card-deep": CARD_DEEP[color],
});

export const cardColor = (color: CardColor): JSX.CSSProperties => ({
  ...cardInk(color),
  "background-color": "var(--card-color)",
  "background-image": `linear-gradient(to bottom, ${CARD_COLORS[color]}, ${CARD_PALE[color]})`,
});

export const cardPale = (color: CardColor): JSX.CSSProperties => ({
  ...cardInk(color),
  "background-color": CARD_PALE[color],
});
