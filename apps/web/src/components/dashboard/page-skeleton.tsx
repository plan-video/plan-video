/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Switch, type JSX } from "solid-js";

import { defaultCalendarView, isCalendarView } from "@/components/calendar/default-view";
import { cx } from "@/lib/cva";

import type { DashboardView } from "./types";

export type SkeletonKind = "cards" | "list" | "week" | "month" | "settings" | "analytics" | "billing";

/** `calendarView` is the calendar's `?view=`. */
export function skeletonFor(view: DashboardView, calendarView?: string): SkeletonKind {
  if (view === "calendar") return isCalendarView(calendarView) ? calendarView : defaultCalendarView();
  if (view === "projects" || view === "trash" || view === "media" || view === "templates" || view === "vault" || view === "plugs") return "cards";
  if (view === "notifications" || view === "posts" || view === "scheduled" || view === "posted" || view === "drafts" || view === "failed") return "list";
  if (view.startsWith("analytics")) return "analytics";
  if (view === "billing") return "billing";
  return "settings";
}

const BLOCK = "animate-pulse rounded-md bg-(--plane-fill-subtle) motion-reduce:animate-none";

function Bar(props: { class: string; style?: JSX.CSSProperties }) {
  return <span class={cx("block", BLOCK, props.class)} style={props.style} />;
}

export { Bar as SkeletonBar };

const times = (count: number) => Array.from({ length: count }, (_, index) => index);

/** As [day, top in rows, height in rows]. */
const WEEK_BLOCKS: [number, number, number][] = [
  [0, 1, 2],
  [1, 4, 3],
  [2, 2, 2],
  [3, 5, 2],
  [4, 1, 3],
  [5, 6, 2],
];

export function PageSkeleton(props: { kind: SkeletonKind }) {
  return (
    <div aria-hidden="true" class="min-h-0 flex-1 overflow-hidden">
      <Switch>
        <Match when={props.kind === "cards"}>
          <div class="flex flex-col gap-4 px-6 pt-4">
            <Bar class="h-3 w-24" />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              <For each={times(8)}>
                {() => (
                  <div class="flex flex-col gap-2.5 rounded-xl border border-(--plane-border-subtle) p-3">
                    <Bar class="aspect-video w-full rounded-xl" />
                    <Bar class="h-3 w-2/3" />
                    <Bar class="h-2.5 w-1/3" />
                  </div>
                )}
              </For>
            </div>
          </div>
        </Match>
        <Match when={props.kind === "list"}>
          <div class="flex flex-col gap-5 px-4 pt-4">
            <For each={times(3)}>
              {() => (
                <div class="flex flex-col gap-3">
                  <Bar class="ml-3 h-3.5 w-28" />
                  <For each={times(3)}>
                    {() => (
                      <div class="flex items-center gap-3 px-3">
                        <Bar class="h-12 w-9 shrink-0" />
                        <div class="flex min-w-0 flex-1 flex-col gap-2">
                          <Bar class="h-3 w-1/3" />
                          <Bar class="h-2.5 w-1/2" />
                        </div>
                        <Bar class="h-3 w-12 shrink-0" />
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.kind === "month"}>
          <div class="grid h-full grid-cols-7 grid-rows-[2.25rem_repeat(5,minmax(0,1fr))] border-t border-(--plane-border-subtle)">
            <For each={times(7)}>
              {() => (
                <div class="flex items-center border-r border-b border-(--plane-border-subtle) px-2.5 last:border-r-0">
                  <Bar class="h-2.5 w-8" />
                </div>
              )}
            </For>
            <For each={times(35)}>
              {(cell) => (
                <div class="flex flex-col gap-1.5 border-r border-b border-(--plane-border-subtle) p-2 [&:nth-child(7n)]:border-r-0">
                  <Bar class="h-2.5 w-4" />
                  {cell % 3 === 1 ? <Bar class="h-[42px] w-full" /> : null}
                  {cell % 5 === 2 ? <Bar class="h-[42px] w-full" /> : null}
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.kind === "week"}>
          <div class="grid h-full grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] grid-rows-[3rem_minmax(0,1fr)] border-t border-(--plane-border-subtle)">
            <div class="border-r border-b border-(--plane-border-subtle)" />
            <For each={times(7)}>
              {() => (
                <div class="flex items-center gap-1.5 border-r border-b border-(--plane-border-subtle) px-2.5 last:border-r-0">
                  <Bar class="h-2.5 w-7" />
                  <Bar class="h-3.5 w-4" />
                </div>
              )}
            </For>
            <div class="flex flex-col gap-[3.25rem] border-r border-(--plane-border-subtle) px-2 pt-2">
              <For each={times(6)}>{() => <Bar class="ml-auto h-2.5 w-7" />}</For>
            </div>
            <For each={times(7)}>
              {(day) => (
                <div class="relative border-r border-(--plane-border-subtle) last:border-r-0">
                  <For each={WEEK_BLOCKS.filter(([column]) => column === day)}>
                    {([, top, height]) => <Bar class="absolute inset-x-1" style={{ top: `${top * 2.5}rem`, height: `${height * 2.5}rem` }} />}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.kind === "analytics"}>
          <div class="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 pt-5">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <For each={times(4)}>
                {() => (
                  <div class="flex flex-col gap-3 rounded-xl border border-(--plane-border-subtle) p-4">
                    <Bar class="h-2.5 w-16" />
                    <Bar class="h-6 w-24" />
                  </div>
                )}
              </For>
            </div>
            <Bar class="h-64 w-full rounded-xl" />
          </div>
        </Match>
        <Match when={props.kind === "billing"}>
          <div class="@container flex flex-col gap-6 px-6 pt-6">
            <div class="flex flex-col gap-1">
              <div class="flex h-7 items-center">
                <Bar class="h-5 w-24" />
              </div>
              <div class="flex h-5 items-center">
                <Bar class="h-3 w-72" />
              </div>
            </div>
            <div class="flex flex-col gap-4">
              <Bar class="h-7 w-44" />
              <div class="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
                <For each={times(4)}>
                  {() => (
                    <div class="flex flex-col rounded-xl border border-(--plane-border-subtle) p-1.5">
                      <Bar class="h-58 w-full rounded-lg" />
                      <div class="flex flex-col gap-4 px-4 pt-5 pb-4">
                        <Bar class="h-2.5 w-28" />
                        <For each={times(8)}>{(line) => <Bar class={line % 2 ? "h-3 w-1/2" : "h-3 w-3/4"} />}</For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Match>
        <Match when={props.kind === "settings"}>
          <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
            <For each={times(2)}>
              {() => (
                <div class="flex flex-col gap-3">
                  <Bar class="h-3.5 w-32" />
                  <div class="flex flex-col gap-5 rounded-xl border border-(--plane-border-subtle) p-4">
                    <For each={times(3)}>
                      {() => (
                        <div class="flex items-center justify-between gap-4">
                          <div class="flex flex-col gap-2">
                            <Bar class="h-3 w-28" />
                            <Bar class="h-2.5 w-48" />
                          </div>
                          <Bar class="h-7 w-20" />
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
