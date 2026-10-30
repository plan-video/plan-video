/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal, type JSX } from "solid-js";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";

import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/lib/i18n";

export function Section(props: { label: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex h-5 min-w-0 items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground">{props.label}</span>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div
      class="grid gap-0.5 rounded-md bg-accent p-0.5"
      style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label={props.label}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.id}
            class="h-6 truncate rounded-[5px] px-1 text-xs tabular-nums transition-colors focus-ring"
            classList={{
              "bg-secondary-hover font-450 text-foreground": props.value === option.id,
              "text-muted-foreground hover:text-foreground": props.value !== option.id,
            }}
            onClick={() => props.onChange(option.id)}
          >
            {t(option.label)}
          </button>
        )}
      </For>
    </div>
  );
}

export function Toggle(props: { label: string; icon?: string; swatch?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      class="flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs transition-colors focus-ring"
      classList={{
        "border-primary/60 bg-primary/15 font-450 text-foreground": props.on,
        "border-border-input text-muted-foreground hover:text-foreground": !props.on,
      }}
      onClick={() => props.onChange(!props.on)}
    >
      <Show when={props.icon}>
        {(icon) => <img src={icon()} alt="" draggable={false} class="size-3.5 object-contain" classList={{ "opacity-60": !props.on }} />}
      </Show>
      <Show when={props.swatch}>
        {(swatch) => <span class="size-2 rounded-full" style={{ background: swatch(), opacity: props.on ? 1 : 0.6 }} />}
      </Show>
      <span class="truncate">{props.label}</span>
    </button>
  );
}

const [moreOpen, setMoreOpen] = createSignal(false);

export function MoreOptions(props: { children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={moreOpen()}
        class="flex h-6 items-center gap-1 self-start rounded-md pr-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
        onClick={() => setMoreOpen(!moreOpen())}
      >
        <ChevronDownIcon class="size-3.5 transition-transform" classList={{ "-rotate-90": !moreOpen() }} stroke-width={2} />
        {t("More options")}
      </button>
      <Show when={moreOpen()}>
        <div class="flex flex-col gap-4">{props.children}</div>
      </Show>
    </div>
  );
}

export function AddButton(props: { label?: string; busy?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <div class="shrink-0 border-t border-border p-3">
      <button
        type="button"
        class="flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-450 text-primary-foreground transition-colors hover:bg-primary-hover focus-ring disabled:opacity-60"
        disabled={props.busy || props.disabled}
        onClick={() => props.onClick()}
      >
        <Show when={props.busy}>
          <Icon name="spinner-loader" class="-ml-1 size-5 shrink-0 animate-spin" />
        </Show>
        <span class="min-w-0 truncate">{props.label ?? t("Add to scene")}</span>
      </button>
    </div>
  );
}

export function NameRow(props: { label: string; color: string; value: string; onChange: (value: string) => void }) {
  return (
    <label class="flex h-8 items-center gap-2 rounded-md bg-input px-2.5 focus-within:ring-1 focus-within:ring-ring">
      <span class="w-12 shrink-0 text-xs font-450" style={{ color: props.color }}>{props.label}</span>
      <input
        type="text"
        value={props.value}
        placeholder={t("Name")}
        aria-label={t("{role} name", { role: props.label })}
        onInput={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => event.stopPropagation()}
        class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-7 items-center gap-3">
      <span class="w-20 shrink-0 truncate text-xs text-muted-foreground">{props.label}</span>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

export function SwapButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-5 items-center gap-0.5 rounded-sm pr-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
      onClick={() => props.onClick()}
    >
      <Icon name="switch-flip" class="size-4" />
      {t("Swap")}
    </button>
  );
}

// The popover positioner sizes itself to its contents, which would blow pictures up to their full
// file size. Pin it to the row that opened it.
const PICK_PANEL_STYLE = `
  [data-popper-positioner]:has(> [data-pick-panel]) {
    min-width: 0 !important;
    width: var(--kb-popper-anchor-width) !important;
    max-width: var(--kb-popper-anchor-width) !important;
  }
`;

