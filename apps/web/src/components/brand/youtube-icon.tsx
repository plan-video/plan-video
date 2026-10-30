/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// YouTube's own icon, the way its branding guidelines allow it: red with the
// white play, never recoloured, greyed, faded or laid over a picture, and on
// a single solid colour. Google's API compliance review checks this
// (2026-10-22), so every place that marks YouTube draws this one, and at
// least 20 high, the brand's minimum (asked for again 2026-10-27). Where the
// dashboard and the site's mockups show the other networks' logo tiles,
// YouTube's icon stands bare in their place (YouTubeSlot), never on a tile.

import { tileViewBox } from "@/components/brand/tile-box";
import { cx } from "@/lib/cva";

/** The icon's box, 10 wide for 7 high. */
export const YOUTUBE_ICON_BOX = "0 0 28.5701 20";
export const YOUTUBE_ICON_RED =
  "M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z";
export const YOUTUBE_ICON_PLAY = "M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z";

/** The icon as an inline SVG string, for HTML that isn't drawn by Solid (the hero films). */
export const YOUTUBE_ICON_SVG = `<svg viewBox="${YOUTUBE_ICON_BOX}" height="20" aria-hidden="true"><path fill="#FF0000" d="${YOUTUBE_ICON_RED}"/><path fill="#FFFFFF" d="${YOUTUBE_ICON_PLAY}"/></svg>`;

/**
 * How much the pictures holding the icon are shrunk on screen: the site draws some
 * of the product at its own size and scales it to fit (Fit, the changelog's
 * pictures), and these say by how much, so the icon can grow back to 20 high.
 */
const SHOWN = "var(--picture-scale, 1) / var(--fit-scale, 1)";

/** What a logo tile's classes say about its look rather than its place; YouTube's icon stands bare, so it drops these. */
const TILE_LOOK = /^(?:[a-z-]+:)*(?:rounded|ring|inset-ring|bg-|overflow-|grid$|place-)/;

/**
 * YouTube's icon where another network would show its logo tile:
 * bare, and 20 high however small the tiles beside it, since the brand's
 * minimum is 20dp and Google's API compliance review asked for it on every
 * screen (2026-10-27). It keeps the tile's height in the layout, so rows
 * don't grow, and stands out of it above and below. A tile wider than the
 * icon at that height (29, the icon's 28.57 to a whole pixel) gets the icon at its full width, as the other
 * networks' tiles fill theirs. `class` is the tile's, size and place. Inside
 * a picture the site has shrunk, it grows back to 20 high on screen.
 */
export function YouTubeSlot(props: { class?: string; title?: string }) {
  const place = () =>
    props.class
      ?.split(/\s+/)
      .filter((name) => !TILE_LOOK.test(name))
      .join(" ") ?? "";
  // A tile sized by its width alone (`aspect-square w-full`) keeps that, rather than the 20 a bare slot gets.
  const sized = () => /(?:^|\s)(?:[a-z-]+:)*(?:size|w|h|aspect)-/.test(place());
  return (
    <span data-youtube-slot title={props.title} class={cx("relative block shrink-0", !sized() && "size-5", place())} style={{ "min-width": `calc(29px / ${SHOWN})` }}>
      <svg
        viewBox={YOUTUBE_ICON_BOX}
        class="absolute inset-x-0 top-1/2 h-auto w-full overflow-visible will-change-transform"
        // A margin's percentage is of the width, so this is half the icon's height: centred, at whatever width.
        // The box is a whole 29 wide (the icon is 28.57 at 20 high) and drawn on a layer of its own, which lands on
        // whole pixels: placed on a fraction of one, the icon's flat sides came out soft on one side and sharp on the
        // other, and read as cut off (2026-10-27). Unclipped, so no soft edge is shaved either.
        style={{ "aspect-ratio": "28.5701 / 20", "margin-top": "-35.0016%" }}
        aria-hidden="true"
      >
        <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
        <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
      </svg>
    </span>
  );
}

/** The icon at 76% of a square tile's width, or 92% for `fill`, in a box the tile's size (see brand/tile-box). */
const TILE_BOX = { fit: tileViewBox(YOUTUBE_ICON_BOX, 0.76), fill: tileViewBox(YOUTUBE_ICON_BOX, 0.92) };

/**
 * YouTube's icon at 76% of a white tile the size of the other networks' (and
 * a forced hairline, as the light themes swap black and white), or 92% for
 * `fill`, on a tile too small to read it otherwise. Drawn only where the user
 * chose it (2026-10-27): the homepage networks section's Post to tiles, big
 * enough that the icon is over 20 high, and its phone labels; and, small, in
 * the dashboard's calendar chips, analytics' account list, the account groups' chips, the posts list and analytics, where a 20-high icon can't sit among the
 * other logos (asked of Google's review in the same reply).
 */
export function YouTubeWhiteTile(props: { class?: string; fill?: boolean }) {
  return (
    <span title="YouTube" class={cx("grid shrink-0 place-items-center overflow-hidden ring-1 ring-[#00000024]! ring-inset", props.class)} style={{ background: "#FFFFFF" }}>
      <svg viewBox={props.fill ? TILE_BOX.fill : TILE_BOX.fit} class="size-full" aria-hidden="true">
        <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
        <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
      </svg>
    </span>
  );
}

/** The icon alone across the full width of a square box. */
const BARE_BOX = tileViewBox(YOUTUBE_ICON_BOX, 1);

/**
 * YouTube's icon alone, red with its white play and no tile, as wide as the
 * other networks' logo tiles beside it (so 16 wide and about 11 high at size-4).
 * Drawn where the user asked for exactly that (2026-10-27): the Schedule
 * sidebar's account list and the calendar's account chip, where the 20-high
 * icon was "way too massive". `class` is the tile's size and place.
 */
export function YouTubeBare(props: { class?: string; title?: string }) {
  return (
    <svg viewBox={BARE_BOX} class={cx("shrink-0", props.class)} role={props.title ? "img" : undefined} aria-label={props.title} aria-hidden={props.title ? undefined : "true"}>
      <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
      <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
    </svg>
  );
}

/**
 * YouTube's icon alone where the site draws the other networks' square logo
 * tiles, sized to look as big as them: as tall as the tile's height allows at
 * the same area as the square (1.2 times its width, so about 17 by 12 beside
 * a 14px tile). At the tile's width it read smaller than TikTok's beside it,
 * and a white tile vanished on the light theme's white page (2026-10-29).
 * `class` is the tile's; its height sets the size and the width follows.
 */
export function YouTubeMatched(props: { class?: string }) {
  return (
    <span title="YouTube" class={cx("block shrink-0", props.class)} style={{ width: "auto", "aspect-ratio": "6 / 5", background: "none" }}>
      <svg viewBox={YOUTUBE_ICON_BOX} class="size-full overflow-visible" aria-hidden="true">
        <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
        <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
      </svg>
    </span>
  );
}

export function YouTubeIcon(props: { class?: string; label?: boolean }) {
  return (
    <svg
      data-youtube-slot
      viewBox={YOUTUBE_ICON_BOX}
      class={cx("w-auto shrink-0 overflow-visible", props.class)}
      style={{ height: `calc(20px / ${SHOWN})` }}
      role={props.label ? "img" : undefined}
      aria-label={props.label ? "YouTube" : undefined}
      aria-hidden={props.label ? undefined : "true"}
    >
      <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
      <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
    </svg>
  );
}
