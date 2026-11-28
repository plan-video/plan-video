/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { clock, type ClipEdit } from "@/lib/clip-studio";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";

import type { Storyboard } from "@/lib/stream-clips";

/** The storyboard frame nearest `seconds`, drawn from its sheet, or `still` when there's no storyboard; else a dark box. */
export function StoryboardThumb(props: { board: Storyboard | null | undefined; seconds: number; still?: string; class?: string }) {
  const style = () => {
    const board = props.board;
    if (!board) return props.still ? { "background-image": `url("${props.still}")`, "background-size": "cover", "background-position": "center" } : undefined;
    const perSheet = board.cols * board.rows;
    const index = Math.min(board.count - 1, Math.max(0, Math.round(props.seconds / board.interval)));
    const sheet = board.images[Math.floor(index / perSheet)];
    if (!sheet) return undefined;
    const within = index % perSheet;
    const col = within % board.cols;
    const row = Math.floor(within / board.cols);
    return {
      "background-image": `url("${sheet}")`,
      "background-size": `${board.cols * 100}% ${board.rows * 100}%`,
      "background-position": `${board.cols > 1 ? (col / (board.cols - 1)) * 100 : 0}% ${board.rows > 1 ? (row / (board.rows - 1)) * 100 : 0}%`,
    };
  };
  return <span class={cx("block aspect-video shrink-0 overflow-hidden rounded-md bg-(--plane-layer-2) bg-no-repeat", props.class)} style={style()} aria-hidden="true" />;
}

export type ClipOrder = "best" | "time";

type ClipListProps = {
  clips: ClipEdit[];
  board: Storyboard | null | undefined;
  active: string | undefined;
  onOpen(id: string): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  /** The open clip and the ones after it, in the order shown. */
  onUpNext?(open: ClipEdit, next: ClipEdit[]): void;
};

/** How many clips after the open one are fetched ahead. */
const UP_NEXT = 2;

export function ClipList(props: ClipListProps) {
  const [order, setOrder] = createSignal<ClipOrder>("best");
  const sorted = createMemo(() => {
    const clips = [...props.clips];
    if (order() === "time") return clips.sort((a, b) => a.start - b.start);
    return clips.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.start - b.start);
  });
  const upNext = createMemo(
    () => {
      const list = sorted();
      const at = list.findIndex((clip) => clip.id === props.active);
      return at < 0 ? null : { open: list[at]!, next: list.slice(at + 1, at + 1 + UP_NEXT) };
    },
    null,
    { equals: (a, b) => a?.open === b?.open && a?.next.length === b?.next.length && !!a?.next.every((clip, i) => clip === b?.next[i]) },
  );
  createEffect(() => {
    const now = upNext();
    if (now) props.onUpNext?.(now.open, now.next);
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-(--plane-border-subtle) px-3">
        <span class="text-xs text-muted-foreground">{t("{count, plural, one {# clip} other {# clips}}", { count: props.clips.length })}</span>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as="button"
            type="button"
            class="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none press hover:bg-accent hover:text-foreground focus-ring"
          >
            {order() === "best" ? t("Most viral first") : t("In stream order")}
            <PlaneIcon name="chevron-down" class="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="w-44">
              <DropdownMenuItem tone="neutral" onSelect={() => setOrder("best")}>
                <span class="flex-1">{t("Most viral first")}</span>
                <Show when={order() === "best"}>
                  <PlaneIcon name="check" class="size-3.5" />
                </Show>
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" onSelect={() => setOrder("time")}>
                <span class="flex-1">{t("In stream order")}</span>
                <Show when={order() === "time"}>
                  <PlaneIcon name="check" class="size-3.5" />
                </Show>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
      <ul class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <For each={sorted()}>
          {(clip) => (
            <li class="group relative">
              <button
                type="button"
                aria-current={props.active === clip.id ? "true" : undefined}
                class="flex w-full items-start gap-2.5 rounded-lg p-1.5 pr-8 text-left outline-none press focus-ring"
                classList={{ "bg-(--plane-layer-2)": props.active === clip.id, "hover:bg-(--plane-layer-1)": props.active !== clip.id }}
                onClick={() => props.onOpen(clip.id)}
              >
                <span class="relative w-24 shrink-0">
                  <StoryboardThumb board={props.board} seconds={(clip.start + clip.end) / 2} still={clip.thumb} class="w-24" />
                  <span class="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] font-medium tabular-nums text-white">
                    {Math.round(clip.end - clip.start)}s
                  </span>
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                  <span class="line-clamp-2 text-xs font-medium text-foreground">{clip.title || t("Untitled clip")}</span>
                  <Show when={clip.reason}>
                    <span class="line-clamp-2 text-xxs text-muted-foreground">{clip.reason}</span>
                  </Show>
                  <span class="flex items-center gap-1.5 text-xxs text-muted-foreground tabular-nums">
                    {clock(clip.start)}
                    <Show when={clip.score !== null}>
                      <span aria-hidden="true">·</span>
                      <span>{t("Virality {score}", { score: clip.score ?? 0 })}</span>
                    </Show>
                    <Show when={clip.scheduled}>
                      <Icon name="circle-check" class="size-3.5 text-primary" aria-label={t("Sent to New post")} />
                    </Show>
                    <Show when={clip.downloaded}>
                      <Icon name="download" class="size-3.5" aria-label={t("Downloaded")} />
                    </Show>
                  </span>
                </span>
              </button>
              <DropdownMenu placement="bottom-end">
                <DropdownMenuTrigger
                  as="button"
                  type="button"
                  aria-label={t("More")}
                  class="absolute top-1.5 right-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 outline-none press group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-ring focus-visible:opacity-100 data-[expanded]:opacity-100 max-md:opacity-100"
                >
                  <Icon name="more-three-dots-small-horizontal" class="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent class="w-40">
                    <DropdownMenuItem tone="neutral" onSelect={() => props.onDuplicate(clip.id)}>
                      {t("Duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(clip.id)}>{t("Delete")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
