/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { useWorld } from "@plan.video/koota-solid";
import {
  Geometry,
  Hidden,
  Selected,
  findGeometryAsset,
  getActiveEntity,
  getEntityTree,
  getParentNode,
  isMask,
  isScene,
} from "@plan.video/runtime";

import { setSidebarTab, sidebarTab } from "@/agent-chat";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useLayout } from "@/context/layout";
import { getDocumentEditor } from "@/engine/editor";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import { createStoredSignal } from "@/lib/store";
import { placeTourSample, warmTourSample } from "./tour-sample";
import { store } from "@/init";

import type { Entity, World } from "koota";
import type { SidebarTab } from "@/agent-chat/store";
import type { TourSample } from "./tour-sample";

type Placement = "right" | "left" | "top" | "bottom" | "inside";

type TourStep = {
  /** `data-tour` values, best first: the first one on screen wins, and every element carrying it is joined into one box. */
  targets: string[];
  placement: Placement;
  title: string;
  body: string;
  tab?: SidebarTab;
  select?: "clip" | "frame";
};

const STEPS: TourStep[] = [
  {
    targets: ["sidebar"],
    placement: "right",
    tab: "assets",
    title: msg("Bring in your footage"),
    body: msg("Drop clips, recordings, and images into Assets, then drag them onto the canvas or the timeline."),
  },
  {
    targets: ["sidebar"],
    placement: "right",
    tab: "templates",
    title: msg("Lay out the stream"),
    body: msg("Layouts split gameplay and facecam into a vertical short. Sizes set the frame for where you'll post it."),
  },
  {
    targets: ["canvas"],
    placement: "inside",
    select: "clip",
    title: msg("Arrange on the canvas"),
    body: msg("Drag what's selected to move it and pull the handles to resize. The toolbar at the bottom adds frames, shapes, and text."),
  },
  {
    targets: ["inspector"],
    placement: "left",
    select: "clip",
    title: msg("Fine-tune anything"),
    body: msg("Whatever is selected shows its size, color, effects, and speed here. The diamond next to a value sets a keyframe at the playhead."),
  },
  {
    targets: ["timeline"],
    placement: "top",
    select: "clip",
    title: msg("Cut on the timeline"),
    body: msg("Drag clips to move them and pull their edges to trim. Space plays, and ⌘B splits at the playhead."),
  },
  {
    targets: ["export-button"],
    placement: "left",
    title: msg("Export your short"),
    body: msg("Export saves the video to your computer. It uses the settings in your scene's Export section, MP4 at 1080p until you change them."),
  },
  {
    targets: ["schedule-post"],
    placement: "left",
    title: msg("Schedule the post"),
    body: msg("Schedule post takes this video to a new post, where you pick the accounts and the time."),
  },
];

function findFrame(world: World): Entity | null {
  let scene = getActiveEntity(world);
  while (scene) {
    const parent = getParentNode(scene);
    if (!parent) break;
    scene = parent;
  }
  return scene && isScene(scene) ? scene : null;
}

function findClip(world: World, frame: Entity): Entity | null {
  let fallback: Entity | null = null;
  for (const entity of getEntityTree(world, frame)) {
    if (entity === frame || !entity.has(Geometry) || entity.has(Hidden) || isScene(entity) || isMask(entity)) continue;
    if (findGeometryAsset(world, entity)?.type === "VIDEO") return entity;
    fallback ??= entity;
  }
  return fallback;
}

/** `"welcome"` is the intro card; a number is the step on screen. */
type TourState = "welcome" | number | null;

const [tour, setTour] = createSignal<TourState>(null);

export function startEditorTour(): void {
  setTour(0);
}

type Rect = { x: number; y: number; width: number; height: number };

const CARD_GAP = 16;
const VIEWPORT_MARGIN = 16;
const INSIDE_OFFSET = 24;
const HOLE_RADIUS = 12;
const POINTER_SIZE = 12;
const POINTER_INSET = 20;

type Side = "left" | "right" | "top" | "bottom";

const POINTER_SIDE: Record<Exclude<Placement, "inside">, Side> = { right: "left", left: "right", top: "bottom", bottom: "top" };

