/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { createFeed, drawEvenFeed, MAX_FEED_ENTRIES, plain, type Feed } from "@/lib/killfeed-feed";
import { t } from "@/lib/i18n";
import { Section } from "./extension-ui";

const SPACING = 1;

export type KillfeedFeed<T> = Feed<T> & { spacing: () => number };

/** Made once per panel, so the feed outlives a tab switch. */
export function createKillfeedFeed<T extends object>(first: T): KillfeedFeed<T> {
  return { ...createFeed(first), spacing: () => SPACING };
}

export const addLabel = (feed: { entries: () => unknown[] }) => {
  const count = feed.entries().length;
  return count > 1 ? t("{count, plural, one {Add # kill to scene} other {Add # kills to scene}}", { count }) : undefined;
};

export const feedDrag = <T,>(feed: KillfeedFeed<T>, placement: object) => ({
  specs: plain(feed.entries()),
  placement: plain(placement),
  spacing: feed.spacing(),
});

const ROW = 56;
const ROOM = 156;
const GAP = 4;
const PAD = 12;

type Drawn = { url: string; width: number; height: number };

export function FeedStage<T>(props: {
  feed: Feed<T>;
  background: string;
  draw: (entry: T, scale: number, width?: number) => Promise<HTMLCanvasElement>;
  usual: T;
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

/** How tall a kill is drawn in the list. */
const ROW_PICTURE = 18;

/** `m:ss`, the way the timeline reads. */
const clock = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** One entry as it will look on the video, `ROW_PICTURE` tall; a long one shrinks to fit the row. */
function EntryPicture<T>(props: { entry: T; draw: (entry: T, scale: number) => Promise<HTMLCanvasElement>; scale: number }) {
  let box!: HTMLSpanElement;
  let version = 0;
  createEffect(() => {
    const entry = plain(props.entry);
    const pixels = Math.min(window.devicePixelRatio || 1, 3);
    const mine = ++version;
    props
      .draw(entry, props.scale * ROW_PICTURE * pixels)
      .then((canvas) => {
        if (mine !== version) return;
        canvas.style.width = `${(canvas.width / canvas.height) * ROW_PICTURE}px`;
        canvas.className = "block h-auto max-w-full";
        box.replaceChildren(canvas);
      })
      .catch(() => {});
  });
  return <span ref={box} class="flex min-w-0 items-center" style={{ "min-height": `${ROW_PICTURE}px` }} />;
}

/**
 * The feed as a list, each kill drawn as it will look; the picked one opens to show `children`, its settings.
 * Dragging a kill drags the whole feed onto the video.
 */
export function KillList<T>(props: {
  feed: KillfeedFeed<T>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draw: (entry: T, scale: number) => Promise<HTMLCanvasElement>;
  /** The draw scale for an entry 1px tall. */
  scale: number;
  at?: (entry: T) => number | undefined;
  next?: (copy: T) => void;
  onDragStart: (event: DragEvent) => void;
  children: JSX.Element;
}) {
  const count = () => props.feed.entries().length;
  const timed = () => !!props.at && props.feed.entries().some((entry) => props.at!(entry) !== undefined);

  const pick = (index: number) => {
    if (index === props.feed.selected()) return props.onOpenChange(!props.open);
    props.feed.select(index);
    props.onOpenChange(true);
  };

  const add = () => {
    props.feed.add(props.next);
    props.onOpenChange(true);
  };

  return (
    <div class="flex flex-col gap-1" role="list" aria-label={t("Killfeed")}>
      <For each={props.feed.entries()}>
        {(entry, index) => {
          const expanded = () => index() === props.feed.selected() && props.open;
          return (
            <div role="listitem" class="flex flex-col rounded-md transition-colors" classList={{ "bg-accent": expanded(), "bg-accent/50": !expanded() }}>
              <button
                type="button"
                draggable={true}
                onDragStart={(event) => props.onDragStart(event)}
                aria-expanded={expanded()}
                aria-label={t("Kill {n}", { n: index() + 1 })}
                title={t("Drag onto the video")}
                class="flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-accent focus-ring"
                onClick={() => pick(index())}
              >
                <Show when={timed()}>
                  <span class="w-7 shrink-0 text-left text-xxs tabular-nums text-muted-foreground">
                    {props.at!(entry) === undefined ? "" : clock(props.at!(entry)!)}
                  </span>
                </Show>
                <span class="flex min-w-0 flex-1 overflow-hidden" classList={{ "justify-end": timed(), "justify-center": !timed() }}>
                  <EntryPicture entry={entry} draw={props.draw} scale={props.scale} />
                </span>
              </button>
              <Show when={expanded()}>
                <div class="flex flex-col gap-4 px-2 pb-3 pt-2">
                  {props.children}
                  <Show when={count() > 1}>
                    <button
                      type="button"
                      class="flex h-6 items-center gap-0.5 self-start rounded-sm pr-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
                      onClick={() => props.feed.remove()}
                    >
                      <Icon name="close-remove-small" class="size-4" />
                      {t("Remove kill {n}", { n: index() + 1 })}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={count() < MAX_FEED_ENTRIES}>
        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
          onClick={add}
        >
          <Icon name="plus-add" class="size-4" />
          {t("Add a kill")}
        </button>
      </Show>
    </div>
  );
}

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
