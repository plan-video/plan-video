/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The killfeed panels' feed: several kills built in one go. The stage shows
// them stacked the way they land, the numbered cells under it pick the one
// the settings edit (the + copies it in under), and one add puts them all
// on the video, each a second after the one before.

import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { createFeed, drawEvenFeed, MAX_FEED_ENTRIES, plain, type Feed } from "@/lib/killfeed-feed";
import { t } from "@/lib/i18n";
import { Section } from "./extension-ui";

/** The seconds from one of a feed's kills coming in to the next. */
const SPACING = 1;

/** A feed and the seconds from one of its kills coming in to the next. */
export type KillfeedFeed<T> = Feed<T> & { spacing: () => number };

/** Made once per panel, so the feed outlives a tab switch. */
export function createKillfeedFeed<T extends object>(first: T): KillfeedFeed<T> {
  return { ...createFeed(first), spacing: () => SPACING };
}

/** What the add button says: how many kills go in. */
export const addLabel = (feed: { entries: () => unknown[] }) => {
  const count = feed.entries().length;
  return count > 1 ? t("{count, plural, one {Add # kill to scene} other {Add # kills to scene}}", { count }) : undefined;
};

/** The feed as one drag: every kill, how they land, and how far apart they come in. */
export const feedDrag = <T,>(feed: KillfeedFeed<T>, placement: object) => ({
  specs: plain(feed.entries()),
  placement: plain(placement),
  spacing: feed.spacing(),
});

/** One entry's height at most, as the stage held a single one before feeds. */
const ROW = 56;
/** The feed's height at most: past it, the entries shrink together. */
const ROOM = 156;
const GAP = 4;
const PAD = 12;

type Drawn = { url: string; width: number; height: number };

/**
 * The feed over the game's dark, the way it sits on gameplay: lined up on
 * the layout's edge (`align`), and bottom-up for a feed that grows upwards
 * (`upwards`), so it reads as it will land, every entry one size as they
 * are placed (`drawEvenFeed`, against `usual`). With several, a click on one
 * edits it, and that one is outlined. Drag it onto the video.
 */
export function FeedStage<T>(props: {
  feed: Feed<T>;
  background: string;
  /** Draws an entry at a scale, in a width at its natural size when given one. */
  draw: (entry: T, scale: number, width?: number) => Promise<HTMLCanvasElement>;
  /** An entry with names of a usual length, the narrowest one is drawn. */
  usual: T;
  /** The scale the stage draws entries at. */
  scale: number;
  align: "left" | "right";
  upwards?: boolean;
  onDragStart: (event: DragEvent) => void;
}) {
  const [pictures, setPictures] = createSignal<Drawn[]>([]);
  const [room, setRoom] = createSignal(0);
  let version = 0;

  createEffect(() => {
    const entries = plain(props.feed.entries());
    const mine = ++version;
    drawEvenFeed(entries, props.draw, props.usual, props.scale)
      .then((drawn) => {
        if (mine === version) setPictures(drawn.map((canvas) => ({ url: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height })));
      })
      .catch(() => {});
  });

  /** One scale for every entry, so they keep their sizes to each other. */
  const zoom = () => {
    const list = pictures();
    if (!list.length || !room()) return 0;
    const widest = Math.max(...list.map((picture) => picture.width));
    const tallest = Math.max(...list.map((picture) => picture.height));
    const heights = list.reduce((sum, picture) => sum + picture.height, 0);
    return Math.min(room() / widest, ROW / tallest, (ROOM - GAP * (list.length - 1)) / heights);
  };

  const several = () => pictures().length > 1;

  let box!: HTMLDivElement;
  const observer = new ResizeObserver(() => setRoom(Math.max(0, box.clientWidth - 2 * PAD)));
  onMount(() => observer.observe(box));
  onCleanup(() => observer.disconnect());

  return (
    <div class="sticky top-0 z-10 bg-background px-3 pb-3 pt-3">
      <div
        ref={box}
        draggable={true}
        onDragStart={(event) => props.onDragStart(event)}
        class="group relative flex min-h-20 cursor-grab flex-col justify-center overflow-hidden rounded-md border border-border active:cursor-grabbing"
        classList={{ "items-end": props.align === "right", "items-start": props.align === "left", "flex-col-reverse": !!props.upwards }}
        style={{ background: props.background, padding: `${PAD}px`, gap: `${GAP}px` }}
      >
        <For each={pictures()}>
          {(picture, index) => {
            const size = () => ({ width: `${picture.width * zoom()}px`, height: `${picture.height * zoom()}px` });
            return (
              <Show
                when={several()}
                fallback={<img src={picture.url} alt={t("Killfeed preview")} draggable={false} class="pointer-events-none block max-w-full" style={size()} />}
              >
                <button
                  type="button"
                  aria-label={t("Kill {n}", { n: index() + 1 })}
                  aria-pressed={index() === props.feed.selected()}
                  class="block shrink-0 rounded-[2px] outline-offset-2 focus-ring"
                  classList={{ "outline outline-1 outline-white/70": index() === props.feed.selected() }}
                  style={size()}
                  onClick={() => props.feed.select(index())}
                >
                  <img src={picture.url} alt="" draggable={false} class="pointer-events-none block size-full" />
                </button>
              </Show>
            );
          }}
        </For>
        <span class="pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-0.5 rounded-sm bg-black/60 px-1.5 py-px text-[10px] text-white/70 opacity-0 transition-opacity group-hover:opacity-100">
          <Icon name="move-small" class="size-3.5" />
          {t("Drag onto the video")}
        </span>
      </div>
    </div>
  );
}

/**
 * The kills in the feed, top to bottom, as numbered cells and one to add
 * another (a copy of the one picked, which `next` may move on, as a streak
 * counts up); the picked one is what the settings below edit.
 */
export function FeedField<T>(props: { feed: KillfeedFeed<T>; next?: (copy: T) => void }) {
  const count = () => props.feed.entries().length;
  const picked = (index: number) => index === props.feed.selected();

  return (
    <Section
      label={t("Killfeed")}
      action={
        <Show when={count() > 1}>
          <button
            type="button"
            title={t("Remove kill {n}", { n: props.feed.selected() + 1 })}
            class="flex h-5 items-center gap-0.5 rounded-sm pr-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
            onClick={() => props.feed.remove()}
          >
            <Icon name="close-remove-small" class="size-4" />
            {t("Remove")}
          </button>
        </Show>
      }
    >
      <div role="radiogroup" aria-label={t("Killfeed")} class="grid gap-1" style={{ "grid-template-columns": `repeat(${MAX_FEED_ENTRIES}, minmax(0, 1fr))` }}>
        <For each={props.feed.entries()}>
          {(_, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={picked(index())}
              aria-label={t("Kill {n}", { n: index() + 1 })}
              class="h-7 rounded-md text-xs tabular-nums transition-colors focus-ring"
              classList={{
                "bg-secondary-hover font-450 text-foreground": picked(index()),
                "bg-accent text-muted-foreground hover:text-foreground": !picked(index()),
              }}
              onClick={() => props.feed.select(index())}
            >
              {index() + 1}
            </button>
          )}
        </For>
        <Show when={count() < MAX_FEED_ENTRIES}>
          <button
            type="button"
            aria-label={t("Add a kill")}
            title={t("Add a kill")}
            class="grid h-7 place-items-center rounded-md bg-accent text-muted-foreground transition-colors hover:text-foreground focus-ring"
            onClick={() => props.feed.add(props.next)}
          >
            <Icon name="plus-add" />
          </button>
        </Show>
      </div>
    </Section>
  );
}
