/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";
import { toast } from "somoto";

import { DashboardFilterCount, DashboardGroupLabel, DashboardHeaderSearch, DashboardPageHeader } from "@/components/dashboard/page-header";
import { VaultArt } from "@/components/dashboard/empty-art";
import { createProjectMarquee } from "@/components/dashboard/project-marquee";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { Segmented, fieldControl, fieldControlBase } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import { SOCIAL_PLATFORMS, captionLength, hashtagCount } from "@/lib/social";
import {
  VAULT_KINDS,
  createVaultItem,
  deleteVaultItem,
  duplicateVaultItem,
  loadVault,
  markVaultUsed,
  normalizeHashtags,
  queueVaultInsert,
  restoreVaultItem,
  searchVault,
  setVaultSignature,
  toggleVaultPin,
  updateVaultItem,
  vaultItems,
  vaultKind,
  vaultSignature,
  type VaultDraft,
  type VaultItem,
  type VaultKind,
} from "@/lib/vault";

type Filter = VaultKind | "all";

const VAULT_GRID = "grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3";
type Editing = { id: string | null; draft: VaultDraft };

const TITLE_PLACEHOLDER: Record<VaultKind, string> = {
  caption: msg("Product launch"),
  hashtags: msg("Gaming"),
  snippet: msg("Link in bio"),
};

const BODY_PLACEHOLDER: Record<VaultKind, string> = {
  caption: msg("Write the caption the way you post it."),
  hashtags: msg("gaming, #fps clips highlights"),
  snippet: msg("Follow for more. Link in bio."),
};

const KIND_WORDS: Record<VaultKind, { none: string; add: string; edit: string }> = {
  caption: { none: msg("No captions yet."), add: msg("New caption"), edit: msg("Edit caption") },
  hashtags: { none: msg("No hashtags yet."), add: msg("New hashtag set"), edit: msg("Edit hashtag set") },
  snippet: { none: msg("No snippets yet."), add: msg("New snippet"), edit: msg("Edit snippet") },
};

