/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { Kbd } from "@/components/ui/kbd";
import { msg, t } from "@/lib/i18n";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Command as CommandPrimitive, defaultFilter } from "cmdk-solid";
import { isInputTarget } from "@/utils";

import { rankMatches } from "./search-rank";
import type { DashboardView } from "./types";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

type SearchPage = {
  view: DashboardView;
  name: string;
  section: string;
  icon: string;
  also?: string;
};

const PAGES: SearchPage[] = [
  { view: "new-post", name: msg("New post"), section: msg("Create"), icon: "document" },
  { view: "bulk-tools", name: msg("Bulk tools"), section: msg("Create"), icon: "layers" },
  { view: "calendar", name: msg("Calendar"), section: msg("Calendar"), icon: "calendar" },
  { view: "queue", name: msg("Auto-schedule"), section: msg("Calendar"), icon: "clock", also: msg("Queue") },
  { view: "posts", name: msg("Post list"), section: msg("Calendar"), icon: "list" },
  { view: "scheduled", name: msg("Scheduled"), section: msg("Calendar"), icon: "clock" },
  { view: "drafts", name: msg("Drafts"), section: msg("Calendar"), icon: "document" },
  { view: "posted", name: msg("Posted"), section: msg("Calendar"), icon: "circle-check" },
  { view: "failed", name: msg("Failed posts"), section: msg("Calendar"), icon: "alert-warning" },
  { view: "agent", name: msg("Agent"), section: msg("Pages"), icon: "ask-chat" },
  { view: "projects", name: msg("Projects"), section: msg("Pages"), icon: "navigation.folder" },
  { view: "media", name: msg("Media"), section: msg("Pages"), icon: "all-media-types" },
  { view: "templates", name: msg("Templates"), section: msg("Pages"), icon: "document" },
  { view: "vault", name: msg("Vault"), section: msg("Pages"), icon: "vault" },
  { view: "plugs", name: msg("Plugs"), section: msg("Pages"), icon: "link" },
  { view: "analytics", name: msg("Analytics"), section: msg("Pages"), icon: "analytics" },
  { view: "analytics-posts", name: msg("Post analytics"), section: msg("Pages"), icon: "video" },
  { view: "analytics-platforms", name: msg("Platform analytics"), section: msg("Pages"), icon: "layers" },
  { view: "analytics-times", name: msg("Best times to post"), section: msg("Pages"), icon: "clock" },
  { view: "notifications", name: msg("Notifications"), section: msg("Pages"), icon: "bell" },
  { view: "account", name: msg("Account"), section: msg("Settings"), icon: "user" },
  { view: "workspace", name: msg("Workspace"), section: msg("Settings"), icon: "home" },
  { view: "connections", name: msg("Connections"), section: msg("Settings"), icon: "link" },
  { view: "settings", name: msg("General"), section: msg("Settings"), icon: "settings" },
  { view: "storage", name: msg("Storage"), section: msg("Settings"), icon: "cloud" },
  { view: "billing", name: msg("Billing"), section: msg("Settings"), icon: "billing" },
  { view: "help", name: msg("Help"), section: msg("Settings"), icon: "help" },
];

/** In English too, so the English words still find a page in another language. */
function searchValue(page: SearchPage) {
  const also = page.also ?? "";
  const english = `${page.name} ${page.section} ${also}`;
  const shown = `${t(page.name)} ${t(page.section)} ${also && t(also)}`;
  return shown === english ? english : `${shown} ${english}`;
}

type DashboardSidebarSearchProps = {
  onNavigate(view: DashboardView): void;
  placeholder?: string;
};

