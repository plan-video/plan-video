/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// YouTube's branding rules, checked by Google's API compliance review: red with the
// white play, never recoloured, greyed, faded or over a picture, at least 20 high.
// Every place that marks YouTube draws it from here.

import { tileViewBox } from "@/components/brand/tile-box";
import { cx } from "@/lib/cva";

export const YOUTUBE_ICON_BOX = "0 0 28.5701 20";
export const YOUTUBE_ICON_RED =
  "M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z";
export const YOUTUBE_ICON_PLAY = "M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z";

export const YOUTUBE_ICON_SVG = `<svg viewBox="${YOUTUBE_ICON_BOX}" height="20" aria-hidden="true"><path fill="#FF0000" d="${YOUTUBE_ICON_RED}"/><path fill="#FFFFFF" d="${YOUTUBE_ICON_PLAY}"/></svg>`;

/** How much the site shrinks pictures holding the icon, so it can grow back to 20 high. */
const SHOWN = "var(--picture-scale, 1) / var(--fit-scale, 1)";

const TILE_LOOK = /^(?:[a-z-]+:)*(?:rounded|ring|inset-ring|bg-|overflow-|grid$|place-)/;

/**
 * Bare and 20 high however small the tiles beside it (the brand's 20dp minimum,
 * required by Google's review). Keeps the tile's height in the layout so rows
 * don't grow, and stands out of it above and below.
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
        // A margin's percentage is of the width, so this is half the icon's height.
        // The box is a whole 29 wide on its own layer so it lands on whole pixels: on a
        // fraction of one the icon's flat sides came out soft on one side and read as cut off.
        style={{ "aspect-ratio": "28.5701 / 20", "margin-top": "-35.0016%" }}
        aria-hidden="true"
      >
        <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
        <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
      </svg>
    </span>
  );
}

const TILE_BOX = { fit: tileViewBox(YOUTUBE_ICON_BOX, 0.76), fill: tileViewBox(YOUTUBE_ICON_BOX, 0.92) };

/** The hairline is forced because the light themes swap black and white. */
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

const BARE_BOX = tileViewBox(YOUTUBE_ICON_BOX, 1);

export function YouTubeBare(props: { class?: string; title?: string }) {
  return (
    <svg viewBox={BARE_BOX} class={cx("shrink-0", props.class)} role={props.title ? "img" : undefined} aria-label={props.title} aria-hidden={props.title ? undefined : "true"}>
      <path fill="#FF0000" d={YOUTUBE_ICON_RED} />
      <path fill="#FFFFFF" d={YOUTUBE_ICON_PLAY} />
    </svg>
  );
}

/**
 * The same area as a square tile (1.2 times its width): at the tile's width it
 * read smaller than the other logos. `class` is the tile's; its height sets the size.
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
