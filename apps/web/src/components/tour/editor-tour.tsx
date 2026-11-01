/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
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
import { LogoBadge } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useLayout } from "@/context/layout";
import type { HideablePanel } from "@/components/editor/dock-layout";
import { getDocumentEditor } from "@/engine/editor";
import { msg, t } from "@/lib/i18n";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";

import type { Entity, World } from "koota";
import type { SidebarTab } from "@/agent-chat/store";

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

const CARD_GAP = 12;
const VIEWPORT_MARGIN = 16;
const INSIDE_OFFSET = 24;
const HOLE_RADIUS = 12;

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
  let before: { tab: SidebarTab; selection: Entity[]; hidden: HideablePanel[] } | null = null;
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

  onCleanup(() => setTour(null));

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
        hidden: untrack(layout.hiddenSections),
      };
    }
    if (state === null && before) {
      setSidebarTab(before.tab);
      layout.setHiddenSections(before.hidden);
      getDocumentEditor(world).select(before.selection.filter((entity) => entity.isAlive()));
      before = null;
    }
  }));

  createEffect(() => {
    const current = step();
    if (!current) return;
    untrack(() => {
      if (!layout.uiVisible()) layout.toggleUI();
      layout.setHiddenSections([]);
      if (current.targets.includes("timeline") && layout.timelineMinimized()) layout.toggleTimeline();
      if (current.tab) setSidebarTab(current.tab);
      if (current.select) {
        const frame = findFrame(world);
        const shown = current.select === "clip" && frame ? findClip(world, frame) ?? frame : frame;
        if (shown) getDocumentEditor(world).select(shown);
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
      else return;
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

  // Clicks land only inside the lit area: the blocker is the screen with that box cut out.
  const blockerClip = createMemo(() => {
    const { width, height } = viewport();
    const rect = hole();
    const outer = `M 0 0 H ${width} V ${height} H 0 Z`;
    if (!rect) return `path(evenodd, "${outer}")`;
    const inner = `M ${rect.x} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x} Z`;
    return `path(evenodd, "${outer} ${inner}")`;
  });

  const observeCard = (element: HTMLDivElement) => {
    const observer = new ResizeObserver(() => {
      setCardSize({ width: element.offsetWidth, height: element.offsetHeight });
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };

  const progress = () => {
    const state = tour();
    return typeof state === "number" ? ((state + 1) / STEPS.length) * 100 : 0;
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
                  stroke="rgba(255,255,255,0.18)"
                  stroke-width="1"
                />
              )}
            </Show>
          </svg>

          <div
            ref={observeCard}
            class="fixed flex w-80 flex-col rounded-2xl border border-border-strong bg-popover p-4 pointer-events-auto transition-[left,top] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:transition-none motion-reduce:animate-none"
            style={{ left: `${cardPosition().left}px`, top: `${cardPosition().top}px` }}
          >
            <Show
              when={step()}
              fallback={
                <>
                  <TourCover />
                  <h2 id="editor-tour-title" class="mb-2 text-sm font-550 text-foreground">{t("Welcome to plan.video")}</h2>
                  <p class="mb-5 text-xs leading-5 text-muted-foreground">
                    {t("A quick tour of the essentials: bring in your clip, lay it out, and export. About 30 seconds.")}
                  </p>
                  <div class="flex items-center justify-end gap-2">
                    <Button variant="secondary" class="h-8 px-3" onClick={close}>{t("Skip")}</Button>
                    <Button ref={primaryButton} class="h-8 px-3" onClick={next}>{t("Start tour")}</Button>
                  </div>
                </>
              }
            >
              {(current) => (
                <>
                  <div class="mb-2 flex items-center gap-2">
                    <h2 id="editor-tour-title" class="flex-1 text-sm font-550 text-foreground">{t(current().title)}</h2>
                    <button
                      type="button"
                      aria-label={t("Close tour")}
                      class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
                      onClick={close}
                    >
                      <Icon name="close-remove" />
                    </button>
                  </div>
                  <p class="mb-5 text-xs leading-5 text-muted-foreground">{t(current().body)}</p>
                  <div class="flex items-center justify-between gap-3">
                    <div class="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                      <span
                        class="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: `${progress()}%` }}
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <Button variant="secondary" class="h-8 px-3" onClick={back}>{t("Back")}</Button>
                      <Button ref={primaryButton} class="h-8 px-3" onClick={next}>
                        {tour() === STEPS.length - 1 ? t("Finish") : t("Next")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

function TourCover() {
  return (
    <div
      class="relative mb-4 grid h-44 place-items-center overflow-hidden rounded-xl"
      style={{ background: "radial-gradient(120% 90% at 50% 0%, hsla(220, 87%, 60%, 0.35), transparent 60%), linear-gradient(180deg, light-dark(hsl(220, 40%, 94%), hsl(222, 28%, 15%)), light-dark(hsl(222, 30%, 84%), hsl(230, 30%, 7%)))" }}
    >
      <div class="relative flex h-36 w-[81px] flex-col overflow-hidden rounded-[14px] border border-white/15 bg-black shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
        <div class="relative h-[38%]" style={{ background: "linear-gradient(135deg, #3b2a5c, #1d2a4a)" }}>
          <div class="absolute left-1/2 top-[18%] size-5 -translate-x-1/2 rounded-full bg-white/30" />
          <div class="absolute bottom-0 left-1/2 h-4 w-10 -translate-x-1/2 rounded-t-full bg-white/20" />
        </div>
        <div class="relative flex-1" style={{ background: "linear-gradient(160deg, #ff4655 0%, #7a1d2a 45%, #0f1923 100%)" }}>
          <div class="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70" />
        </div>
      </div>
      <LogoBadge class="absolute bottom-5 left-[calc(50%+26px)] size-9 rotate-6 shadow-[0_8px_20px_rgba(0,0,0,0.45)]" />
    </div>
  );
}
