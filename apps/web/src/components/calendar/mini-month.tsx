/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, createEffect, createSignal, on } from "solid-js";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { msg, t } from "@/lib/i18n";
import type { CalendarNavigation } from "./navigation";
import { cn, formatMonth, getMonthDays, getWeekDays, shiftMonth } from "./utils";

const WEEKDAY_LABELS = [
  msg({ message: "M", context: "Monday" }),
  msg({ message: "T", context: "Tuesday" }),
  msg({ message: "W", context: "Wednesday" }),
  msg({ message: "T", context: "Thursday" }),
  msg({ message: "F", context: "Friday" }),
  msg({ message: "S", context: "Saturday" }),
  msg({ message: "S", context: "Sunday" }),
];

export function MiniMonth(props: {
  nav: CalendarNavigation;
  onPick?(): void;
}) {
  const [shown, setShown] = createSignal(props.nav.date().slice(0, 7) + "-01");
  createEffect(on(props.nav.date, (date) => setShown(date.slice(0, 7) + "-01"), { defer: true }));

  const days = () => getMonthDays(shown());
  const week = () => new Set(props.nav.view() === "week" ? getWeekDays(props.nav.date()) : []);
  const weekBounds = () => {
    const list = getWeekDays(props.nav.date());
    return { first: list[0], last: list[6] };
  };

  return (
    <div class="px-1">
      <div class="flex h-8 items-center justify-between pl-1">
        <button
          type="button"
          class="-ml-1 rounded-md px-1 text-sm font-medium text-(--plane-text-primary) outline-none press hover:bg-accent focus-ring"
          onClick={() => props.nav.go(shown(), "month")}
        >
          {formatMonth(shown())}
        </button>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t("Previous month")}
            class="grid size-6 place-items-center rounded-md text-(--plane-text-placeholder) outline-none press hover:bg-accent hover:text-(--plane-text-primary) focus-ring"
            onClick={() => setShown((value) => shiftMonth(value, -1))}
          >
            <PlaneIcon name="chevron-left" class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("Next month")}
            class="grid size-6 place-items-center rounded-md text-(--plane-text-placeholder) outline-none press hover:bg-accent hover:text-(--plane-text-primary) focus-ring"
            onClick={() => setShown((value) => shiftMonth(value, 1))}
          >
            <PlaneIcon name="chevron-right" class="size-3.5" />
          </button>
        </div>
      </div>
      <div class="grid h-6 grid-cols-7 items-center text-center text-xxs font-medium text-(--plane-text-placeholder)">
        <For each={WEEKDAY_LABELS}>{(label) => <span>{t(label)}</span>}</For>
      </div>
      <div class="grid grid-cols-7 gap-y-0.5">
        <For each={days()}>
          {(day) => {
            const inWeek = () => week().has(day);
            const isToday = () => day === props.nav.today();
            const isSelected = () => props.nav.view() !== "week" && day === props.nav.date();
            const outside = () => day.slice(0, 7) !== shown().slice(0, 7);
            return (
              <button
                type="button"
                aria-label={day}
                aria-current={isToday() ? "date" : undefined}
                class={cn(
                  "group grid h-7 w-full place-items-center outline-none focus-ring",
                  inWeek() && "bg-(--plane-layer-transparent-hover)",
                  inWeek() && day === weekBounds().first && "rounded-l-md",
                  inWeek() && day === weekBounds().last && "rounded-r-md",
                )}
                onClick={() => {
                  if (props.nav.view() === "list") props.nav.pick(day);
                  else props.nav.go(day);
                  props.onPick?.();
                }}
              >
                <span
                  class={cn(
                    "grid size-6 place-items-center rounded-md text-xs tabular-nums press",
                    isToday() && "bg-(--plane-accent-primary) font-medium text-white",
                    !isToday() && isSelected() && "bg-(--plane-layer-transparent-selected) text-(--plane-text-primary)",
                    !isToday() && !isSelected() && "group-hover:bg-accent",
                    !isToday() && !isSelected() && (outside() ? "text-(--plane-text-disabled)" : "text-(--plane-text-secondary)"),
                  )}
                >
                  {Number(day.slice(-2))}
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
