/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { SquirrelAsleep } from "@/components/brand/mascot";
import "@/components/calendar/calendar.css";
import { chipClass } from "@/components/calendar/post-chip";
import { dateFromKey, shiftDay } from "@/components/calendar/utils";
import { TimeList, TimePicker } from "@/components/publish/date-time-picker";
import { nextQueueTimes } from "@/components/publish/queue";
import { QUEUE_RETURN_LABELS, useQueueSlots } from "@/components/publish/queue-slots";
import { timeZoneName } from "@/components/publish/save";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { localized, msg, t } from "@/lib/i18n";
import { MAX_QUEUE_SLOTS, QUEUE_WEEKDAYS, addQueueSlots, clearQueueSlots, firstOpenBySlot, queueSlots, removeQueueSlot, type QueueSlot } from "@/lib/queue-slots";
import { clockAt, dayKeyAt, zonedParts } from "@/lib/time-zone";

import { Icon } from "./dashboard-icon";
import { isPhone } from "@/lib/phone";
import { DashboardPageHeader } from "./page-header";
import { PageToggle } from "./page-toggle";
import { PlaneIcon } from "./plane-icons";
import { SectionHeader } from "./posts-view";
import type { DashboardView } from "./types";

const SHORT_DATE = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }), "en-GB");

const VIEWS = [
  { value: "week", label: msg("Week") },
  { value: "list", label: msg("List") },
] as const;

type SlotProps = { slot: QueueSlot; dayName: string; at?: Date; next: boolean };

function slotDate(at: Date) {
  return SHORT_DATE().format(dateFromKey(dayKeyAt(at)));
}

function useAddSlots() {
  const auth = useAuth();
  return (weekdays: readonly number[], time: string) => {
    const userId = auth.ownerId();
    if (!userId || !weekdays.length) return;
    const added = addQueueSlots(userId, weekdays, time);
    if (added < weekdays.length && queueSlots().length >= MAX_QUEUE_SLOTS) toast(t("The queue is full at {count} times", { count: MAX_QUEUE_SLOTS }));
    else if (!added) toast(t("Those slots are already in the queue"));
  };
}

function useSlotActions() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  return {
    open(props: SlotProps) {
      const at = props.at;
      if (at) return setParams({ dashboard: "new-post", date: dayKeyAt(at), time: clockAt(at), view: undefined, back: undefined });
      const today = new Date();
      setParams({ dashboard: "calendar", date: shiftDay(dayKeyAt(today), (props.slot.weekday - zonedParts(today).weekday + 7) % 7), view: undefined, back: undefined });
    },
    remove(id: string) {
      const userId = auth.ownerId();
      if (userId) removeQueueSlot(userId, id);
    },
  };
}

const slotTitle = (props: SlotProps) => (props.at ? t("Write a post for this slot") : t("Posts hold this time for the next 2 months. Click to see them in the calendar."));