export function DashboardVaultView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [filter, setFilter] = createSignal<Filter>("all");
  const [query, setQuery] = createSignal("");
  const [editing, setEditing] = createSignal<Editing | null>(null);

  createEffect(() => loadVault(auth.user()?.id));

  const results = () => searchVault(vaultItems(), query(), filter());
  // Pinned items sort first, so the two groups keep the order the drag-select counts in.
  const pinnedResults = () => results().filter((item) => item.pinned);
  const otherResults = () => results().filter((item) => !item.pinned);
  const [selected, setSelected] = createSignal<string[]>([]);
  const selectedItems = () => results().filter((item) => selected().includes(item.id));
  let anchor: string | null = null;

  // Hidden cards leave the selection, so nothing acts on what isn't shown.
  createEffect(() => {
    const shown = new Set(results().map((item) => item.id));
    if (selected().some((id) => !shown.has(id))) setSelected((current) => current.filter((id) => shown.has(id)));
  });

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const selectFromClick = (item: VaultItem, event: MouseEvent) => {
    if (event.shiftKey && anchor) {
      const ids = results().map((entry) => entry.id);
      const from = ids.indexOf(anchor);
      const to = ids.indexOf(item.id);
      if (from >= 0 && to >= 0) {
        const [low, high] = from < to ? [from, to] : [to, from];
        setSelected((current) => [...new Set([...current, ...ids.slice(low, high + 1)])]);
        return true;
      }
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || selected().length) {
      toggle(item.id);
      anchor = item.id;
      return true;
    }
    return false;
  };

  const marquee = createProjectMarquee({
    selection: () => new Set(selected()),
    onChange: (indexes, base) => {
      const items = results();
      const ids = indexes.flatMap((index) => items[Number(index)]?.id ?? []);
      setSelected([...new Set([...base, ...ids])]);
      if (ids.length) anchor = ids[ids.length - 1]!;
    },
    onRevert: (previous) => setSelected([...previous]),
  });
  const count = (kind: Filter) => (kind === "all" ? vaultItems().length : vaultItems().filter((item) => item.kind === kind).length);

  const startNew = (kind: VaultKind = filter() === "all" ? "caption" : (filter() as VaultKind)) =>
    setEditing({ id: null, draft: { kind, title: "", body: "" } });
  const startEdit = (item: VaultItem) => setEditing({ id: item.id, draft: { kind: item.kind, title: item.title, body: item.body } });

  const copy = async (item: VaultItem) => {
    try {
      await navigator.clipboard.writeText(item.body);
      markVaultUsed(item.id);
      toast.success(t("Copied"), { description: item.title });
    } catch {
      toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
    }
  };

  const useInPost = (item: VaultItem) => {
    markVaultUsed(item.id);
    queueVaultInsert(item);
    setParams({ dashboard: "new-post", date: undefined, view: undefined });
  };

  const remove = (item: VaultItem) => {
    deleteVaultItem(item.id);
    toast(t("Deleted {name}", { name: item.title }), { action: { label: t("Undo"), onClick: () => restoreVaultItem(item) } });
  };

  const removeSelected = () => {
    const chosen = selectedItems();
    if (!chosen.length) return;
    if (chosen.length === 1) return remove(chosen[0]!);
    for (const item of chosen) deleteVaultItem(item.id);
    setSelected([]);
    toast(t("{count, plural, one {Deleted # item} other {Deleted # items}}", { count: chosen.length }), {
      action: { label: t("Undo"), onClick: () => chosen.forEach(restoreVaultItem) },
    });
  };

  const copySelected = async () => {
    const chosen = selectedItems();
    if (!chosen.length) return;
    try {
      await navigator.clipboard.writeText(chosen.map((item) => item.body).join("\n\n"));
      chosen.forEach((item) => markVaultUsed(item.id));
      toast.success(t("{count, plural, one {Copied # item} other {Copied # items}}", { count: chosen.length }));
    } catch {
      toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
    }
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (editing()) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu], [role=listbox]"))) return;
      const key = event.key.toLowerCase();
      if (key === "escape" && selected().length) setSelected([]);
      else if ((key === "delete" || key === "backspace") && selected().length) removeSelected();
      else if (key === "n") startNew();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const card = (item: VaultItem, index: () => number) => (
    <VaultCard
      item={item}
      marqueeIndex={index()}
      selected={selected().includes(item.id)}
      onSelect={(event) => selectFromClick(item, event)}
      onEdit={() => startEdit(item)}
      onCopy={() => void copy(item)}
      onUse={() => useInPost(item)}
      onDuplicate={() => {
        const made = duplicateVaultItem(item.id);
        if (made && "error" in made) toast.error(t(made.error));
      }}
      onDelete={() => remove(item)}
    />
  );

  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <DashboardPageHeader>
        <Show when={vaultItems().length}>
          <DashboardFilterCount shown={results().length} total={vaultItems().length} />
          <DashboardHeaderSearch value={query()} placeholder={t("Search")} label={t("Search the vault")} onInput={setQuery} class="w-48" />
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={PlaneButton} variant="ghost" size="lg" class="gap-1 pr-1.5" aria-label={t("Show")}>
              {filter() === "all" ? t("Everything") : t(vaultKind(filter() as VaultKind).label)}
              <PlaneIcon name="chevron-down" class="size-3.5 text-(--plane-text-placeholder)" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-40">
                <For each={[{ id: "all" as const, label: msg("Everything") }, ...VAULT_KINDS]}>
                  {(option) => (
                    <DropdownMenuItem tone="neutral" onSelect={() => setFilter(option.id)}>
                      <span class="flex-1">{t(option.label)}</span>
                      <span class="text-xxs tabular-nums text-(--plane-text-placeholder)">{count(option.id)}</span>
                      <span class="grid size-3.5 place-items-center">
                        <Show when={filter() === option.id}>
                          <PlaneIcon name="check" class="size-3.5" />
                        </Show>
                      </span>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <PlaneButton variant="primary" size="lg" class="gap-1 pl-1.5" onClick={() => startNew()}>
            <PlaneIcon name="plus" class="size-3.5" />
            {t("New")}
          </PlaneButton>
        </Show>
      </DashboardPageHeader>

      <div class="min-h-0 flex-1 overflow-y-auto" onPointerDown={marquee.onPointerDown}>
        <div class="flex w-full flex-col gap-3 px-6 pt-6 pb-24">
          <Show
            when={vaultItems().length}
            fallback={<EmptyVault onNew={startNew} />}
          >
            <Show when={filter() !== "all" && results().length}>
              <p class="truncate text-xs leading-6 text-muted-foreground">{t(vaultKind(filter() as VaultKind).hint)}</p>
            </Show>
            <Show
              when={results().length}
              fallback={
                <div class="flex flex-col items-center gap-3 py-16 text-center">
                  <div class="flex flex-col gap-1">
                    <p class="text-xs text-muted-foreground">
                      {query() ? t("Nothing in the vault matches “{query}”.", { query: query() }) : t(KIND_WORDS[filter() as VaultKind].none)}
                    </p>
                    <Show when={!query() && filter() !== "all"}>
                      <p class="text-xs text-muted-foreground">{t(vaultKind(filter() as VaultKind).hint)}</p>
                    </Show>
                  </div>
                  <Button variant="secondary" onClick={() => startNew()}>
                    {t(KIND_WORDS[filter() === "all" ? "caption" : (filter() as VaultKind)].add)}
                  </Button>
                </div>
              }
            >
              <Show
                when={pinnedResults().length && otherResults().length}
                fallback={
                  <div class={VAULT_GRID}>
                    <For each={results()}>{(item, index) => card(item, index)}</For>
                  </div>
                }
              >
                <section class="flex flex-col gap-2">
                  <DashboardGroupLabel class="px-0.5">{t("Pinned")}</DashboardGroupLabel>
                  <div class={VAULT_GRID}>
                    <For each={pinnedResults()}>{(item, index) => card(item, index)}</For>
                  </div>
                </section>
                <section class="mt-3 flex flex-col gap-2">
                  <DashboardGroupLabel class="px-0.5">{t("Everything else")}</DashboardGroupLabel>
                  <div class={VAULT_GRID}>
                    <For each={otherResults()}>{(item, index) => card(item, () => pinnedResults().length + index())}</For>
                  </div>
                </section>
              </Show>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={selected().length}>
        <div class="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
          <div class="pointer-events-auto flex h-11 items-center gap-1 rounded-xl border border-border-strong bg-popover pl-3.5 pr-1.5 shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)] animate-in fade-in-0 slide-in-from-bottom-2">
            <span class="text-xs text-foreground tabular-nums">{t("{count, plural, one {# selected} other {# selected}}", { count: selected().length })}</span>
            <Show when={selected().length < results().length}>
              <button
                type="button"
                class="ml-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
                onClick={() => setSelected(results().map((item) => item.id))}
              >
                {t("Select all {count}", { count: results().length })}
              </button>
            </Show>
            <span class="mx-1.5 h-5 w-px bg-border" />
            <Button variant="ghost" class="gap-1 pl-1" onClick={() => void copySelected()}>
              <Icon name="clipboard" class="size-5" />
              {t("Copy")}
            </Button>
            <Button variant="ghost" class="gap-1 pl-1 text-destructive hover:text-destructive" onClick={removeSelected}>
              <Icon name="trash" class="size-5" />
              {t("Delete")}
            </Button>
            <Button variant="ghost" size="icon-square" aria-label={t("Clear the selection")} onClick={() => setSelected([])}>
              <Icon name="close-remove" class="size-5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </Show>

      <Show when={marquee.rect()}>
        {(box) => (
          <Portal>
            <div
              class="pointer-events-none fixed z-50 border border-primary bg-primary/20"
              style={{ left: `${box().x}px`, top: `${box().y}px`, width: `${box().width}px`, height: `${box().height}px` }}
            />
          </Portal>
        )}
      </Show>

      <Show when={editing()} keyed>
        {(current) => <VaultEditor editing={current} onClose={() => setEditing(null)} onDelete={remove} />}
      </Show>
    </div>
  );
}

