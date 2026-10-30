/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import { cn } from "@/components/calendar/utils";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/lib/i18n";
import {
  allTimeZones,
  chosenZone,
  clockAt,
  deviceTimeZone,
  setTimeZone,
  timeZone,
  zoneCity,
  zoneOffsetLabel,
} from "@/lib/time-zone";

type ZoneRow = { zone: string; city: string; region: string; offset: string; minutes: number; search: string };

/** Minutes ahead of UTC, read from "GMT+5:30". */
function offsetMinutes(label: string) {
  const match = /([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function zoneRows(): ZoneRow[] {
  const now = Date.now();
  return allTimeZones()
    .map((zone) => {
      const offset = zoneOffsetLabel(zone, now);
      const city = zoneCity(zone);
      const region = zone.includes("/") ? zone.split("/").slice(0, -1).join(" / ").replace(/_/g, " ") : "";
      return { zone, city, region, offset, minutes: offsetMinutes(offset), search: `${zone} ${city} ${offset}`.toLowerCase().replace(/_/g, " ") };
    })
    .sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city));
}

export function TimeZonePicker() {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));
  let list: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;

  const [rows, setRows] = createSignal<ZoneRow[]>([]);
  const shown = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? rows().filter((row) => words.every((word) => row.search.includes(word))) : rows();
  });

  const scrollTo = (index: number) =>
    requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }));

  const move = (index: number) => {
    const count = shown().length;
    if (!count) return;
    const next = Math.max(0, Math.min(count - 1, index));
    setActive(next);
    scrollTo(next);
  };

  const pick = (zone: string | null) => {
    setTimeZone(zone);
    setOpen(false);
  };

  const openChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setRows(zoneRows());
    }
    setOpen(next);
    if (!next) return;
    requestAnimationFrame(() => {
      const index = Math.max(0, shown().findIndex((row) => row.zone === timeZone()));
      setActive(index);
      const row = list?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      if (row && list) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") return;
    event.stopPropagation();
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
    if (event.key in step) {
      event.preventDefault();
      move(active() + step[event.key]!);
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault();
      move(0);
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault();
      move(shown().length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = shown()[active()];
      if (row) pick(row.zone);
    }
  };

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={openChange}>
      <PopoverTrigger
        type="button"
        aria-label={t("Change time zone")}
        class="flex h-7 max-w-64 shrink-0 items-center gap-1.5 rounded-md bg-secondary pl-2 pr-1 text-xs text-foreground press hover:bg-secondary-hover focus-ring data-[expanded]:bg-secondary-hover"
      >
        <span class="cap-centered truncate">{zoneCity(timeZone())}</span>
        <span class="cap-centered shrink-0 tabular-nums text-muted-foreground">{zoneOffsetLabel(timeZone(), now())}</span>
        <Icon name="chevron-down" class="size-5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="flex w-[22rem] flex-col overflow-hidden rounded-xl border-(--plane-border-strong) p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            input?.focus();
          }}
        >
          <div class="flex h-10 items-center gap-1 border-b border-border-strong px-2">
            <Icon name="search" class="shrink-0 text-muted-foreground" />
            <input
              ref={input}
              value={query()}
              placeholder={t("Search a city, region or GMT offset")}
              aria-label={t("Search time zones")}
              autocomplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="time-zone-list"
              aria-activedescendant={shown()[active()] ? `time-zone-${active()}` : undefined}
              class="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setActive(0);
                if (list) list.scrollTop = 0;
              }}
              onKeyDown={onKeyDown}
            />
          </div>

          <Show when={chosenZone() !== null && !query().trim()}>
            <button
              type="button"
              class="flex h-9 items-center gap-2 border-b border-border-strong px-3 text-left text-xs text-foreground transition-colors hover:bg-accent focus-ring"
              onClick={() => pick(null)}
            >
              <Icon name="clock" class="size-5 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{t("Use this device's time zone")}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{zoneCity(deviceTimeZone())}</span>
            </button>
          </Show>

          <div ref={list} id="time-zone-list" role="listbox" aria-label={t("Time zones")} class="h-72 overflow-y-auto overscroll-contain p-1">
            <For each={shown()} fallback={<p class="px-3 py-6 text-center text-xs text-muted-foreground">{t("No time zone matches “{query}”", { query: query().trim() })}</p>}>
              {(row, index) => {
                const selected = () => row.zone === timeZone();
                return (
                  <div
                    id={`time-zone-${index()}`}
                    role="option"
                    data-index={index()}
                    aria-selected={selected()}
                    class={cn(
                      "flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-xs",
                      active() === index() ? "bg-accent" : "",
                      selected() && "text-foreground",
                    )}
                    onPointerMove={() => active() !== index() && setActive(index())}
                    onClick={() => pick(row.zone)}
                  >
                    <span class="w-[4.75rem] shrink-0 tabular-nums text-xs text-muted-foreground">{row.offset}</span>
                    <span class="flex min-w-0 flex-1 flex-col leading-tight">
                      <span class="truncate text-foreground">{row.city}</span>
                      <Show when={row.region}>
                        <span class="truncate text-xxs text-muted-foreground">{row.region}</span>
                      </Show>
                    </span>
                    <span class="shrink-0 tabular-nums text-xs text-muted-foreground">{clockAt(now(), row.zone)}</span>
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-4 scale-[2.4] text-primary" />
                      </Show>
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