// A square turned 45°: these two borders meet at the corner facing that side.
const POINTER_BORDERS: Record<Side, string> = {
  left: "border-l border-b",
  right: "border-t border-r",
  top: "border-l border-t",
  bottom: "border-r border-b",
};
const CARD_KEYS = new Set(["Tab", "Enter", " "]);
const TEXT_BUTTON = "h-8 px-3 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground";

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function measure(targets: string[]): Rect | null {
  for (const target of targets) {
    const rect = measureTarget(target);
    if (rect) return rect;
  }
  return null;
}

function measureTarget(target: string): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const element of document.querySelectorAll(`[data-tour="${target}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }

  if (left === Infinity) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function EditorTour() {
  const world = useWorld();
  const layout = useLayout();
  const [seen, setSeen] = createStoredSignal(store.define("editor.tour-seen", false));

  const [hole, setHole] = createSignal<Rect | null>(null, { equals: sameRect });
  const [viewport, setViewport] = createSignal({ width: window.innerWidth, height: window.innerHeight });
  const [cardSize, setCardSize] = createSignal({ width: 320, height: 160 });
  // An empty project gets a sample clip for the steps about clips, so they show the real canvas, panel and timeline.
  const [sample, setSample] = createSignal<TourSample | null>(null);
  let card: HTMLDivElement | undefined;
  let awaitingMedia: Entity | null = null;
  let before: { tab: SidebarTab; selection: Entity[] } | null = null;
  let primaryButton: HTMLButtonElement | undefined;

  const step = createMemo(() => {
    const state = tour();
    return typeof state === "number" ? STEPS[state] ?? null : null;
  });

  onMount(() => {
    if (seen()) return;
    const timer = setTimeout(() => {
      if (tour() === null) setTour("welcome");
    }, 600);
    onCleanup(() => clearTimeout(timer));
  });

  const removeSample = () => {
    untrack(sample)?.remove();
    setSample(null);
  };

  onCleanup(() => {
    removeSample();
    layout.setSectionsRevealed(false);
    setTour(null);
  });

  const close = () => {
    setTour(null);
    setSeen(true);
  };

  const next = () => {
    const state = tour();
    if (state === "welcome") setTour(0);
    else if (typeof state === "number") {
      if (state + 1 < STEPS.length) setTour(state + 1);
      else close();
    }
  };

  const back = () => {
    const state = tour();
    if (typeof state !== "number") return;
    setTour(state === 0 ? "welcome" : state - 1);
  };

  // The steps switch tabs and select things; closing puts back what the user had.
  createEffect(on(tour, (state, previous) => {
    if (state !== null && (previous === null || previous === undefined)) {
      before = {
        tab: untrack(sidebarTab),
        selection: [...world.query(Selected)],
      };
      layout.setSectionsRevealed(true);
      layout.setCustomizing(false);
      const frame = findFrame(world);
      if (!frame || !findClip(world, frame)) warmTourSample(world, frame);
    }
    if (state === null) removeSample();
    if (state === null && before) {
      setSidebarTab(before.tab);
      // After the dock's own effect, which shows the assets panel on every tab change.
      queueMicrotask(() => layout.setSectionsRevealed(false));
      getDocumentEditor(world).select(before.selection.filter((entity) => entity.isAlive()));
      before = null;
    }
  }));

  createEffect(() => {
    const current = step();
    if (!current) return;
    untrack(() => {
      if (!layout.uiVisible()) layout.toggleUI();
      if (current.targets.includes("timeline") && layout.timelineMinimized()) layout.toggleTimeline();
      if (current.tab) setSidebarTab(current.tab);
      if (current.select !== "clip") removeSample();
      if (current.select) {
        const frame = findFrame(world);
        let clip = frame ? findClip(world, frame) : null;
        if (!clip && current.select === "clip") {
          if (!untrack(sample)) setSample(placeTourSample(world, frame));
          clip = untrack(sample)?.clip ?? null;
        }
        const shown = current.select === "clip" ? clip ?? frame : frame;
        // Selected once its media is in: the inspector names a clip by what it shows when it is picked.
        if (shown && shown === untrack(sample)?.clip && !findGeometryAsset(world, shown)) awaitingMedia = shown;
        else if (shown) getDocumentEditor(world).select(shown);
      }
    });
  });

  // Areas resize while the tour is open, so the light follows every frame.
  createEffect(() => {
    if (tour() === null) return;
    let frame = 0;
    const tick = () => {
      const current = step();
      setHole(current ? measure(current.targets) : null);
      if (awaitingMedia && (!awaitingMedia.isAlive() || findGeometryAsset(world, awaitingMedia))) {
        if (awaitingMedia.isAlive() && current?.select === "clip") getDocumentEditor(world).select(awaitingMedia);
        awaitingMedia = null;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    onCleanup(() => cancelAnimationFrame(frame));
  });

  createEffect(() => {
    if (tour() === null) return;
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
      else {
        // Shortcuts would edit around the sample (a split would land in the file), so only the card hears keys then.
        if (sample() && !(card?.contains(event.target as Node) && CARD_KEYS.has(event.key))) event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  createEffect(on(tour, (state) => {
    if (state !== null) queueMicrotask(() => primaryButton?.focus({ preventScroll: true }));
  }));

  const cardPosition = createMemo(() => {
    const { width: vw, height: vh } = viewport();
    const { width: cw, height: ch } = cardSize();
    const rect = hole();
    const current = step();

    if (!rect || !current) return { left: (vw - cw) / 2, top: (vh - ch) / 2 };

    let left = rect.x + rect.width / 2 - cw / 2;
    let top = rect.y + rect.height / 2 - ch / 2;

    if (current.placement === "right") left = rect.x + rect.width + CARD_GAP;
    if (current.placement === "left") left = rect.x - CARD_GAP - cw;
    if (current.placement === "top") top = rect.y - CARD_GAP - ch;
    if (current.placement === "bottom") top = rect.y + rect.height + CARD_GAP;
    if (current.placement === "inside") {
      left = rect.x + INSIDE_OFFSET;
      top = rect.y + INSIDE_OFFSET;
    }

    return {
      left: clamp(left, VIEWPORT_MARGIN, vw - cw - VIEWPORT_MARGIN),
      top: clamp(top, VIEWPORT_MARGIN, vh - ch - VIEWPORT_MARGIN),
    };
  });

  // Level with the lit area's middle; dropped when the screen edge pushes the card onto it.
  const pointer = createMemo(() => {
    const rect = hole();
    const current = step();
    if (!rect || !current || current.placement === "inside") return null;
    const { left, top } = cardPosition();
    const { width: cw, height: ch } = cardSize();
    const side = POINTER_SIDE[current.placement];
    const gap = {
      left: left - (rect.x + rect.width),
      right: rect.x - (left + cw),
      top: top - (rect.y + rect.height),
      bottom: rect.y - (top + ch),
    }[side];
    if (gap < POINTER_SIZE / 2) return null;
    const across = side === "left" || side === "right";
    const along = across ? rect.y + rect.height / 2 - top : rect.x + rect.width / 2 - left;
    return { side, offset: clamp(along, POINTER_INSET, (across ? ch : cw) - POINTER_INSET) };
  });

  // Clicks land only inside the lit area: the blocker is the screen with that box cut out. While the sample is out it covers everything, so nothing is done to it.
  const blockerClip = createMemo(() => {
    const { width, height } = viewport();
    const rect = hole();
    const outer = `M 0 0 H ${width} V ${height} H 0 Z`;
    if (!rect || sample()) return `path(evenodd, "${outer}")`;
    const inner = `M ${rect.x} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x} Z`;
    return `path(evenodd, "${outer} ${inner}")`;
  });

  const observeCard = (element: HTMLDivElement) => {
    card = element;
    const observer = new ResizeObserver(() => {
      setCardSize({ width: element.offsetWidth, height: element.offsetHeight });
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };

  return (
    <Show when={tour() !== null}>
      <Portal>
        <div class="fixed inset-0 z-[100] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby="editor-tour-title">
          <div class="fixed inset-0 pointer-events-auto" style={{ "clip-path": blockerClip() }} aria-hidden="true" />

          <svg class="fixed inset-0 size-full pointer-events-none animate-in fade-in-0 duration-200 motion-reduce:animate-none" aria-hidden="true">
            <defs>
              <mask id="editor-tour-spotlight">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <Show when={hole()}>
                  {(rect) => (
                    <rect
                      class="transition-[x,y,width,height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                      x={rect().x}
                      y={rect().y}
                      width={rect().width}
                      height={rect().height}
                      rx={HOLE_RADIUS}
                      fill="black"
                    />
                  )}
                </Show>
              </mask>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#editor-tour-spotlight)" />
            <Show when={hole()}>
              {(rect) => (
                <rect
                  class="transition-[x,y,width,height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                  x={rect().x}
                  y={rect().y}
                  width={rect().width}
                  height={rect().height}
                  rx={HOLE_RADIUS}
                  fill="none"
                  style={{ stroke: "var(--primary)" }}
                  stroke-width="1.5"
                />
              )}
            </Show>
          </svg>

          <div
            ref={observeCard}
            class={cx(
              "fixed flex max-w-[calc(100vw-32px)] flex-col rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_24px_64px_-16px_rgba(0,0,0,0.55)] pointer-events-auto transition-[left,top] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:transition-none motion-reduce:animate-none",
              step() ? "w-80" : "w-[25rem]",
            )}
            style={{ left: `${cardPosition().left}px`, top: `${cardPosition().top}px` }}
          >
            <Show
              when={step()}
              keyed
              fallback={
                <>
                  <div class="p-1.5 pb-0">
                    <img
                      src="/tour/welcome.webp"
                      alt=""
                      width="1200"
                      height="876"
                      draggable={false}
                      class="block aspect-[1200/876] max-h-[42vh] w-full rounded-[10px] bg-[#f3c2fb] object-cover object-left-top select-none"
                    />
                  </div>
                  <div class="px-5 pt-5 pb-5">
                    <h2 id="editor-tour-title" class="text-[19px] leading-6 font-550 tracking-[-0.01em] text-foreground">{t("Welcome to plan.video")}</h2>
                    <p class="mt-2 text-sm leading-[22px] text-muted-foreground">
                      {t("A quick tour of the essentials: bring in your clip, lay it out, and export. About 30 seconds.")}
                    </p>
                    <div class="mt-6 flex items-center justify-end gap-1.5">
                      <Button variant="ghost" class={cx(TEXT_BUTTON, "h-9 px-3.5 text-sm")} onClick={close}>{t("Skip")}</Button>
                      <Button ref={primaryButton} class="h-9 px-4 text-sm" onClick={next}>{t("Start tour")}</Button>
                    </div>
                  </div>
                </>
              }
            >
              {(current) => (
                <div class="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
                  <div class="p-4 pl-4.5">
                    <div class="flex items-start gap-2">
                      <h2 id="editor-tour-title" class="flex-1 pt-0.5 text-[15px] leading-5 font-550 text-foreground">{t(current.title)}</h2>
                      <button
                        type="button"
                        aria-label={t("Close tour")}
                        class="-mt-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
                        onClick={close}
                      >
                        <Icon name="close-remove" />
                      </button>
                    </div>
                    <p class="mt-1.5 text-[13px] leading-5 text-muted-foreground">{t(current.body)}</p>
                    <div class="mt-5 flex items-center justify-between gap-3">
                      <div class="flex items-center gap-1" aria-hidden="true">
                        <For each={STEPS}>
                          {(_, index) => (
                            <span
                              class={cx(
                                "h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none",
                                index() === tour() ? "w-4 bg-foreground" : "w-1.5",
                                index() !== tour() && (index() < (tour() as number) ? "bg-foreground/45" : "bg-foreground/15"),
                              )}
                            />
                          )}
                        </For>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <Button variant="ghost" class={TEXT_BUTTON} onClick={back}>{t("Back")}</Button>
                        <Button ref={primaryButton} class="h-8 px-3.5 text-[13px]" onClick={next}>
                          {tour() === STEPS.length - 1 ? t("Finish") : t("Next")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Show>
            <Show when={pointer()}>
              {(at) => (
                <span
                  aria-hidden="true"
                  class={cx(
                    "absolute rotate-45 border-border bg-popover transition-[left,top] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
                    POINTER_BORDERS[at().side],
                  )}
                  style={{
                    width: `${POINTER_SIZE}px`,
                    height: `${POINTER_SIZE}px`,
                    ...(at().side === "left" || at().side === "right"
                      ? { [at().side]: `${-POINTER_SIZE / 2 - 1}px`, top: `${at().offset - POINTER_SIZE / 2 - 1}px` }
                      : { [at().side]: `${-POINTER_SIZE / 2 - 1}px`, left: `${at().offset - POINTER_SIZE / 2 - 1}px` }),
                  }}
                />
              )}
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
