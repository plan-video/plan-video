/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { heldBack } from "@/components/publish/publisher";
import { HeldMark, StatusMark } from "./event-fields";
import { PostLogos } from "./post-logos";
import { MIN_CHIP_HEIGHT, cn } from "./utils";
import type { CalendarEvent } from "./types";

export const chipClass =
  "cal-chip @container flex min-w-0 items-stretch overflow-hidden rounded-md border text-left text-foreground outline-none focus-ring";

export const moreClass =
  "flex h-6 w-full items-center rounded-md pr-2 pl-3 text-xs text-(--plane-text-tertiary) outline-none transition-colors hover:bg-accent hover:text-(--plane-text-primary) focus-ring";

export function thumbHeight(chipHeight: number) {
  return Math.min(Math.round(chipHeight) - 8, 72);
}

type PostChipBodyProps = {
  event: CalendarEvent;
  time?: string;
  lines?: number;
  thumb?: number;
  top?: boolean;
};

export function PostChipBody(props: PostChipBodyProps) {
  const event = () => props.event;
  const lines = () => Math.max(1, props.lines ?? 1);
  const thumb = () => props.thumb ?? thumbHeight(MIN_CHIP_HEIGHT);
  const hasMeta = () => !!props.time || event().platforms.length > 0 || !!event().link || event().recurring;
  const held = () => (event().delivery ? null : heldBack({ id: event().sourceId, status: event().status }));
  // Only a post that needs a look carries a mark; a posted one steps back instead (calendar.css).
  const hasMark = () => !!event().delivery || !!held();

  return (
    <>
      <span aria-hidden="true" class="cal-chip-bar" />
      <Show when={event().thumbnail}>
        {(src) => (
          <img
            src={src()}
            alt=""
            draggable={false}
            class={cn("ml-2.5 shrink-0 rounded-[3px] object-cover @max-[7rem]:hidden", props.top ? "mt-1 self-start" : "self-center")}
            style={{ height: `${thumb()}px`, width: `${Math.round(thumb() * 0.75)}px` }}
          />
        )}
      </Show>
      <span
        class={cn(
          "cal-chip-text flex min-w-0 flex-1 flex-col gap-px py-1 pr-1.5 pl-3",
          props.top ? "justify-start" : "justify-center",
          event().thumbnail && "@min-[7rem]:pl-2",
        )}
      >
        <span
          class={cn("cal-chip-title min-w-0", lines() === 1 ? "truncate" : "overflow-hidden whitespace-normal [overflow-wrap:anywhere]")}
          style={lines() > 1 ? { display: "-webkit-box", "-webkit-box-orient": "vertical", "-webkit-line-clamp": String(lines()) } : undefined}
        >
          {event().title}
        </span>
        <Show when={hasMeta()}>
          <span class="cal-chip-meta flex min-w-0 items-center gap-1.5">
            <Show when={props.time}>{(time) => <span class="shrink-0 tabular-nums">{time()}</span>}</Show>
            <PostLogos platforms={event().platforms} max={3} size="sm" class="cal-chip-logos @max-[6rem]:hidden" />
            <Show when={event().link}>
              <Icon name="link" class="-mx-0.5 size-4 shrink-0 opacity-70" />
            </Show>
            <Show when={event().recurring}>
              <Icon name={event().paused ? "pause" : "loop"} class="-mx-0.5 size-4 shrink-0 opacity-70" />
            </Show>
          </span>
        </Show>
      </span>
      <Show when={hasMark()}>
        <span class={cn("flex shrink-0 items-center pr-[7px]", props.top ? "self-start pt-[5px]" : "self-center")}>
          <Show when={held()} fallback={<StatusMark event={event()} />}>
            {(state) => <HeldMark title={state().label} />}
          </Show>
        </span>
      </Show>
    </>
  );
}
