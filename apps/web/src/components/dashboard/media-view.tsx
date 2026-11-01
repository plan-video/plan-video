/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "somoto";

import { MediaArt } from "@/components/dashboard/empty-art";
import { DashboardFilterCount, DashboardHeaderSearch, DashboardPageHeader } from "@/components/dashboard/page-header";
import { createProjectMarquee } from "@/components/dashboard/project-marquee";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { PlatformLogo, createDropHandlers } from "@/components/publish/controls";
import { PictureEditor } from "@/components/publish/picture-editor";
import { handOffFiles } from "@/components/publish/handoff";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { cloudEnabled, cloudUsage } from "@/lib/cloud-storage";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import { droppedFiles, pickFiles } from "@/engine/asset-actions";
import {
  addToLibrary,
  deleteMedia,
  loadMediaLibrary,
  markMediaUsed,
  mediaFile,
  mediaItems,
  mediaLoadError,
  mediaLoaded,
  renameMedia,
  restoreMedia,
  type AddResult,
  type MediaItem,
} from "@/lib/media-library";
import { SOCIAL_PLATFORMS, formatDuration, isAspect, type PlatformId } from "@/lib/social";
import { MEDIA_LIMITS, POSTABLE_FILES, formatBytes, videoProblems } from "@/lib/social-media";

type Filter = MediaItem["kind"] | "all";
type Sort = "newest" | "oldest" | "name" | "largest" | "longest" | "most-used";
type Layout = "grid" | "list";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: msg("All media") },
  { id: "video", label: msg("Videos") },
  { id: "image", label: msg("Pictures") },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: msg("Newest first") },
  { id: "oldest", label: msg("Oldest first") },
  { id: "name", label: msg("Name") },
  { id: "largest", label: msg("Largest") },
  { id: "longest", label: msg("Longest") },
  { id: "most-used", label: msg("Most used") },
];

const ACCEPTED = msg("MP4 or MOV up to 500 MB. JPG or PNG up to 8 MB.");
const LAYOUT_KEY = "plan.video.media.layout";
const MENU_SHADOW = "shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)]";

const ASPECTS: [number, number][] = [
  [9, 16],
  [16, 9],
  [1, 1],
  [4, 5],
  [5, 4],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [21, 9],
];

function aspectLabel(item: MediaItem): string | null {
  const match = ASPECTS.find(([width, height]) => isAspect(item.width, item.height, width / height));
  return match ? `${match[0]}:${match[1]}` : null;
}

function typeLabel(item: MediaItem): string {
  const extension = item.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase().replace("JPEG", "JPG") ?? (item.kind === "video" ? "MP4" : "JPG");
  return item.kind === "video" ? t("{format} video", { format: extension }) : t("{format} picture", { format: extension });
}

const dimensions = (item: MediaItem) => (item.width ? `${item.width} × ${item.height}` : t("Unknown size"));

