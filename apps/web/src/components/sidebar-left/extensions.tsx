/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";

import { SidebarTabs } from "@/agent-chat";
import { Icon } from "@/components/ui/icon";
import { EXTENSIONS, openExtension, setOpenExtension, type Extension } from "@/extensions";
import { t } from "@/lib/i18n";

/**
 * The left sidebar's Extensions tab: the market, or the extension opened from
 * it. An open extension takes over the header line, with its way back.
 */
export function ExtensionsPanel() {
  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <Show
        when={openExtension()}
        keyed
        fallback={
          <>
            <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <div class="flex min-w-0 flex-1 items-center">
                <SidebarTabs />
              </div>
            </div>
            <Market />
          </>
        }
      >
        {(extension) => <OpenExtension extension={extension} />}
      </Show>
    </div>
  );
}

function OpenExtension(props: { extension: Extension }) {
  return (
    <>
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-2 pr-4">
        <button
          type="button"
          aria-label={t("Back to extensions")}
          title={t("All extensions")}
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
          onClick={() => setOpenExtension(null)}
        >
          <Icon name="chevron-left" />
        </button>
        <span class="min-w-0 truncate text-[13px] font-medium text-foreground">{t(props.extension.name)}</span>
        <Show when={props.extension.tag}>{(tag) => <TagBadge tag={tag()} />}</Show>
      </div>
      <Dynamic component={props.extension.Panel} />
    </>
  );
}

function Market() {
  const [query, setQuery] = createSignal("");

  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    return EXTENSIONS.filter((extension) => {
      if (extension.unlisted) return false;
      const text = `${t(extension.name)} ${extension.tag ?? ""} ${t(extension.summary)}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="flex flex-col gap-3 px-3 pb-3 pt-3">
        <label class="flex h-8 items-center gap-1 rounded-md bg-input pl-1 pr-2 focus-within:ring-1 focus-within:ring-ring">
          <Icon name="search" class="text-muted-foreground" />
          <input
            type="text"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t("Search extensions")}
            aria-label={t("Search extensions")}
            autocomplete="off"
            class="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>

        <Show
          when={shown().length}
          fallback={<span class="py-6 text-center text-xs text-muted-foreground">{t("No extensions match that.")}</span>}
        >
          <div class="flex min-w-0 flex-col gap-2">
            <For each={shown()}>{(extension) => <ExtensionCard extension={extension} />}</For>
          </div>
        </Show>
      </div>
    </div>
  );
}

/**
 * An extension in the market: one card, its cover inset in a soft frame and
 * its name and tag beneath, inside the frame, so each name plainly belongs to
 * its cover.
 */
function ExtensionCard(props: { extension: Extension }) {
  return (
    <button
      type="button"
      title={t(props.extension.summary)}
      class="group flex w-full min-w-0 flex-col gap-1 rounded-lg bg-input/50 p-1 text-left transition-colors hover:bg-input focus-ring"
      onClick={() => setOpenExtension(props.extension.id)}
    >
      {/* The covers size themselves for a tall card; here they fill a short tile. */}
      <div class="relative h-16 w-full overflow-hidden rounded-[4px] bg-black inset-ring-1 inset-ring-white/6 [&>*]:h-full [&>*]:py-3">
        <Dynamic component={props.extension.Cover} />
      </div>
      <div class="flex h-7 w-full min-w-0 items-center gap-1.5 pl-1.5 pr-1">
        <span class="min-w-0 truncate text-xs font-medium text-foreground">{t(props.extension.name)}</span>
        <Show when={props.extension.tag}>{(tag) => <TagBadge tag={tag()} />}</Show>
        <Icon
          name="chevron-right"
          class="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>
    </button>
  );
}

/** What an extension is for as a small tag, in the game's colors when it is for one. */
function TagBadge(props: { tag: string }) {
  return (
    <span
      class="shrink-0 rounded-[4px] px-1.5 py-px text-xxs font-450"
      classList={{
        "bg-[#FF4655]/15 text-[#C8202F] dark:text-[#FF6B76]": props.tag === "Valorant",
        "bg-[#F6D180]/30 text-[#8A6410] dark:bg-[#F6D180]/15 dark:text-[#E7C56A]": props.tag === "CS2",
        "bg-[#FF7A00]/15 text-[#B45309] dark:text-[#FF9A3C]": props.tag === "Call of Duty",
        "bg-[#F2A900]/20 text-[#8F6400] dark:bg-[#F2A900]/15 dark:text-[#F2C14E]": props.tag === "PUBG",
        "bg-[#CD412B]/15 text-[#A3301F] dark:text-[#E07A6A]": props.tag === "Rust",
        "bg-foreground/10 text-muted-foreground": !["Valorant", "CS2", "Call of Duty", "PUBG", "Rust"].includes(props.tag),
      }}
    >
      {props.tag}
    </span>
  );
}