function EmptyVault(props: { onNew(kind: VaultKind): void }) {
  return (
    <div class="flex flex-col items-center gap-8 pt-8 text-center">
      <div class="flex flex-col items-center gap-4">
        <VaultArt />
        <div class="flex flex-col gap-1">
          <h2 class="text-sm font-medium text-foreground">{t("Keep the words you post again and again")}</h2>
          <p class="text-xs text-muted-foreground">{t("Save them once, then drop them into any caption from the Vault button.")}</p>
        </div>
      </div>
      <div class="grid w-full max-w-2xl grid-cols-1 gap-2 text-left sm:grid-cols-3">
        <For each={VAULT_KINDS}>
          {(kind) => (
            <button
              type="button"
              class="depth-card flex flex-col items-start gap-1.5 rounded-xl border border-border-strong bg-accent/30 p-3 text-left hover:border-(--border-input) focus-ring"
              onClick={() => props.onNew(kind.id)}
            >
              <span class="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Icon name="plus-add-small" class="-ml-1 size-4 text-muted-foreground" />
                {t(kind.singular)}
              </span>
              <span class="text-xs leading-4 text-muted-foreground">{t(kind.hint)}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function Highlighted(props: { text: string }) {
  const parts = () => props.text.split(/([#@][\p{L}\p{N}_.]+)/u);
  return (
    <For each={parts()}>
      {(part) => (/^[#@][\p{L}\p{N}_]/u.test(part) ? <span class="text-primary">{part}</span> : part)}
    </For>
  );
}

function tooLongFor(body: string): string[] {
  const length = captionLength(body);
  const tags = hashtagCount(body);
  return SOCIAL_PLATFORMS.filter(
    (platform) => length > platform.captionLimit || (platform.maxHashtags !== undefined && tags > platform.maxHashtags),
  ).map((platform) => platform.name);
}

function describe(item: VaultItem): string {
  const parts: string[] = [];
  const tags = hashtagCount(item.body);
  if (item.kind === "hashtags") parts.push(t("{count, plural, one {# hashtag} other {# hashtags}}", { count: tags }));
  else {
    const length = captionLength(item.body);
    parts.push(t("{count, plural, one {{number} character} other {{number} characters}}", { count: length, number: length.toLocaleString(intlLocale()) }));
    if (tags) parts.push(t("{count, plural, one {# hashtag} other {# hashtags}}", { count: tags }));
  }
  if (item.uses) parts.push(t("{count, plural, =1 {Used once} other {Used # times}}", { count: item.uses }));
  return parts.join(", ");
}

function VaultCard(props: {
  item: VaultItem;
  marqueeIndex: number;
  selected: boolean;
  onSelect(event: MouseEvent): boolean;
  onEdit(): void;
  onCopy(): void;
  onUse(): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const misfits = () => tooLongFor(props.item.body);
  const isSignature = () => vaultSignature()?.id === props.item.id;
  const toggleSignature = () => {
    if (isSignature()) {
      setVaultSignature(null);
      toast(t("Signature turned off"));
      return;
    }
    setVaultSignature(props.item.id);
    toast.success(t("Set as your signature"), { description: t("New posts end with it. You can leave it off a post in the composer.") });
  };

  return (
    <article
      data-marquee-index={props.marqueeIndex}
      aria-selected={props.selected}
      class="depth-card group flex min-w-0 flex-col rounded-xl border"
      classList={{
        "border-primary ring-1 ring-primary bg-primary/8": props.selected,
        "border-border-strong bg-accent/30 hover:border-(--border-input)": !props.selected,
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, [role=menuitem]")) return;
        props.onSelect(event);
      }}
    >
      <div class="flex items-center gap-2 pl-3 pr-1.5 pt-2">
        <span class="shrink-0 rounded-md bg-(--plane-fill-subtle) px-1.5 py-0.5 text-xs leading-3 text-muted-foreground">
          {t(vaultKind(props.item.kind).singular)}
        </span>
        <Show when={isSignature()}>
          <span class="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-xs leading-3 text-primary">{t("Signature")}</span>
        </Show>
        <button
          type="button"
          data-marquee-grab
          class="min-w-0 flex-1 truncate rounded-md text-left text-xs font-medium text-foreground focus-ring"
          onClick={(event) => props.onSelect(event) || props.onEdit()}
        >
          {props.item.title}
        </button>
        <button
          type="button"
          aria-pressed={props.item.pinned}
          aria-label={props.item.pinned ? t("Unpin") : t("Pin to the top")}
          class="grid size-7 shrink-0 place-items-center rounded-md press hover:bg-accent focus-ring"
          classList={{ "opacity-0 group-hover:opacity-100 focus-visible:opacity-100": !props.item.pinned }}
          onClick={() => toggleVaultPin(props.item.id)}
        >
          <Icon name={props.item.pinned ? "favorited" : "favorite"} class="size-4 text-muted-foreground" />
        </button>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as="button"
            type="button"
            aria-label={t("More")}
            class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring"
          >
            <Icon name="more-three-dots-small-horizontal" class="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="w-40">
              <DropdownMenuItem tone="neutral" onSelect={() => props.onEdit()}>
                {t("Edit")}
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" onSelect={() => props.onDuplicate()}>
                {t("Duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" onSelect={() => toggleVaultPin(props.item.id)}>
                {props.item.pinned ? t("Unpin") : t("Pin to the top")}
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" onSelect={toggleSignature}>
                {isSignature() ? t("Stop using as signature") : t("Use as signature")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete()}>
                {t("Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>

      <button
        type="button"
        data-marquee-grab
        class="mx-3 mt-1.5 line-clamp-5 min-h-10 whitespace-pre-line break-words rounded-md text-left text-xs leading-5 text-muted-foreground focus-ring"
        onClick={(event) => props.onSelect(event) || props.onEdit()}
      >
        <Highlighted text={props.item.body} />
      </button>

      <Show when={misfits().length}>
        <p class="mx-3 mt-2 flex items-center gap-1 text-xs text-meter-yellow">
          <Icon name="alert-warning" class="-my-1 -ml-1 size-4 shrink-0" />
          <span class="min-w-0 truncate">
            {props.item.kind === "hashtags"
              ? t("Too many hashtags for {platforms}", { platforms: misfits().join(", ") })
              : t("Too long for {platforms}", { platforms: misfits().join(", ") })}
          </span>
        </p>
      </Show>

      <div class="mt-auto flex items-center gap-2 pl-3 pr-2 pt-3 pb-2">
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{describe(props.item)}</span>
        <Button variant="ghost" class="gap-1 pl-1 text-muted-foreground hover:text-foreground" onClick={() => props.onCopy()}>
          <Icon name="clipboard" class="size-4" />
          {t("Copy")}
        </Button>
        <Button variant="secondary" onClick={() => props.onUse()}>
          {t("Use in post")}
        </Button>
      </div>
    </article>
  );
}

function VaultEditor(props: { editing: Editing; onClose(): void; onDelete(item: VaultItem): void }) {
  const [draft, setDraft] = createStore<VaultDraft>({ ...props.editing.draft });
  const [error, setError] = createSignal<string | null>(null);
  let body: HTMLTextAreaElement | undefined;
  const isNew = () => props.editing.id === null;
  const kind = () => vaultKind(draft.kind);

  const tags = () => (draft.kind === "hashtags" ? normalizeHashtags(draft.body) : "");
  const tagCount = () => hashtagCount(draft.kind === "hashtags" ? tags() : draft.body);
  const misfits = () => tooLongFor(draft.kind === "hashtags" ? tags() : draft.body);
  const tightest = () => SOCIAL_PLATFORMS.reduce((low, platform) => (platform.captionLimit < low.captionLimit ? platform : low));

  const save = () => {
    const id = props.editing.id;
    if (id === null) {
      const made = createVaultItem(draft);
      if ("error" in made) return setError(made.error);
      toast.success(t("Saved to the vault"), { description: draft.title.trim() || undefined });
    } else {
      const failed = updateVaultItem(id, draft);
      if (failed) return setError(failed);
    }
    props.onClose();
  };

  const remove = () => {
    const item = vaultItems().find((row) => row.id === props.editing.id);
    if (!item) return;
    props.onDelete(item);
    props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent
          showCloseButton={false}
          class="flex w-[520px] max-w-11/12 flex-col gap-0 overflow-hidden rounded-xl border-border p-0"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            body?.focus();
          }}
        >
          <div class="flex h-11 items-center gap-2 border-b border-border pl-4 pr-1.5">
            <p class="min-w-0 flex-1 truncate text-xs text-foreground">
              {isNew() ? t(KIND_WORDS[kind().id].add) : t(KIND_WORDS[kind().id].edit)}
            </p>
            <Button size="icon-square" variant="ghost" aria-label={t("Close")} onClick={() => props.onClose()}>
              <Icon name="close-remove" class="text-foreground" />
            </Button>
          </div>

          <div class="flex flex-col gap-4 px-4 py-4">
            <Segmented
              label={t("Kind")}
              options={VAULT_KINDS.map((option) => ({ id: option.id, label: option.singular }))}
              value={draft.kind}
              onChange={(next) => {
                setDraft("kind", next);
                setError(null);
              }}
            />

            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Name")}</span>
              <input
                class={fieldControl}
                placeholder={t(TITLE_PLACEHOLDER[draft.kind])}
                value={draft.title}
                onInput={(event) => setDraft("title", event.currentTarget.value)}
              />
            </label>

            <label class="flex flex-col gap-1">
              <span class="flex items-center justify-between text-xs text-muted-foreground">
                {draft.kind === "hashtags" ? t("Hashtags") : t("Text")}
                <Show
                  when={draft.kind !== "hashtags"}
                  fallback={<span class="tabular-nums">{t("{count, plural, one {# hashtag} other {# hashtags}}", { count: tagCount() })}</span>}
                >
                  <span class="tabular-nums">
                    {t("{count, plural, one {{number} character} other {{number} characters}}", {
                      count: captionLength(draft.body),
                      number: captionLength(draft.body).toLocaleString(intlLocale()),
                    })}
                  </span>
                </Show>
              </span>
              <textarea
                ref={body}
                class={cx(fieldControlBase, "min-h-40 resize-y py-2 leading-relaxed")}
                placeholder={t(BODY_PLACEHOLDER[draft.kind])}
                value={draft.body}
                onInput={(event) => {
                  setDraft("body", event.currentTarget.value);
                  setError(null);
                }}
              />
            </label>

            <Show when={draft.kind === "hashtags" && tags()}>
              <div class="flex flex-col gap-1.5">
                <span class="text-xs text-muted-foreground">{t("Saved as")}</span>
                <div class="flex flex-wrap gap-1">
                  <For each={tags().split(" ")}>
                    {(tag) => <span class="rounded-md bg-primary/12 px-1.5 py-0.5 text-xs text-primary">{tag}</span>}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={draft.kind === "hashtags" && !tags()}>
              <p class="text-xs text-muted-foreground">{t("Separate them with spaces or commas. The # is added for you.")}</p>
            </Show>

            <Show when={draft.kind !== "hashtags" && draft.body.trim()}>
              <p
                class="text-xs"
                classList={{
                  "text-meter-yellow": captionLength(draft.body) > tightest().captionLimit,
                  "text-muted-foreground": captionLength(draft.body) <= tightest().captionLimit,
                }}
              >
                {captionLength(draft.body) <= tightest().captionLimit
                  ? t("Fits every platform, {platform} included.", { platform: tightest().name })
                  : t("Too long for {platforms}.", { platforms: misfits().join(", ") })}
              </p>
            </Show>

            <Show when={draft.kind === "hashtags" && misfits().length}>
              <p class="text-xs text-meter-yellow">{t("More hashtags than {platforms} allows.", { platforms: misfits().join(", ") })}</p>
            </Show>

            <Show when={error()}>
              <p class="text-xs text-destructive">{t(error() ?? "")}</p>
            </Show>
          </div>

          <div class="flex items-center gap-2 border-t border-border px-4 py-3">
            <Show when={!isNew()}>
              <Button variant="ghost" class="-ml-2 text-destructive" onClick={remove}>
                {t("Delete")}
              </Button>
            </Show>
            <span class="flex-1" />
            <Button variant="secondary" onClick={() => props.onClose()}>
              {t("Cancel")}
            </Button>
            <Button class="px-3" disabled={!draft.body.trim()} onClick={save}>
              {isNew() ? t("Save") : t("Save changes")}
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
