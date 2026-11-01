/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createContext, createSignal, onCleanup, onMount, useContext, type Accessor, type JSX } from "solid-js";

import { PlaneIcon, type PlaneIconName } from "@/components/dashboard/plane-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { isInputTarget } from "@/utils";

export type DashboardCrumb = { label: string; icon?: PlaneIconName; onClick?(): void };

const CrumbsContext = createContext<Accessor<DashboardCrumb[]>>(() => []);

export const DashboardCrumbsProvider = CrumbsContext.Provider;

type DashboardPageHeaderProps = {
  crumbs?: DashboardCrumb[];
  nav?: JSX.Element;
  /** Gives the crumb's room to the page's controls on phones. */
  noPhoneCrumbs?: boolean;
  children?: JSX.Element;
};

export function DashboardPageHeader(props: DashboardPageHeaderProps) {
  const fromShell = useContext(CrumbsContext);
  const crumbs = () => props.crumbs ?? fromShell();

  return (
    <header class="relative z-[18] flex h-11 w-full shrink-0 items-center gap-3 border-b border-(--plane-border-subtle) bg-(--plane-surface-1) pr-5 pl-[14px] max-md:gap-2 max-md:px-3">
      <nav aria-label={t("Breadcrumb")} class={cx("flex min-w-0 shrink-0 items-center gap-0.5 max-md:shrink", props.noPhoneCrumbs && "max-md:hidden")}>
        <For each={crumbs()}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <span aria-hidden="true" class="flex items-center px-1 text-(--plane-text-placeholder)">
                  <PlaneIcon name="chevron-right" class="size-3.5" />
                </span>
              </Show>
              <DashboardCrumbItem crumb={crumb} last={index() === crumbs().length - 1} />
            </>
          )}
        </For>
      </nav>
      {props.nav}
      <div class="ml-auto flex min-w-0 items-center justify-end gap-2 max-md:shrink-0">{props.children}</div>
    </header>
  );
}

function DashboardCrumbItem(props: { crumb: DashboardCrumb; last: boolean }) {
  const content = () => (
    <>
      <Show when={props.crumb.icon}>
        {(icon) => <PlaneIcon name={icon()} class={cx("size-4", props.last ? "text-(--plane-text-secondary)" : "text-(--plane-text-tertiary)")} />}
      </Show>
      <span class={cx("cap-centered max-w-[180px] truncate", props.last ? "text-(--plane-text-primary)" : "text-(--plane-text-secondary)")}>{props.crumb.label}</span>
    </>
  );
  const base = "flex h-7 items-center gap-2 rounded-md px-1.5 text-sm leading-5 font-medium";

  return (
    <Show
      when={props.crumb.onClick && !props.last}
      fallback={
        <span aria-current={props.last ? "page" : undefined} class={base}>
          {content()}
        </span>
      }
    >
      <button
        type="button"
        class={cx(base, "outline-none press hover:bg-(--plane-layer-transparent-hover) focus-ring [&:hover_span]:text-(--plane-text-primary)")}
        onClick={() => props.crumb.onClick?.()}
      >
        {content()}
      </button>
    </Show>
  );
}

export function DashboardGroupLabel(props: { children: JSX.Element; action?: JSX.Element; class?: string }) {
  return (
    <div class={cx("flex min-h-5 items-center gap-2", props.class)}>
      <h2 class="min-w-0 flex-1 truncate text-sm leading-5 font-medium text-foreground">{props.children}</h2>
      {props.action}
    </div>
  );
}

export function DashboardFilterCount(props: { shown: number; total: number }) {
  return (
    <Show when={props.total > 0 && props.shown !== props.total}>
      <span class="shrink-0 text-xs tabular-nums text-(--plane-text-placeholder)">{t("{shown} of {total}", { shown: props.shown, total: props.total })}</span>
    </Show>
  );
}

/** Folds to an icon so the ⌘K box stays the only search field on screen. */
export function DashboardHeaderSearch(props: {
  value: string;
  placeholder: string;
  label?: string;
  onInput(value: string): void;
  class?: string;
}) {
  const [opened, setOpened] = createSignal(false);
  const open = () => opened() || props.value !== "";
  let field: HTMLInputElement | undefined;
  const reveal = () => {
    setOpened(true);
    queueMicrotask(() => field?.focus());
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isInputTarget(event)) return;
      if ((event.target as HTMLElement | null)?.closest?.("[role=dialog], [role=menu], [role=listbox]")) return;
      event.preventDefault();
      reveal();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <Show
      when={open()}
      fallback={
        <Tooltip placement="bottom" openDelay={120}>
          <TooltipTrigger
            as="button"
            type="button"
            aria-label={props.label ?? props.placeholder}
            aria-keyshortcuts="/"
            class="grid size-7 shrink-0 place-items-center rounded-md text-(--plane-text-tertiary) outline-none press hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring"
            onClick={reveal}
          >
            <PlaneIcon name="search" class="size-4" />
          </TooltipTrigger>
          <TooltipContent shortcut="/">{props.label ?? props.placeholder}</TooltipContent>
        </Tooltip>
      }
    >
      <label
        class={cx(
          "flex h-7 w-56 min-w-0 items-center gap-1.5 rounded-md border border-(--plane-border-subtle-1) bg-(--plane-layer-1) px-2 transition-colors animate-in fade-in-0 focus-within:border-(--plane-border-strong) hover:bg-(--plane-layer-1-hover)",
          props.class,
        )}
      >
        <PlaneIcon name="search" class="size-3.5 text-(--plane-text-placeholder)" />
        <input
          ref={field}
          type="text"
          data-slot="page-search"
          value={props.value}
          placeholder={props.placeholder}
          aria-label={props.label ?? props.placeholder}
          class="min-w-0 flex-1 bg-transparent text-sm text-(--plane-text-primary) outline-none placeholder:text-(--plane-text-placeholder)"
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onBlur={() => {
            if (!props.value) setOpened(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              props.onInput("");
              event.currentTarget.blur();
            }
          }}
          onKeyUp={(event) => event.stopPropagation()}
        />
      </label>
    </Show>
  );
}