function AddTimes() {
  const addSlots = useAddSlots();
  const [open, setOpen] = createSignal(false);
  const [weekdays, setWeekdays] = createSignal<number[]>([1, 3, 5]);
  const [time, setTime] = createSignal("18:00");

  const toggleDay = (weekday: number) =>
    setWeekdays((current) => (current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday]));

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger type="button" aria-label={t("Add times")} class={cx(buttonVariants({ variant: "secondary" }), "gap-1 pl-1 max-lg:pr-1")}>
        <Icon name="plus-add" class="size-5" />
        <span class="max-lg:hidden">{t("Add times")}</span>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="z-[10000] flex w-80 flex-col gap-2 rounded-xl border-white/10 p-3">
          <div class="grid grid-cols-7 gap-1">
            <For each={QUEUE_WEEKDAYS}>
              {(day) => {
                const on = () => weekdays().includes(day.weekday);
                return (
                  <button
                    type="button"
                    aria-pressed={on()}
                    aria-label={t(day.name)}
                    class={cx(
                      "grid h-7 min-w-0 place-items-center rounded-md border text-xs font-medium press focus-ring",
                      on()
                        ? "border-primary/70 bg-primary/10 text-foreground"
                        : "border-(--border-input) text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => toggleDay(day.weekday)}
                  >
                    {t(day.short)}
                  </button>
                );
              }}
            </For>
          </div>
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <TimePicker value={time()} label={t("Slot time")} onChange={setTime} />
            </div>
            <Button
              class="shrink-0 px-3"
              disabled={!weekdays().length}
              onClick={() => {
                addSlots(weekdays(), time());
                setOpen(false);
              }}
            >
              {t("Add")}
            </Button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function AddToDay(props: { weekday: number; name: string }) {
  const addSlots = useAddSlots();
  const [open, setOpen] = createSignal(false);
  let show: (() => void) | undefined;

  return (
    <Popover placement="bottom" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={t("Add a time on {day}", { day: props.name })}
        class="grid h-7 w-full shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 press hover:bg-accent hover:text-foreground focus-ring focus-visible:opacity-100 group-hover:opacity-100 data-[expanded]:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Icon name="plus-add-small" class="size-5" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="z-[10000] w-auto rounded-xl border-white/10 p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            show?.();
          }}
        >
          <TimeList
            ref={(fn) => (show = fn)}
            class="max-h-72"
            value="18:00"
            onPick={(time) => {
              addSlots([props.weekday], time);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function SlotChip(props: SlotProps) {
  const actions = useSlotActions();
  return (
    <div class="group/slot relative min-w-0">
      <button
        type="button"
        title={slotTitle(props)}
        class={cx(chipClass, "relative w-full")}
        style={{ "--cal-color": props.next ? "var(--plane-accent-primary)" : "var(--plane-border-strong-1)" }}
        onClick={() => actions.open(props)}
      >
        <span aria-hidden="true" class="cal-chip-bar" />
        <span class={cx("cal-chip-text flex min-w-0 flex-1 flex-col gap-px py-1 pr-1.5 pl-3", !props.at && "opacity-60")}>
          <span class="cal-chip-title tabular-nums">{props.slot.time}</span>
          <span class="cal-chip-meta truncate">{props.at ? slotDate(props.at) : t("Taken")}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={t("Remove {day} {time}", { day: props.dayName, time: props.slot.time })}
        class="absolute top-1 right-1 grid size-5 place-items-center rounded text-muted-foreground opacity-0 press hover:bg-secondary hover:text-foreground focus-ring focus-visible:opacity-100 group-hover/slot:opacity-100 [@media(hover:none)]:opacity-100"
        onClick={() => actions.remove(props.slot.id)}
      >
        <Icon name="close-remove" class="size-4" />
      </button>
    </div>
  );
}

function SlotRow(props: SlotProps) {
  const actions = useSlotActions();
  return (
    <div class="group relative flex h-11 items-center gap-3 rounded-md px-3 transition-colors hover:bg-accent">
      <button type="button" class="absolute inset-0 rounded-md focus-ring" aria-label={slotTitle(props)} title={slotTitle(props)} onClick={() => actions.open(props)} />
      <span class="pointer-events-none w-14 shrink-0 text-sm tabular-nums text-foreground">{props.slot.time}</span>
      <span class="pointer-events-none min-w-0 truncate text-sm text-muted-foreground">{props.at ? slotDate(props.at) : t("Taken")}</span>
      <Show when={props.next}>
        <span class="pointer-events-none shrink-0 text-xs font-medium text-(--plane-accent-primary)">{t("Next up")}</span>
      </Show>
      <button
        type="button"
        aria-label={t("Remove {day} {time}", { day: props.dayName, time: props.slot.time })}
        class="relative ml-auto grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 press hover:bg-secondary hover:text-foreground focus-ring focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        onClick={() => actions.remove(props.slot.id)}
      >
        <Icon name="close-remove" class="size-4" />
      </button>
    </div>
  );
}

export function DashboardQueueView() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  useQueueSlots();

  const back = () => (typeof params.back === "string" ? QUEUE_RETURN_LABELS[params.back as DashboardView] : undefined);
  const listed = () => isPhone() || params.view === "list";

  // Re-read each minute, so a slot that has passed moves on to its next date.
  const [now, setNow] = createSignal(Date.now());
  const ticker = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(ticker));

  const open = createMemo(() => {
    now();
    return nextQueueTimes(Infinity);
  });
  const firstOpen = createMemo(() => firstOpenBySlot(open()));
  const today = () => zonedParts(now()).weekday;
  const onDay = (weekday: number) => queueSlots().filter((slot) => slot.weekday === weekday);
  const slotProps = (slot: QueueSlot, name: string): SlotProps => ({
    slot,
    dayName: t(name),
    get at() {
      return firstOpen().get(slot.id);
    },
    get next() {
      return !!this.at && this.at.getTime() === open()[0]?.getTime();
    },
  });

  const clear = () => {
    const userId = auth.ownerId();
    if (userId) toast(t("Queue cleared"), { action: { label: t("Undo"), onClick: clearQueueSlots(userId) } });
  };

  const hint = () => t("The days and times you post each week. A queued post goes to the next slot no other post holds.");

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardPageHeader>
        <span class="min-w-0 truncate px-1 text-xs text-(--plane-text-placeholder) max-lg:hidden">{t("Times in {zone}", { zone: timeZoneName() })}</span>
        <Show when={queueSlots().length}>
          <Button variant="ghost" aria-label={t("Clear all")} class={cx("text-muted-foreground max-lg:px-1", back() && "max-lg:hidden")} onClick={clear}>
            <Icon name="trash" class="size-5 lg:hidden" />
            <span class="max-lg:hidden">{t("Clear all")}</span>
          </Button>
        </Show>
        <AddTimes />
        <Show when={back()}>
          {(label) => (
            <Button
              variant="secondary"
              aria-label={t("Back to {label}", { label: t(label()) })}
              class="min-w-0 shrink max-lg:px-1"
              onClick={() => setParams({ dashboard: params.back as string, back: undefined, view: undefined })}
            >
              <PlaneIcon name="chevron-left" class="size-5 lg:hidden" />
              <span class="truncate max-lg:hidden">{t("Back to {label}", { label: t(label()) })}</span>
            </Button>
          )}
        </Show>
        <div class="contents max-md:hidden">
          <PageToggle label={t("Queue view")} options={VIEWS} value={listed() ? "list" : "week"} onChange={(view) => setParams({ view: view === "list" ? "list" : undefined }, { replace: true })} />
        </div>
      </DashboardPageHeader>

      <Show
        when={listed()}
        fallback={
          <section class="relative min-h-0 flex-1 overflow-auto overscroll-contain">
            <div class="grid min-h-full min-w-[46rem] select-none [grid-template-rows:auto_1fr]">
              <div class="sticky top-0 z-20 grid grid-cols-7 border-b border-(--plane-border-subtle) bg-(--plane-layer-1)">
                <For each={QUEUE_WEEKDAYS}>
                  {(day) => (
                    <div class="@container flex h-9 items-center border-r border-(--plane-border-subtle) px-2.5 text-xs font-medium text-(--plane-text-tertiary) last:border-r-0">
                      <span class="whitespace-nowrap @[4.5rem]:hidden">{t(day.short)}</span>
                      <span class="hidden whitespace-nowrap @[4.5rem]:inline">{t(day.name)}</span>
                    </div>
                  )}
                </For>
              </div>
              <div class="grid grid-cols-7">
                <For each={QUEUE_WEEKDAYS}>
                  {(day) => (
                    <div class={cx("group flex min-w-0 flex-col gap-0.5 border-r border-border-strong p-1 last:border-r-0", today() === day.weekday && "bg-(--plane-fill-faint)")}>
                      <For each={onDay(day.weekday)}>{(slot) => <SlotChip {...slotProps(slot, day.name)} />}</For>
                      <AddToDay weekday={day.weekday} name={t(day.name)} />
                    </div>
                  )}
                </For>
              </div>
            </div>
            <Show when={!queueSlots().length}>
              <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 pt-10 text-center text-(--plane-text-tertiary)">
                <SquirrelAsleep width={92} class="opacity-70" />
                <span class="max-w-md rounded-md bg-(--plane-surface-1) px-2 py-1 text-sm">{hint()}</span>
              </div>
            </Show>
          </section>
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show
            when={queueSlots().length}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-(--plane-text-tertiary)">
                <SquirrelAsleep width={92} class="opacity-70" />
                <span class="max-w-md text-sm">{hint()}</span>
              </div>
            }
          >
            <div class="flex flex-col px-3 pb-6">
              <For each={QUEUE_WEEKDAYS}>
                {(day) => (
                  <Show when={onDay(day.weekday).length}>
                    <section class="flex flex-col">
                      <SectionHeader id={day.name} label={t(day.name)} />
                      <For each={onDay(day.weekday)}>{(slot) => <SlotRow {...slotProps(slot, day.name)} />}</For>
                    </section>
                  </Show>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
