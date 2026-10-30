/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createSignal, type JSX } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { CapLabel } from "@/components/ui/cap-label";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { loadMediaLibrary, markMediaUsed, mediaFile, mediaItems, type MediaItem } from "@/lib/media-library";
import { formatDuration } from "@/lib/social";

export function MediaPicker(props: {
  kinds: readonly MediaItem["kind"][];
  max: number;
  onPick(files: File[]): void;
  class?: string;
  label?: string;
  /** Off where opening the dashboard would leave the page, as in the editor. */
  manage?: boolean;
  children: JSX.Element;
}) {
  const [, setParams] = useSearchParams();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [chosen, setChosen] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);

  const fitting = () => mediaItems().filter((item) => props.kinds.includes(item.kind));
  const results = () => {
    const words = query().trim().toLowerCase();
    return fitting().filter((item) => !words || item.name.toLowerCase().includes(words));
  };
  const many = () => props.max > 1;

  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) void loadMediaLibrary();
    else {
      setQuery("");
      setChosen([]);
    }
  };

  const finish = async (ids: readonly string[]) => {
    const picked = ids.map((id) => mediaItems().find((item) => item.id === id)).filter((item): item is MediaItem => !!item);
    if (!picked.length || busy()) return;
    setBusy(true);
    try {
      const files = (await Promise.all(picked.map(mediaFile))).filter((file): file is File => file !== null);
      if (!files.length) {
        toast.error(t("Could not open that file"), { description: t("It is no longer in the library.") });
        return;
      }
      markMediaUsed(picked.map((item) => item.id));
      openChange(false);
      props.onPick(files);
    } catch (error) {
      toast.error(t("Could not open the library"), { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (item: MediaItem) => {
    if (!many()) return void finish([item.id]);
    setChosen((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : current.length < props.max ? [...current, item.id] : current,
    );
  };

  const noneOfKind = () =>
    props.kinds.length > 1
      ? t("No videos or pictures in your library yet.")
      : props.kinds[0] === "video"
        ? t("No videos in your library yet.")
        : t("No pictures in your library yet.");

  return (
    <Popover placement="bottom" open={open()} onOpenChange={openChange}>
      <PopoverTrigger type="button" aria-label={props.label} title={props.label} class={cx(props.class, open() && "bg-secondary-hover")}>
        <CapLabel>{props.children}</CapLabel>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="z-[10000] w-[22rem] overflow-hidden rounded-xl p-0">
          <SearchInput placeholder={t("Search your media")} value={query()} onValue={setQuery} />
          <div class="max-h-80 overflow-y-auto p-2">
            <Show
              when={results().length}
              fallback={
                <p class="px-4 py-8 text-center text-xs text-muted-foreground">
                  {query().trim()
                    ? t("Nothing matches.")
                    : fitting().length || mediaItems().length
                      ? noneOfKind()
                      : t("Your library is empty. What you attach to posts is kept there.")}
                </p>
              }
            >
              <div class="grid grid-cols-3 gap-1.5">
                <For each={results()}>
                  {(item) => {
                    const order = () => chosen().indexOf(item.id);
                    return (
                      <button
                        type="button"
                        title={item.name}
                        aria-pressed={many() ? order() >= 0 : undefined}
                        disabled={busy()}
                        class="depth-card group relative aspect-square overflow-hidden rounded-md bg-black outline-none focus-ring"
                        onClick={() => toggle(item)}
                      >
                        <img src={item.poster} alt="" class="size-full object-cover transition-opacity group-hover:opacity-80" draggable={false} />
                        <Show when={item.kind === "video"}>
                          <span class="absolute bottom-1 right-1 rounded-md bg-black/75 px-1 text-xs font-medium text-white tabular-nums">
                            {formatDuration(item.duration)}
                          </span>
                        </Show>
                        <Show when={order() >= 0}>
                          <span class="pointer-events-none absolute inset-0 rounded-md ring-2 ring-inset ring-primary" />
                          <span class="absolute left-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs font-medium text-primary-foreground tabular-nums">
                            {order() + 1}
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
          <div class="flex h-10 items-center gap-2 border-t border-border pl-2 pr-1.5">
            <Show when={props.manage !== false}>
              <button
                type="button"
                class="rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
                onClick={() => {
                  openChange(false);
                  setParams({ dashboard: "media", date: undefined, view: undefined });
                }}
              >
                {t("Manage media")}
              </button>
            </Show>
            <span class="flex-1" />
            <Show when={many()}>
              <Button class="px-2.5" disabled={!chosen().length || busy()} onClick={() => void finish(chosen())}>
                {props.kinds.includes("video")
                  ? t("{count, plural, =0 {Add files} one {Add # file} other {Add # files}}", { count: chosen().length })
                  : chosen().length > 1
                    ? t("{count, plural, one {Add # picture} other {Add # pictures}}", { count: chosen().length })
                    : t("Add picture")}
              </Button>
            </Show>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