export function PickPanel(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor?: () => HTMLElement | undefined;
  trigger: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Popover sameWidth placement="bottom-start" gutter={4} open={props.open} onOpenChange={props.onOpenChange} anchorRef={props.anchor}>
      {props.trigger}
      <PopoverPortal>
        <style>{PICK_PANEL_STYLE}</style>
        <PopoverContent
          data-pick-panel=""
          class="z-[10000] overflow-hidden rounded-lg border-border-input p-1.5"
          style={{ width: "var(--kb-popper-anchor-width)", "max-width": "var(--kb-popper-anchor-width)", "min-width": "0" }}
        >
          {props.children}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

export function PickRow(props: {
  label?: string;
  value: string;
  icon?: string;
  title?: string;
  dim?: boolean;
  anchor?: () => HTMLElement | undefined;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <PickPanel
      open={open()}
      onOpenChange={setOpen}
      anchor={props.anchor}
      trigger={
        <PopoverTrigger
          as="button"
          type="button"
          title={props.title}
          aria-label={props.title}
          class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-input pl-2.5 pr-1.5 text-xs transition-colors hover:bg-secondary-hover focus-ring"
        >
          <Show when={props.label}>
            <span class="shrink-0 text-muted-foreground">{props.label}</span>
          </Show>
          <Show when={props.icon}>
            {(icon) => <img src={icon()} alt="" draggable={false} class="size-5 shrink-0 rounded-sm bg-[#0D1014] object-cover object-top" />}
          </Show>
          <span class="min-w-0 flex-1 truncate text-left font-450 text-foreground" classList={{ "opacity-50": props.dim }}>
            {props.value}
          </span>
          <Icon name="chevron-down" class={open() ? "shrink-0 rotate-180 text-muted-foreground transition-transform" : "shrink-0 text-muted-foreground transition-transform"} />
        </PopoverTrigger>
      }
    >
      {props.children(() => setOpen(false))}
    </PickPanel>
  );
}

/** How many equal cells across leave the last row fullest: 7 → 4+3, 9 → 3×3. */
function evenColumns(count: number, max: number): number {
  if (count <= max) return Math.max(1, count);
  const filled = (columns: number) => (count % columns === 0 ? 1 : (count % columns) / columns);
  let best = max;
  for (let columns = max - 1; columns >= 2; columns--) {
    if (filled(columns) > filled(best)) best = columns;
  }
  return best;
}

export function OptionList<T extends string>(props: {
  options: { id: T; label: string }[];
  value?: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div
      class="grid gap-1"
      style={{ "grid-template-columns": `repeat(${evenColumns(props.options.length, 3)}, minmax(0, 1fr))` }}
      role="listbox"
      aria-label={props.label}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="option"
            aria-selected={props.value === option.id}
            class="h-7 truncate rounded-md px-2 text-xs transition-colors focus-ring"
            classList={{
              "bg-secondary-hover font-450 text-foreground": props.value === option.id,
              "text-muted-foreground hover:bg-accent hover:text-foreground": props.value !== option.id,
            }}
            onClick={() => props.onChange(option.id)}
          >
            {t(option.label)}
          </button>
        )}
      </For>
    </div>
  );
}

export function PictureList(props: { options: { id: string; label: string; url: string }[]; value?: string; onChange: (id: string) => void; label?: string }) {
  return (
    <div class="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto" role="listbox" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="option"
            title={option.label}
            aria-label={option.label}
            aria-selected={props.value === option.id}
            class="relative aspect-square min-w-0 overflow-hidden rounded-md border bg-[#0D1014] focus-ring"
            classList={{
              "border-primary ring-1 ring-primary": props.value === option.id,
              "border-transparent hover:border-border-strong": props.value !== option.id,
            }}
            onClick={() => props.onChange(option.id)}
          >
            <img src={option.url} alt="" draggable={false} loading="lazy" class="pointer-events-none absolute inset-0 size-full object-cover object-top" />
          </button>
        )}
      </For>
    </div>
  );
}

export function ToggleGrid(props: { children: JSX.Element; count: number }) {
  return (
    <div class="grid gap-1.5" style={{ "grid-template-columns": `repeat(${Math.min(2, Math.max(1, props.count))}, minmax(0, 1fr))` }}>
      {props.children}
    </div>
  );
}

export function Stepper(props: { value: number; min: number; max: number; onChange: (value: number) => void; label?: string }) {
  const step = (by: number) => props.onChange(Math.min(props.max, Math.max(props.min, props.value + by)));
  return (
    <div class="grid h-7 grid-cols-[1.75rem_1fr_1.75rem] items-center rounded-md bg-accent p-0.5" role="group" aria-label={props.label}>
      <button
        type="button"
        aria-label={t("Decrease")}
        disabled={props.value <= props.min}
        class="grid size-6 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-secondary-hover hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-40"
        onClick={() => step(-1)}
      >
        <Icon name="minus" />
      </button>
      <span class="text-center text-xs font-450 tabular-nums text-foreground" aria-live="polite">{props.value}</span>
      <button
        type="button"
        aria-label={t("Increase")}
        disabled={props.value >= props.max}
        class="grid size-6 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-secondary-hover hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-40"
        onClick={() => step(1)}
      >
        <Icon name="plus-add" />
      </button>
    </div>
  );
}

export function WeaponTile(props: { label: string; url: string; selected: boolean; flip?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-pressed={props.selected}
      class="flex min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-md border bg-[#0D1014] px-1 pb-1 pt-2 focus-ring"
      classList={{
        "border-primary": props.selected,
        "border-border hover:border-border-strong": !props.selected,
      }}
      onClick={() => props.onClick()}
    >
      <img
        src={props.url}
        alt=""
        draggable={false}
        loading="lazy"
        class="pointer-events-none h-6 w-full object-contain"
        classList={{ "-scale-x-100": props.flip }}
      />
      <span class="flex h-[22px] items-center justify-center">
        <span
          class="line-clamp-2 break-words text-center text-xxs leading-[11px]"
          classList={{ "text-white/95": props.selected, "text-white/60": !props.selected }}
        >
          {props.label}
        </span>
      </span>
    </button>
  );
}

export function WeaponGrid(props: { children: JSX.Element }) {
  return <div class="grid grid-cols-3 gap-1.5">{props.children}</div>;
}