function addedOn(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(intlLocale(), { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

function sortMedia(list: readonly MediaItem[], sort: Sort): MediaItem[] {
  const newest = (a: MediaItem, b: MediaItem) => b.createdAt.localeCompare(a.createdAt);
  const order: Record<Sort, (a: MediaItem, b: MediaItem) => number> = {
    newest,
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    largest: (a, b) => b.size - a.size || newest(a, b),
    longest: (a, b) => b.duration - a.duration || newest(a, b),
    "most-used": (a, b) => b.uses - a.uses || (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || newest(a, b),
  };
  return [...list].sort(order[sort]);
}

function postProblem(chosen: readonly MediaItem[]): string | null {
  const videos = chosen.filter((item) => item.kind === "video").length;
  if ((videos && chosen.length > 1) || chosen.length > MEDIA_LIMITS.maxImages) {
    return t("A post carries one video, or up to {count} pictures.", { count: MEDIA_LIMITS.maxImages });
  }
  return null;
}

type Fit = { id: PlatformId; name: string; level: "ready" | "warning" | "error"; note: string };

function fitsOf(item: MediaItem): Fit[] {
  const aspect = item.width && item.height ? item.width / item.height : 0;
  return SOCIAL_PLATFORMS.filter((platform) => platform.kinds.includes(item.kind)).map((platform): Fit => {
    const fit = (level: Fit["level"], note: string): Fit => ({ id: platform.id, name: platform.name, level, note });
    if (item.kind === "video") {
      if (item.duration > platform.maxVideoSeconds) return fit("error", t("Up to {duration}", { duration: formatDuration(platform.maxVideoSeconds) }));
      if (platform.vertical && aspect > 0.8) return fit("warning", t("Plays with bars"));
      return fit("ready", t("Ready"));
    }
    if (platform.imageAspect && aspect && (aspect < platform.imageAspect.min || aspect > platform.imageAspect.max)) {
      return fit("warning", t("Cropped to fit"));
    }
    if (platform.vertical && !platform.imageAspect && aspect > 0.8) return fit("warning", t("Shows with bars"));
    return fit("ready", t("Ready"));
  });
}

function blockersOf(item: MediaItem): string[] {
  if (item.kind !== "video") return [];
  return videoProblems({ file: { name: item.name, type: item.type, size: item.size }, duration: item.duration, width: item.width, height: item.height });
}

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

async function download(chosen: readonly MediaItem[]) {
  for (const item of chosen) {
    const file = await mediaFile(item);
    if (!file) continue;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function DashboardMediaView() {
  const [, setParams] = useSearchParams();
  const [filter, setFilter] = createSignal<Filter>("all");
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("newest");
  const [layout, setLayoutSignal] = createSignal<Layout>(readLayout());
  const [selected, setSelected] = createSignal<string[]>([]);
  const [open, setOpen] = createSignal<{ id: string; rename: boolean } | null>(null);
  const [viewing, setViewing] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<MediaItem | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  let anchor: string | null = null;

  onMount(() => void loadMediaLibrary());

  const results = createMemo(() => {
    const words = query().trim().toLowerCase();
    const matching = mediaItems().filter(
      (item) => (filter() === "all" || item.kind === filter()) && (!words || item.name.toLowerCase().includes(words)),
    );
    return sortMedia(matching, sort());
  });
  const count = (kind: Filter) => (kind === "all" ? mediaItems().length : mediaItems().filter((item) => item.kind === kind).length);
  const totalBytes = () => mediaItems().reduce((total, item) => total + item.size, 0);
  const [usage] = createResource(
    () => cloudEnabled && !progress() && mediaItems().length + totalBytes(),
    () => cloudUsage().catch(() => undefined),
  );
  const opened = () => mediaItems().find((item) => item.id === open()?.id) ?? null;
  const selectedItems = () => selected().flatMap((id) => mediaItems().find((item) => item.id === id) ?? []);
  const isSelected = (id: string) => selected().includes(id);

  createEffect(
    on(mediaItems, (list) => {
      const ids = new Set(list.map((item) => item.id));
      if (selected().some((id) => !ids.has(id))) setSelected((current) => current.filter((id) => ids.has(id)));
      if (open() && !ids.has(open()!.id)) setOpen(null);
      if (viewing() && !ids.has(viewing()!)) setViewing(null);
    }),
  );

  const setLayout = (next: Layout) => {
    setLayoutSignal(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Storage blocked: the choice holds until the page reloads.
    }
  };

  const report = (result: AddResult) => {
    const { added, existing, problems } = result;
    if (added.length) {
      const already = existing.length ? t("{count, plural, =1 {One was in it already.} other {# were in it already.}}", { count: existing.length }) : undefined;
      toast.success(t("{count, plural, =1 {Added to your library} other {Added # files}}", { count: added.length }), {
        description: already ?? (added.length === 1 ? added[0]!.name : undefined),
      });
    } else if (existing.length) {
      toast(t("{count, plural, =1 {Already in your library} other {All # are in your library already}}", { count: existing.length }), {
        description: existing.length === 1 ? existing[0]!.name : undefined,
      });
      if (existing.length === 1) setOpen({ id: existing[0]!.id, rename: false });
    }
    if (problems.length) {
      toast.error(t("{count, plural, =1 {Couldn't add a file} other {Couldn't add # files}}", { count: problems.length }), {
        description: problems.length === 1 ? t(problems[0]) : t(ACCEPTED),
      });
    }
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setProgress((current) => ({ done: current?.done ?? 0, total: (current?.total ?? 0) + files.length }));
    const result = await addToLibrary(files, () => setProgress((current) => current && { ...current, done: current.done + 1 }));
    setProgress((current) => (current && current.done >= current.total ? null : current));
    report(result);
  };

  const pick = async () => void upload(await pickFiles({ accept: POSTABLE_FILES }));

  const useInPost = async (chosen: readonly MediaItem[]) => {
    const problem = postProblem(chosen);
    if (problem) {
      toast(problem);
      return;
    }
    const files = (await Promise.all(chosen.map(mediaFile))).filter((file): file is File => file !== null);
    if (!files.length) {
      toast.error(t("Could not open those files"));
      return;
    }
    markMediaUsed(chosen.map((item) => item.id));
    handOffFiles(files);
    setParams({ dashboard: "new-post", date: undefined, view: undefined });
  };

  const remove = async (chosen: readonly MediaItem[]) => {
    if (!chosen.length) return;
    const removed = await deleteMedia(chosen.map((item) => item.id));
    const used = chosen.some((item) => item.uses > 0);
    toast(removed.length === 1 ? t("Deleted {name}", { name: removed[0]!.item.name }) : t("{count, plural, one {Deleted # file} other {Deleted # files}}", { count: removed.length }), {
      description: used ? t("Posts that carry them keep their own copy.") : undefined,
      action: { label: t("Undo"), onClick: () => void restoreMedia(removed) },
    });
  };

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const selectRange = (id: string) => {
    const ids = results().map((item) => item.id);
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return toggle(id);
    const [low, high] = from < to ? [from, to] : [to, from];
    setSelected((current) => [...new Set([...current, ...ids.slice(low, high + 1)])]);
  };

  const check = (item: MediaItem, event: MouseEvent) => {
    if (event.shiftKey) selectRange(item.id);
    else toggle(item.id);
    anchor = item.id;
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

  const activate = (item: MediaItem, event: MouseEvent) => {
    if (event.shiftKey && anchor) return selectRange(item.id);
    if (event.metaKey || event.ctrlKey || selected().length) {
      toggle(item.id);
      anchor = item.id;
      return;
    }
    setOpen({ id: item.id, rename: false });
  };

  const view = (id: string) => {
    setOpen({ id, rename: false });
    setViewing(id);
  };

  const saveCopy = async (item: MediaItem, file: File) => {
    const base = item.name.replace(/\.[^.]+$/, "").replace(/-edited$/, "");
    const copy = new File([file], `${base}-edited${file.type === "image/png" ? ".png" : ".jpg"}`, { type: file.type, lastModified: Date.now() });
    const result = await addToLibrary([copy]);
    const added = result.added[0] ?? result.existing[0];
    if (!added) throw new Error(result.problems[0] ?? t("The picture could not be read."));
    setOpen({ id: added.id, rename: false });
    if (viewing()) setViewing(added.id);
    toast.success(t("Saved as a copy"), { description: added.name });
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || viewing() || editing()) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, video, [role=dialog], [role=alertdialog], [role=menu], [role=listbox]"))) return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (key === "escape") {
        if (selected().length) setSelected([]);
        else if (open()) setOpen(null);
        else return;
      } else if (command && key === "a") {
        setSelected(results().map((item) => item.id));
      } else if ((key === "delete" || key === "backspace") && !command && !event.altKey) {
        const chosen = selected().length ? selectedItems() : opened() ? [opened()!] : [];
        if (!chosen.length) return;
        void remove(chosen);
      } else if (key === "u" && !command && !event.altKey && !event.shiftKey) {
        void pick();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const handlers = createDropHandlers((files) => void upload(files), setDragging, droppedFiles);
  const selecting = () => selected().length > 0;
  const actions = (item: MediaItem) => ({
    onOpen: () => view(item.id),
    onUse: () => void useInPost([item]),
    onDownload: () => void download([item]),
    onRename: () => setOpen({ id: item.id, rename: true }),
    onDelete: () => void remove([item]),
    onEdit: item.kind === "image" ? () => setEditing(item) : undefined,
  });

  return (
    <div class="relative flex min-h-0 flex-1 flex-col" {...handlers}>
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
      <DashboardPageHeader>
        <Show when={!mediaLoaded() || mediaItems().length || progress() || mediaLoadError()}>
          <Show when={mediaLoaded()}>
            <DashboardFilterCount shown={results().length} total={mediaItems().length} />
          </Show>
          <Show when={!mediaLoaded() || mediaItems().length || progress()}>
            <DashboardHeaderSearch value={query()} placeholder={t("Search")} label={t("Search your media")} onInput={setQuery} class="w-48" />
          </Show>
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={PlaneButton} variant="ghost" size="lg" class="gap-1 pr-1.5" aria-label={t("Show")}>
              {t(FILTERS.find((option) => option.id === filter())!.label)}
              <PlaneIcon name="chevron-down" class="size-3.5 text-(--plane-text-placeholder)" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-40">
                <For each={FILTERS}>
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
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={PlaneButton} variant="ghost" size="lg" class="gap-1 pr-1.5">
              {t(SORTS.find((option) => option.id === sort())!.label)}
              <PlaneIcon name="chevron-down" class="size-3.5 text-(--plane-text-placeholder)" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-40">
                <For each={SORTS}>
                  {(option) => (
                    <DropdownMenuItem tone="neutral" onSelect={() => setSort(option.id)}>
                      <span class="flex-1">{t(option.label)}</span>
                      <Show when={sort() === option.id}>
                        <PlaneIcon name="check" class="size-3.5" />
                      </Show>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <div class="flex h-7 items-center gap-0.5 rounded-md bg-(--plane-layer-3) p-[3px]" role="group" aria-label={t("Layout")}>
            <LayoutButton label={t("Grid")} icon="view.grid" pressed={layout() === "grid"} onClick={() => setLayout("grid")} />
            <LayoutButton label={t("List")} icon="list" pressed={layout() === "list"} onClick={() => setLayout("list")} />
          </div>
          <PlaneButton variant="primary" size="lg" class="gap-1 pl-1.5" onClick={() => void pick()}>
            <PlaneIcon name="plus" class="size-3.5" />
            {t("Upload")}
          </PlaneButton>
        </Show>
      </DashboardPageHeader>

      <div class="flex min-h-0 flex-1">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-y-auto" onPointerDown={marquee.onPointerDown}>
            <div class="flex w-full flex-col gap-3 px-6 pt-6 pb-24">
              <Show when={!mediaLoadError()} fallback={<p class="py-16 text-center text-xs text-destructive">{t(mediaLoadError() ?? "")}</p>}>
                <Show when={mediaLoaded()} fallback={<Skeleton />}>
                  <Show when={mediaItems().length || progress()} fallback={<EmptyLibrary dragging={dragging()} onUpload={() => void pick()} />}>
                    <Show when={progress() || usage()}>
                      <div class="flex h-6 items-center justify-end gap-3 text-xs text-muted-foreground">
                        <Show when={!progress() && usage()}>
                          {(cloud) => (
                            <button
                              type="button"
                              title={t("Cloud storage for media, posts and projects")}
                              class="flex items-center gap-2 rounded-md px-1.5 py-0.5 tabular-nums press hover:bg-accent hover:text-foreground focus-ring"
                              onClick={() => setParams({ dashboard: "storage" })}
                            >
                              <span class="h-1 w-20 overflow-hidden rounded-full bg-accent">
                                <span
                                  class={cx("block h-full rounded-full", cloud().used >= cloud().limit * 0.9 ? "bg-destructive" : "bg-primary")}
                                  style={{ width: `${Math.min(100, (cloud().used / (cloud().limit || 1)) * 100)}%` }}
                                />
                              </span>
                              <span class="cap-centered">
                                {t("{used} of {limit}", { used: formatBytes(cloud().used), limit: formatBytes(cloud().limit) })}
                              </span>
                            </button>
                          )}
                        </Show>
                        <Show when={progress()}>
                          {(state) => (
                            <span class="flex items-center gap-2 text-foreground">
                              <Icon name="spinner-loader" class="size-4 animate-spin text-primary" />
                              <span class="tabular-nums">
                                {t("Adding {current} of {total}", { current: Math.min(state().done + 1, state().total), total: state().total })}
                              </span>
                              <span class="h-1 w-24 overflow-hidden rounded-full bg-accent">
                                <span
                                  class="block h-full rounded-full bg-primary transition-[width] duration-300"
                                  style={{ width: `${(state().done / state().total) * 100}%` }}
                                />
                              </span>
                            </span>
                          )}
                        </Show>
                      </div>
                    </Show>

                    <Show
                      when={results().length}
                      fallback={
                        <p class="py-16 text-center text-xs text-muted-foreground">
                          {query().trim() ? t("Nothing in your media matches “{query}”.", { query: query().trim() }) : filter() === "video" ? t("No videos yet.") : t("No pictures yet.")}
                        </p>
                      }
                    >
                      <Show
                        when={layout() === "grid"}
                        fallback={
                          <MediaTable
                            items={results()}
                            selected={selected()}
                            activeId={open()?.id ?? null}
                            onActivate={activate}
                            onCheck={check}
                            onCheckAll={(on) => setSelected(on ? results().map((item) => item.id) : [])}
                            actions={actions}
                          />
                        }
                      >
                        <div class="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-3 gap-y-4">
                          <For each={results()}>
                            {(item, index) => (
                              <MediaTile
                                item={item}
                                marqueeIndex={index()}
                                selected={isSelected(item.id)}
                                selecting={selecting()}
                                active={open()?.id === item.id}
                                onActivate={(event) => activate(item, event)}
                                onCheck={(event) => check(item, event)}
                                {...actions(item)}
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </div>
          </div>
        </div>

        <Show when={open()?.id} keyed>
          {(id) => (
            <Show when={mediaItems().find((item) => item.id === id)}>
              {(item) => (
                <MediaDetails
                  item={item()}
                  rename={open()?.rename ?? false}
                  onClose={() => setOpen(null)}
                  onOpen={() => view(item().id)}
                  onUse={() => void useInPost([item()])}
                  onDownload={() => void download([item()])}
                  onDelete={() => void remove([item()])}
                  onEdit={() => setEditing(item())}
                />
              )}
            </Show>
          )}
        </Show>
      </div>

      <Show when={selecting()}>
        <div class="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
          <div
            class={cx(
              "pointer-events-auto flex h-11 items-center gap-1 rounded-xl border border-border-strong bg-popover pl-3.5 pr-1.5 animate-in fade-in-0 slide-in-from-bottom-2",
              MENU_SHADOW,
            )}
          >
            <span class="text-xs text-foreground tabular-nums">{t("{count} selected", { count: selected().length })}</span>
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
            <Button
              variant="ghost"
              class="gap-1 pl-1"
              title={postProblem(selectedItems()) ?? undefined}
              disabled={!!postProblem(selectedItems())}
              onClick={() => void useInPost(selectedItems())}
            >
              <Icon name="document" class="size-5" />
              {t("Use in post")}
            </Button>
            <Button variant="ghost" class="gap-1 pl-1" onClick={() => void download(selectedItems())}>
              <Icon name="download" class="size-5" />
              {t("Download")}
            </Button>
            <Button variant="ghost" class="gap-1 pl-1 text-destructive hover:text-destructive" onClick={() => void remove(selectedItems())}>
              <Icon name="trash" class="size-5" />
              {t("Delete")}
            </Button>
            <Button variant="ghost" size="icon-square" aria-label={t("Clear the selection")} onClick={() => setSelected([])}>
              <Icon name="close-remove" class="size-5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </Show>

      <Show when={dragging() && mediaItems().length}>
        <div class="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-background/70 p-6 backdrop-blur-[2px] animate-in fade-in-0">
          <div class="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-primary/5 px-16 py-12 text-center">
            <span class="grid size-11 place-items-center rounded-full bg-primary/15 text-primary">
              <Icon name="all-media-types" class="size-6" />
            </span>
            <div class="flex flex-col gap-1">
              <p class="text-sm text-foreground">{t("Drop to add to your library")}</p>
              <p class="text-xs text-muted-foreground">{t(ACCEPTED)}</p>
            </div>
          </div>
        </div>
      </Show>

      <Show when={viewing()}>
        {(id) => (
          <MediaViewer
            items={results().some((item) => item.id === id()) ? results() : mediaItems().filter((item) => item.id === id())}
            id={id()}
            onShow={view}
            onClose={() => setViewing(null)}
            onUse={(item) => void useInPost([item])}
            onDownload={(item) => void download([item])}
            onEdit={setEditing}
          />
        )}
      </Show>
      <Show when={editing()}>
        {(item) => <LibraryPictureEditor item={item()} onSave={(file) => saveCopy(item(), file)} onClose={() => setEditing(null)} />}
      </Show>
    </div>
  );
}

function MediaViewer(props: {
  items: readonly MediaItem[];
  id: string;
  onShow(id: string): void;
  onClose(): void;
  onUse(item: MediaItem): void;
  onDownload(item: MediaItem): void;
  onEdit(item: MediaItem): void;
}) {
  let content: HTMLDivElement | undefined;
  const index = () => props.items.findIndex((item) => item.id === props.id);
  const many = () => props.items.length > 1;
  const step = (by: number) => {
    const count = props.items.length;
    const next = count > 1 ? props.items[(index() + by + count) % count] : undefined;
    if (next) props.onShow(next.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("video")) return;
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && props.onClose()}>
      <DialogPortal>
        <DialogContent
          ref={content}
          showCloseButton={false}
          overlayClass="bg-black/95"
          class="top-0 left-0 flex size-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none outline-none sm:max-w-none"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content?.focus();
          }}
        >
          <Show when={props.items[index()]}>
            {(item) => (
              <>
                <header class="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
                  <div class="flex min-w-0 flex-1 items-baseline gap-2.5">
                    <DialogTitle class="truncate text-sm font-medium text-white">{item().name}</DialogTitle>
                    <span class="shrink-0 text-xs text-white/50 tabular-nums">
                      {dimensions(item())}
                      {item().kind === "video" ? ` · ${formatDuration(item().duration)}` : ""}
                      {many() ? ` · ${t("{current} of {total}", { current: index() + 1, total: props.items.length })}` : ""}
                    </span>
                  </div>
                  <Show when={item().kind === "image"}>
                    <Button variant="ghost" class="gap-1 pl-1 text-white hover:bg-white/10 hover:text-white" onClick={() => props.onEdit(item())}>
                      <Icon name="crop" class="size-5" />
                      {t("Edit")}
                    </Button>
                  </Show>
                  <Button variant="ghost" class="gap-1 pl-1 text-white hover:bg-white/10 hover:text-white" onClick={() => props.onUse(item())}>
                    <Icon name="document" class="size-5" />
                    {t("Use in post")}
                  </Button>
                  <Button variant="ghost" class="gap-1 pl-1 text-white hover:bg-white/10 hover:text-white" onClick={() => props.onDownload(item())}>
                    <Icon name="download" class="size-5" />
                    {t("Download")}
                  </Button>
                  <Button variant="ghost" size="icon-square" aria-label={t("Close")} class="text-white hover:bg-white/10" onClick={() => props.onClose()}>
                    <Icon name="close-remove" />
                  </Button>
                </header>

                <div
                  class="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-12"
                  onClick={(event) => event.target === event.currentTarget && props.onClose()}
                >
                  <Show when={props.id} keyed>
                    <ViewerFile item={item()} />
                  </Show>
                  <Show when={many()}>
                    <ViewerStep label={t("Previous")} icon="chevron-left" class="left-3" onClick={() => step(-1)} />
                    <ViewerStep label={t("Next")} icon="chevron-right" class="right-3" onClick={() => step(1)} />
                  </Show>
                </div>
              </>
            )}
          </Show>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function LibraryPictureEditor(props: { item: MediaItem; onSave(file: File): Promise<void>; onClose(): void }) {
  const [file] = createResource(() => props.item, mediaFile);
  const ready = () => (file.state === "ready" ? file() : null);
  createEffect(() => {
    if (file.loading || ready()) return;
    toast.error(t("The picture could not be read."));
    props.onClose();
  });
  return (
    <Show when={ready()} keyed>
      {(picked) => <PictureEditor file={picked} saveLabel={t("Save copy")} onSave={(edited) => props.onSave(edited)} onClose={() => props.onClose()} />}
    </Show>
  );
}

function ViewerStep(props: { label: string; icon: string; class: string; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      class={cx(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/8 text-white/80 press hover:bg-white/15 hover:text-white focus-ring",
        props.class,
      )}
      onClick={() => props.onClick()}
    >
      <Icon name={props.icon} class="size-5" />
    </button>
  );
}

function ViewerFile(props: { item: MediaItem }) {
  const [url, setUrl] = createSignal<string | null>(null);
  let made: string | null = null;
  let alive = true;
  void mediaFile(props.item).then((file) => {
    if (!alive) return;
    if (!file) {
      toast.error(t("Could not open {name}", { name: props.item.name }));
      return;
    }
    made = URL.createObjectURL(file);
    setUrl(made);
  });
  onCleanup(() => {
    alive = false;
    if (made) URL.revokeObjectURL(made);
  });

  return (
    <Show
      when={url()}
      fallback={<img src={props.item.poster} alt="" draggable={false} class="size-full object-contain opacity-60" />}
    >
      {(src) => (
        <Show
          when={props.item.kind === "video"}
          fallback={<img src={src()} alt={props.item.name} draggable={false} class="max-h-full max-w-full object-contain" />}
        >
          <video src={src()} poster={props.item.poster} controls autoplay playsinline class="max-h-full max-w-full rounded-md" />
        </Show>
      )}
    </Show>
  );
}

function LayoutButton(props: { label: string; icon: string; pressed: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      class="grid h-full w-7 place-items-center rounded-sm outline-none press focus-ring"
      classList={{
        "bg-(--plane-layer-transparent-active) text-(--plane-text-primary)": props.pressed,
        "text-(--plane-text-secondary) hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary)": !props.pressed,
      }}
      onClick={() => props.onClick()}
    >
      <Icon name={props.icon} class="size-4.5" />
    </button>
  );
}

function CheckMark(props: { checked: boolean; class?: string; onClick(event: MouseEvent): void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.checked}
      aria-label={props.label}
      class={cx(
        "grid size-[18px] place-items-center rounded-sm border press focus-ring",
        props.checked ? "border-primary bg-primary text-primary-foreground" : "border-white/70 bg-black/45 text-transparent hover:border-white",
        props.class,
      )}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick(event);
      }}
    >
      <svg viewBox="0 0 14 14" class="size-3.5" fill="none" aria-hidden="true">
        <path d="M4 7.2 6.1 9.25 10 4.9" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  );
}

type ItemActions = { onOpen(): void; onUse(): void; onDownload(): void; onRename(): void; onDelete(): void; onEdit?: () => void };

const opensOnDoubleClick = (event: MouseEvent, selecting: boolean) => !selecting && !event.shiftKey && !event.metaKey && !event.ctrlKey;

function ItemMenu(props: ItemActions & { class?: string }) {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as="button"
        type="button"
        aria-label={t("More")}
        class={cx("grid size-7 place-items-center rounded-md press focus-ring", props.class)}
        onClick={(event: MouseEvent) => event.stopPropagation()}
      >
        <Icon name="more-three-dots-small-horizontal" class="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-40">
          <DropdownMenuItem tone="neutral" onSelect={() => props.onOpen()}>
            {t("Open")}
          </DropdownMenuItem>
          <DropdownMenuItem tone="neutral" onSelect={() => props.onUse()}>
            {t("Use in post")}
          </DropdownMenuItem>
          <Show when={props.onEdit}>
            {(edit) => (
              <DropdownMenuItem tone="neutral" onSelect={() => edit()()}>
                {t("Edit")}
              </DropdownMenuItem>
            )}
          </Show>
          <DropdownMenuItem tone="neutral" onSelect={() => props.onRename()}>
            {t("Rename")}
          </DropdownMenuItem>
          <DropdownMenuItem tone="neutral" onSelect={() => props.onDownload()}>
            {t("Download")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete()}>
            {t("Delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

function MediaTile(
  props: ItemActions & {
    item: MediaItem;
    marqueeIndex: number;
    selected: boolean;
    selecting: boolean;
    active: boolean;
    onActivate(event: MouseEvent): void;
    onCheck(event: MouseEvent): void;
  },
) {
  return (
    <div class="group relative flex min-w-0 flex-col gap-2">
      <button
        type="button"
        aria-label={props.item.name}
        data-marquee-index={props.marqueeIndex}
        class="depth-card relative aspect-[4/5] overflow-hidden rounded-xl bg-black outline-none focus-ring"
        onClick={(event) => props.onActivate(event)}
        onDblClick={(event) => opensOnDoubleClick(event, props.selecting) && props.onOpen()}
      >
        <img
          src={props.item.poster}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          class="size-full object-cover transition-[transform,opacity] duration-300 group-hover:scale-[1.03]"
          classList={{ "opacity-75": props.selected }}
        />
        <span class="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <Show when={props.item.kind === "video"}>
          <span class="absolute bottom-1.5 right-1.5 flex items-center rounded-md bg-black/75 px-1 py-px text-xs font-medium text-white tabular-nums">
            {formatDuration(props.item.duration)}
          </span>
        </Show>
        <span
          class="pointer-events-none absolute inset-0 rounded-xl ring-inset transition-shadow"
          classList={{ "ring-2 ring-primary": props.selected || props.active, "ring-1 ring-white/8": !props.selected && !props.active }}
        />
      </button>
      <CheckMark
        label={t("Select {name}", { name: props.item.name })}
        checked={props.selected}
        class={cx("absolute left-2 top-2", !props.selected && !props.selecting && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        onClick={(event) => props.onCheck(event)}
      />
      <ItemMenu
        onOpen={() => props.onOpen()}
        onUse={() => props.onUse()}
        onRename={() => props.onRename()}
        onDownload={() => props.onDownload()}
        onDelete={() => props.onDelete()}
        onEdit={props.onEdit}
        class="absolute right-1.5 top-1.5 size-6 bg-black/55 text-white opacity-0 hover:bg-black/75 group-hover:opacity-100 focus-visible:opacity-100 data-[expanded]:opacity-100"
      />
      <div class="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span class="truncate text-xs text-foreground" title={props.item.name}>
          {props.item.name}
        </span>
        <span class="truncate text-xs text-muted-foreground tabular-nums">
          {dimensions(props.item)} · {formatBytes(props.item.size)}
        </span>
      </div>
    </div>
  );
}

const TABLE_COLUMNS = "grid grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_4.5rem_4.5rem_5.5rem_2rem] items-center gap-3";

function MediaTable(props: {
  items: MediaItem[];
  selected: string[];
  activeId: string | null;
  onActivate(item: MediaItem, event: MouseEvent): void;
  onCheck(item: MediaItem, event: MouseEvent): void;
  onCheckAll(on: boolean): void;
  actions(item: MediaItem): ItemActions;
}) {
  const all = () => props.items.length > 0 && props.items.every((item) => props.selected.includes(item.id));
  return (
    <div class="overflow-hidden rounded-xl border border-border-strong bg-accent/30">
      <div class={`${TABLE_COLUMNS} h-9 border-b border-border-strong px-3 text-xs text-muted-foreground`}>
        <CheckMark label={t("Select all")} checked={all()} class={cx(!all() && "border-(--border-input) bg-transparent")} onClick={() => props.onCheckAll(!all())} />
        <span>{t("Name")}</span>
        <span>{t("Dimensions")}</span>
        <span>{t("Length")}</span>
        <span class="text-right">{t("Size")}</span>
        <span>{t("Added")}</span>
        <span />
      </div>
      <For each={props.items}>
        {(item, index) => {
          const selected = () => props.selected.includes(item.id);
          return (
            <div
              data-marquee-index={index()}
              class={cx(TABLE_COLUMNS, "group h-14 cursor-default border-b border-border-strong/60 px-3 transition-colors last:border-b-0")}
              classList={{
                "bg-primary/8": selected(),
                "bg-accent/60": !selected() && props.activeId === item.id,
                "hover:bg-accent": !selected() && props.activeId !== item.id,
              }}
              onClick={(event) => props.onActivate(item, event)}
              onDblClick={(event) => opensOnDoubleClick(event, props.selected.length > 0) && props.actions(item).onOpen()}
            >
              <CheckMark
                label={t("Select {name}", { name: item.name })}
                checked={selected()}
                class={cx(!selected() && "border-(--border-input) bg-transparent")}
                onClick={(event) => props.onCheck(item, event)}
              />
              <span class="flex min-w-0 items-center gap-3">
                <span class="relative size-10 shrink-0 overflow-hidden rounded-md bg-black">
                  <img src={item.poster} alt="" loading="lazy" decoding="async" draggable={false} class="size-full object-cover" />
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate text-xs text-foreground">{item.name}</span>
                  <span class="truncate text-xs text-muted-foreground">
                    {typeLabel(item)}
                    {item.uses ? ` · ${t("{count, plural, =1 {Used once} other {Used # times}}", { count: item.uses })}` : ""}
                  </span>
                </span>
              </span>
              <span class="truncate text-xs text-muted-foreground tabular-nums">
                {dimensions(item)}
                {aspectLabel(item) ? ` · ${aspectLabel(item)}` : ""}
              </span>
              <span class="text-xs text-muted-foreground tabular-nums">{item.kind === "video" ? formatDuration(item.duration) : "—"}</span>
              <span class="text-right text-xs text-muted-foreground tabular-nums">{formatBytes(item.size)}</span>
              <span class="text-xs text-muted-foreground">{addedOn(item.createdAt)}</span>
              <ItemMenu
                {...props.actions(item)}
                class="text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 data-[expanded]:opacity-100"
              />
            </div>
          );
        }}
      </For>
    </div>
  );
}

function MediaDetails(props: {
  item: MediaItem;
  rename: boolean;
  onClose(): void;
  onOpen(): void;
  onUse(): void;
  onDownload(): void;
  onDelete(): void;
  onEdit(): void;
}) {
  const [url, setUrl] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  let nameInput: HTMLInputElement | undefined;

  const extension = () => props.item.name.match(/\.[^.]+$/)?.[0] ?? "";
  const base = () => props.item.name.slice(0, props.item.name.length - extension().length);

  createEffect(on(base, (current) => setName(current)));

  const id = props.item.id;
  if (props.item.kind === "image") {
    let made: string | null = null;
    let alive = true;
    void mediaFile(props.item).then((file) => {
      if (!alive || !file) return;
      made = URL.createObjectURL(file);
      setUrl(made);
    });
    onCleanup(() => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    });
  }

  onMount(() => {
    if (!props.rename || !nameInput) return;
    nameInput.focus();
    nameInput.select();
  });

  const commit = () => {
    const problem = renameMedia(id, name());
    setError(problem ?? null);
    if (problem) setName(base());
  };

  const fits = createMemo(() => fitsOf(props.item));
  const blockers = createMemo(() => blockersOf(props.item));

  const rows = (): [string, string][] => {
    const item = props.item;
    const list: [string, string][] = [[t("Type"), typeLabel(item)]];
    list.push([t("Dimensions"), `${dimensions(item)}${aspectLabel(item) ? ` · ${aspectLabel(item)}` : ""}`]);
    if (item.kind === "video") list.push([t("Length"), formatDuration(item.duration)]);
    list.push([t("Size"), formatBytes(item.size)]);
    list.push([t("Added"), new Date(item.createdAt).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" })]);
    list.push([t("Used in posts"), item.uses ? t("{count, plural, =1 {Once} other {# times}}", { count: item.uses }) : t("Not yet")]);
    return list;
  };

  return (
    <aside class="flex w-[22rem] shrink-0 flex-col border-l border-border-strong bg-background/40 animate-in fade-in-0 slide-in-from-right-2 duration-200">
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-strong pl-4 pr-1.5">
        <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{props.item.kind === "video" ? t("Video") : t("Picture")}</p>
        <Button size="icon-square" variant="ghost" aria-label={t("Close")} onClick={() => props.onClose()}>
          <Icon name="close-remove" class="text-foreground" />
        </Button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <button
          type="button"
          aria-label={props.item.kind === "video" ? t("Play {name}", { name: props.item.name }) : t("Open {name}", { name: props.item.name })}
          title={props.item.kind === "video" ? t("Play") : t("Open")}
          class={cx(
            "group/preview relative grid h-72 shrink-0 place-items-center overflow-hidden rounded-xl bg-black outline-none focus-ring",
            props.item.kind === "video" ? "cursor-pointer" : "cursor-zoom-in",
          )}
          onClick={() => props.onOpen()}
        >
          <img src={url() ?? props.item.poster} alt="" draggable={false} class="max-h-full max-w-full object-contain" />
          <Show when={props.item.kind === "video"}>
            <span class="absolute grid size-12 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15 backdrop-blur-sm transition-transform group-hover/preview:scale-105">
              <Icon name="play" class="size-6" />
            </span>
          </Show>
        </button>

        <div class="flex flex-col gap-1">
          <label class="flex h-8 items-center rounded-md border border-transparent px-2 transition-colors hover:border-(--border-input) focus-within:border-primary focus-within:bg-input">
            <input
              ref={nameInput}
              value={name()}
              aria-label={t("Name")}
              class="min-w-4 max-w-full bg-transparent text-sm font-medium text-foreground outline-none [field-sizing:content]"
              onInput={(event) => {
                setName(event.currentTarget.value);
                setError(null);
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setName(base());
                  event.currentTarget.blur();
                }
              }}
            />
            <span class="shrink-0 text-sm text-muted-foreground">{extension()}</span>
          </label>
          <Show when={error()}>
            <p class="px-2 text-xs text-destructive">{t(error() ?? "")}</p>
          </Show>
        </div>

        <dl class="flex flex-col gap-2 px-2 text-xs">
          <For each={rows()}>
            {([label, value]) => (
              <div class="flex items-baseline gap-3">
                <dt class="w-24 shrink-0 text-muted-foreground">{label}</dt>
                <dd class="min-w-0 flex-1 truncate text-foreground tabular-nums">{value}</dd>
              </div>
            )}
          </For>
        </dl>

        <section class="flex flex-col gap-2">
          <h3 class="px-2 text-xs text-muted-foreground">{t("Where it fits")}</h3>
          <Show
            when={!blockers().length}
            fallback={
              <div class="flex items-start gap-2 rounded-xl bg-destructive/10 px-2.5 py-2 text-xs">
                <Icon name="alert-warning" class="-my-0.5 size-5 shrink-0 text-destructive" />
                <div class="flex flex-col gap-0.5">
                  <span class="text-foreground">{t("Can't be posted as it is")}</span>
                  <For each={blockers()}>{(problem) => <span class="text-muted-foreground">{t(problem)}</span>}</For>
                </div>
              </div>
            }
          >
            <ul class="flex flex-col rounded-xl border border-border-strong bg-accent/30 p-1">
              <For each={fits()}>
                {(fit) => (
                  <li class="flex h-8 items-center gap-2 px-2">
                    <PlatformLogo id={fit.id} class="size-4" />
                    <span class="min-w-0 flex-1 truncate text-xs text-foreground">{fit.name}</span>
                    <span
                      class="flex shrink-0 items-center gap-1 text-xs"
                      classList={{
                        "text-muted-foreground": fit.level === "ready",
                        "text-meter-yellow": fit.level === "warning",
                        "text-destructive": fit.level === "error",
                      }}
                    >
                      <Show when={fit.level === "ready"}>
                        <span class="size-1.5 rounded-full bg-emerald-400" />
                      </Show>
                      {fit.note}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>

      <div class="flex shrink-0 items-center gap-1.5 border-t border-border-strong p-3">
        <Button class="flex-1" onClick={() => props.onUse()}>
          {t("Use in post")}
        </Button>
        <Show when={props.item.kind === "image"}>
          <Button variant="secondary" class="gap-1 pl-1" onClick={() => props.onEdit()}>
            <Icon name="crop" class="size-5" />
            {t("Edit")}
          </Button>
        </Show>
        <Button variant="secondary" class="gap-1 pl-1" onClick={() => props.onDownload()}>
          <Icon name="download" class="size-5" />
          {t("Download")}
        </Button>
        <Button variant="ghost" size="icon-square" aria-label={t("Delete")} onClick={() => props.onDelete()}>
          <Icon name="trash" class="size-5 text-muted-foreground" />
        </Button>
      </div>
    </aside>
  );
}

function Skeleton() {
  return (
    <div class="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-3 gap-y-4 pt-9">
      <For each={Array.from({ length: 10 })}>
        {() => (
          <div class="flex flex-col gap-2">
            <span class="aspect-[4/5] animate-pulse rounded-xl bg-accent/50" />
            <span class="h-3 w-2/3 animate-pulse rounded bg-accent/50" />
          </div>
        )}
      </For>
    </div>
  );
}

const FEATURES: { icon: string; title: string; hint: string }[] = [
  { icon: "document", title: msg("Start a post from any file"), hint: msg("Pick one, or a set of pictures, and it opens in New post.") },
  { icon: "circle-check", title: msg("See where each one fits"), hint: msg("Length and shape are checked against every platform.") },
  { icon: "all-media-types", title: msg("Reuse what you attach"), hint: msg("Files you add to a post are kept here too.") },
];

function EmptyLibrary(props: { dragging: boolean; onUpload(): void }) {
  return (
    <div class="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 pt-8 text-center">
      <div
        class="flex w-full flex-col items-center gap-4 rounded-xl border border-dashed px-6 pt-8 pb-12 transition-colors"
        classList={{ "border-primary bg-primary/5": props.dragging, "border-(--border-input)": !props.dragging }}
      >
        <MediaArt />
        <div class="flex flex-col gap-1">
          <h2 class="text-sm font-medium text-foreground">{props.dragging ? t("Drop to add to your library") : t("Keep your videos and pictures in one place")}</h2>
          <p class="text-xs text-muted-foreground">{t("Upload them, or drop them anywhere on this page. Then post any of them in a click.")}</p>
        </div>
        <Button class="gap-0.5 pl-1 pr-2.5" onClick={() => props.onUpload()}>
          <Icon name="plus-add-small" class="size-5" />
          {t("Upload files")}
        </Button>
        <p class="text-xs text-muted-foreground">{t(ACCEPTED)}</p>
      </div>
      <div class="grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-3">
        <For each={FEATURES}>{(feature) => <Feature {...feature} />}</For>
      </div>
    </div>
  );
}

function Feature(props: { icon: string; title: string; hint: string }): JSX.Element {
  return (
    <div class="depth-panel flex flex-col items-start gap-1.5 rounded-xl border border-border-strong bg-accent/30 p-3">
      <span class="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Icon name={props.icon} class="-ml-0.5 size-4 text-muted-foreground" />
        {t(props.title)}
      </span>
      <span class="text-xs leading-4 text-muted-foreground">{t(props.hint)}</span>
    </div>
  );
}
