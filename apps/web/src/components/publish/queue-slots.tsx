/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Setting up the posting queue: which days, at which times.

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createSignal } from "solid-js";
import { toast } from "somoto";

import { hydrateCalendar } from "@/components/calendar/store";
import type { DashboardView } from "@/components/dashboard/types";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import { QUEUE_WEEKDAYS, addQueueSlots, clearQueueSlots, loadQueueSlots, queueSlots, removeQueueSlot } from "@/lib/queue-slots";

import { TimePicker } from "./date-time-picker";
import { nextQueueTimes } from "./queue";
import { formatWhen, timeZoneName } from "./save";

/** Loads the active workspace's slots and the calendar they are checked against. */
export function useQueueSlots() {
  const auth = useAuth();
  createEffect(() => loadQueueSlots(auth.ownerId()));
  void hydrateCalendar();
}

export function QueueSlotsEditor() {
  const auth = useAuth();
  useQueueSlots();
  const [weekdays, setWeekdays] = createSignal<number[]>([1, 3, 5]);
  const [time, setTime] = createSignal("18:00");

  const toggleDay = (weekday: number) =>
    setWeekdays((current) => (current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday]));

  const add = () => {
    const userId = auth.ownerId();
    if (!userId || !weekdays().length) return;
    const added = addQueueSlots(userId, weekdays(), time());
    if (!added) toast(t("Those slots are already in the queue"));
  };

  const remove = (id: string) => {
    const userId = auth.ownerId();
    if (userId) removeQueueSlot(userId, id);
  };

  const clear = () => {
    const userId = auth.ownerId();
    if (userId) clearQueueSlots(userId);
  };

  const upcoming = () => nextQueueTimes(3);

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2 rounded-xl border border-(--border-input) p-3">
        <div class="flex items-center gap-2">
          <div class="grid min-w-0 flex-1 grid-cols-7 gap-1">
            <For each={QUEUE_WEEKDAYS}>
              {(day) => {
                const on = () => weekdays().includes(day.weekday);
                return (
                  <button
                    type="button"
                    aria-pressed={on()}
                    aria-label={t(day.name)}
                    class={cx(
                      "grid h-7 min-w-0 place-items-center rounded-md border font-medium press focus-ring",
                      on()
                        ? "border-primary/70 bg-primary/10 text-foreground"
                        : "border-(--border-input) text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => toggleDay(day.weekday)}
                  >
                    <span class="text-xs">{t(day.short)}</span>
                  </button>
                );
              }}
            </For>
          </div>
          <div class="w-28 shrink-0">
            <TimePicker value={time()} label={t("Slot time")} onChange={setTime} />
          </div>
          <Button class="shrink-0 px-3" disabled={!weekdays().length} onClick={add}>
            {t("Add")}
          </Button>
        </div>
      </div>

      <ul class="flex flex-col">
        <For each={QUEUE_WEEKDAYS}>
          {(day) => {
            const onDay = () => queueSlots().filter((slot) => slot.weekday === day.weekday);
            return (
              <li class="flex min-h-8 items-center gap-3 border-b border-border/60 py-1 last:border-b-0">
                <span class="w-20 shrink-0 text-xs text-muted-foreground">{t(day.name)}</span>
                <div class="flex min-w-0 flex-1 flex-wrap gap-1">
                  <Show when={onDay().length} fallback={<span class="text-xs text-muted-foreground/60">{t("No slots")}</span>}>
                    <For each={onDay()}>
                      {(slot) => (
                        <span class="group/slot flex h-6 items-center gap-0.5 rounded-md bg-accent pl-2 pr-0.5 text-xs tabular-nums text-foreground">
                          {slot.time}
                          <button
                            type="button"
                            aria-label={t("Remove {day} {time}", { day: t(day.name), time: slot.time })}
                            class="grid size-5 place-items-center rounded text-muted-foreground press hover:bg-secondary hover:text-foreground focus-ring"
                            onClick={() => remove(slot.id)}
                          >
                            <Icon name="close-remove" class="size-4" />
                          </button>
                        </span>
                      )}
                    </For>
                  </Show>
                </div>
              </li>
            );
          }}
        </For>
      </ul>

      <Show when={queueSlots().length}>
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 text-xs text-muted-foreground">
              {t("{count, plural, one {# slot a week} other {# slots a week}} · next open, {zone}", { count: queueSlots().length, zone: timeZoneName() })}
            </span>
            <Button variant="link" size="small" class="h-4 text-muted-foreground" onClick={clear}>
              {t("Clear all")}
            </Button>
          </div>
          <Show when={upcoming().length} fallback={<p class="text-xs text-muted-foreground">{t("Every slot in the next two months is taken.")}</p>}>
            <div class="flex flex-wrap gap-1">
              <For each={upcoming()}>
                {(at) => <span class="h-6 rounded-md border border-(--border-input) px-2 text-xs leading-6 tabular-nums text-foreground">{formatWhen(at)}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The pages that send you to the queue settings, and can take you back. */
export const QUEUE_RETURN_LABELS: Partial<Record<DashboardView, string>> = {
  "new-post": msg("New post"),
  "bulk-tools": msg("Bulk tools"),
};

/** Opens the posting queue in Settings, remembering the page you came from. */
export function useOpenQueueSettings() {
  const [params, setParams] = useSearchParams();
  return () => {
    const from = typeof params.dashboard === "string" && params.dashboard in QUEUE_RETURN_LABELS ? params.dashboard : undefined;
    setParams({ dashboard: "settings", section: "queue", back: from });
  };
}