export function DashboardSidebarSearch(props: DashboardSidebarSearchProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");

  const sections = () => {
    const groups: { label: string; items: SearchPage[] }[] = [];
    for (const page of rankMatches(PAGES, query(), searchValue, defaultFilter)) {
      const group = groups.find((entry) => entry.label === page.section);
      if (group) group.items.push(page);
      else groups.push({ label: page.section, items: [page] });
    }
    return groups;
  };

  const choose = (view: DashboardView) => {
    setOpen(false);
    props.onNavigate(view);
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      // "/" belongs to the page: it jumps to the page's own search box, when it has one.
      if (event.key !== "/" || isInputTarget(event)) return;
      const pageSearch = document.querySelector<HTMLInputElement>("[data-slot=page-search]");
      if (!pageSearch) return;
      event.preventDefault();
      pageSearch.focus();
      pageSearch.select();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    if (!open()) return setQuery("");
    queueMicrotask(() => {
      document.querySelector<HTMLInputElement>("[data-slot=command-input]")?.focus();
    });
  });

  return (
    <>
      <button
        type="button"
        aria-label={t("Search")}
        aria-keyshortcuts="Meta+K"
        class="flex h-7 w-[364px] max-w-[36vw] items-center rounded-md border border-(--plane-border-subtle-1) bg-(--plane-layer-2) p-2 text-left outline-none transition-colors duration-200 hover:bg-(--plane-layer-2-hover) focus-ring max-md:size-9 max-md:justify-center max-md:border-0 max-md:bg-transparent"
        onClick={() => setOpen(true)}
      >
        <PlaneIcon name="search" class="mr-2 size-3.5 text-(--plane-text-placeholder) max-md:mr-0 max-md:size-5 max-md:text-(--plane-text-secondary)" />
        <span class="min-w-0 flex-1 truncate text-sm text-(--plane-text-placeholder) max-md:hidden">{props.placeholder ?? t("Search")}</span>
        {/* Each key on its own, so the ⌘ glyph does not run into the letter. */}
        <Kbd class="h-5 shrink-0 gap-[3px] rounded-md border border-(--plane-border-subtle-1) bg-(--plane-layer-1) px-1.5 text-xxs font-medium text-(--plane-text-tertiary) max-md:hidden">
          <Show when={MAC} fallback={<span>Ctrl</span>}>
            <span class="text-xs leading-none">⌘</span>
          </Show>
          <span class="leading-none">K</span>
        </Kbd>
      </button>

      <Show when={open()}>
        <Portal>
          <button
            type="button"
            aria-label={t("Close search")}
            class="fixed inset-0 z-[200] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("Search")}
            class="fixed top-1 left-1/2 z-[201] flex w-[min(100%-2rem,574px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-(--plane-border-subtle-1) bg-(--plane-surface-1) text-(--plane-text-primary) shadow-(--plane-shadow-overlay-200) outline-none animate-in fade-in-0 zoom-in-[0.98]"
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            <Command
              shouldFilter={false}
              loop
              class="flex max-h-[min(80vh,30rem)] flex-col overflow-hidden rounded-none bg-transparent"
            >
              <div class="flex h-10 shrink-0 items-center gap-2 border-b border-(--plane-border-subtle) px-3">
                <PlaneIcon name="search" class="size-3.5 text-(--plane-text-placeholder)" />
                <CommandPrimitive.Input
                  data-slot="command-input"
                  value={query()}
                  onValueChange={setQuery}
                  placeholder={t("Search pages")}
                  class="h-7 min-w-0 flex-1 bg-transparent text-sm text-(--plane-text-primary) outline-none placeholder:text-(--plane-text-placeholder)"
                />
                <Kbd class="h-5 bg-(--plane-layer-3) px-1.5 text-xxs text-(--plane-text-tertiary)">esc</Kbd>
              </div>
              <CommandList class="max-h-none flex-1 scroll-py-2 px-2 pt-1 pb-3">
                <CommandEmpty class="py-8 text-sm text-(--plane-text-placeholder)">{t("No pages found")}</CommandEmpty>
                <For each={sections()}>
                  {(group) => (
                    <CommandGroup
                      heading={t(group.label)}
                      class="p-0 [&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:h-8 [&_[cmdk-group-heading]]:items-end [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-(--plane-text-placeholder)"
                    >
                      <For each={group.items}>
                        {(page) => (
                          <CommandItem
                            value={searchValue(page)}
                            onSelect={() => choose(page.view)}
                            class="group h-8 cursor-default gap-2 rounded-md py-0 pr-2 pl-1 text-sm text-(--plane-text-secondary) data-[selected=true]:bg-(--plane-layer-transparent-hover) data-[selected=true]:text-(--plane-text-primary)"
                          >
                            <span class="grid size-6 shrink-0 place-items-center overflow-clip text-(--plane-text-placeholder) group-data-[selected=true]:text-(--plane-text-secondary)">
                              <Icon name={page.icon} class="size-6" />
                            </span>
                            <span class="min-w-0 flex-1 truncate">{t(page.name)}</span>
                            <span class="hidden text-xxs text-(--plane-text-placeholder) group-data-[selected=true]:inline">↵</span>
                          </CommandItem>
                        )}
                      </For>
                    </CommandGroup>
                  )}
                </For>
              </CommandList>
            </Command>
          </div>
        </Portal>
      </Show>
    </>
  );
}
