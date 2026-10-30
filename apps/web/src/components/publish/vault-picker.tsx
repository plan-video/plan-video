/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createSignal } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { VAULT_KINDS, loadVault, markVaultUsed, searchVault, vaultItems, vaultKind, type VaultItem, type VaultKind } from "@/lib/vault";

/** A button that opens the vault and hands the picked item back. */
export function VaultPicker(props: {
  onPick(item: VaultItem): void;
  class?: string;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** The kind it opens on, instead of all of them. */
  kind?: VaultKind;
  /** Draws the button as just this icon, named by `label` in a tooltip. The caller styles it with `class`. */
  icon?: string;
  label?: string;
}) {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [kind, setKind] = createSignal<VaultKind | "all">(props.kind ?? "all");

  createEffect(() => loadVault(auth.user()?.id));

  const results = () => searchVault(vaultItems(), query(), kind());

  const pick = (item: VaultItem) => {
    markVaultUsed(item.id);
    props.onPick(item);
    setOpen(false);
  };

  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setKind(props.kind ?? "all");
    }
  };

  return (
    <Popover placement={props.placement ?? "bottom-end"} open={open()} onOpenChange={openChange}>
      <Show
        when={props.icon}
        fallback={
          <PopoverTrigger
            type="button"
            class={cx(
              "flex h-6 items-center gap-1 rounded-md pl-1 pr-1.5 text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring",
              open() && "bg-accent text-foreground",
              props.class,
            )}
          >
            <Icon name="vault" class="size-4" />
            <span class="cap-centered text-xs">{t("Vault")}</span>
          </PopoverTrigger>
        }
      >
        {(icon) => (
          <Tooltip>
            <TooltipTrigger<typeof PopoverTrigger>
              as={(triggerProps: object) => (
                <PopoverTrigger {...triggerProps} type="button" aria-label={props.label} class={props.class}>
                  <Icon name={icon()} class="size-5" />
                </PopoverTrigger>
              )}
            />
            <TooltipContent>{props.label}</TooltipContent>
          </Tooltip>
        )}
      </Show>
      <PopoverPortal>
        <PopoverContent data-calendar-keep-popup class="z-[10000] w-80 overflow-hidden rounded-xl p-0">
          <SearchInput placeholder={t("Search the vault")} value={query()} onValue={setQuery} />
          <div class="flex gap-0.5 px-2 pt-2" role="tablist" aria-label={t("Kind")}>
            <KindTab selected={kind() === "all"} onClick={() => setKind("all")}>
              {t("All")}
            </KindTab>
            <For each={VAULT_KINDS}>
              {(option) => (
                <KindTab selected={kind() === option.id} onClick={() => setKind(option.id)}>
                  {t(option.label)}
                </KindTab>
              )}
            </For>
          </div>
          <div class="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-2">
            <Show
              when={results().length}
              fallback={
                <p class="px-2 py-6 text-center text-xs text-muted-foreground">
                  {vaultItems().length ? t("Nothing matches.") : t("Your vault is empty.")}
                </p>
              }
            >
              <For each={results()}>
                {(item) => (
                  <button
                    type="button"
                    class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-ring"
                    onClick={() => pick(item)}
                  >
                    <span class="flex w-full items-center gap-1.5">
                      <span class="min-w-0 flex-1 truncate text-xs text-foreground">{item.title}</span>
                      <Show when={item.pinned}>
                        <Icon name="favorited" class="size-3.5 text-muted-foreground" />
                      </Show>
                      <span class="shrink-0 text-xs text-muted-foreground">{t(vaultKind(item.kind).singular)}</span>
                    </span>
                    <span class="line-clamp-2 whitespace-pre-line text-xs leading-4 text-muted-foreground">{item.body}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
          <div class="flex h-9 items-center border-t border-border px-2">
            <button
              type="button"
              class="rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
              onClick={() => {
                setOpen(false);
                setParams({ dashboard: "vault", date: undefined, view: undefined });
              }}
            >
              {t("Manage vault")}
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function KindTab(props: { selected: boolean; onClick(): void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      class="cap-trim h-6 rounded-md px-2 text-xs press focus-ring"
      classList={{
        "bg-secondary text-foreground": props.selected,
        "text-muted-foreground hover:bg-accent hover:text-foreground": !props.selected,
      }}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}
