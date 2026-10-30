/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Never takes the pointer, so dragging and clicking the post still work.

import { For, Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { Portal } from "solid-js/web";

import { AccountAvatar } from "@/components/publish/account-avatar";
import { heldBack } from "@/components/publish/publisher";
import { useAuth } from "@/context/auth";
import { t } from "@/lib/i18n";
import { accountLabel, accountsFor, loadSocialConnections } from "@/lib/social-connections";
import { cn, formatDay, platformName, statusLabel } from "./utils";
import type { CalendarEvent } from "./types";

const OPEN_DELAY = 450;
/** Long enough to cross the gap between two posts without it closing. */
const CLOSE_DELAY = 90;
const GUTTER = 8;
const PADDING = 12;
const WIDTH = 288;

export type PostHover = {
  current: Accessor<{ event: CalendarEvent; anchor: DOMRect } | null>;
  enter(event: CalendarEvent, pointer: PointerEvent): void;
  leave(): void;
  cancel(): void;
};

export function createPostHover(): PostHover {
  const [current, setCurrent] = createSignal<{ event: CalendarEvent; anchor: DOMRect } | null>(null);
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(opening);
    clearTimeout(closing);
    setCurrent(null);
  };

  const onScroll = () => cancel();
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("pointerdown", cancel, true);
  window.addEventListener("keydown", cancel, true);
  onCleanup(() => {
    cancel();
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("pointerdown", cancel, true);
    window.removeEventListener("keydown", cancel, true);
  });

  return {
    current,
    enter(event, pointer) {
      if (pointer.pointerType !== "mouse" || pointer.buttons) return;
      const target = pointer.currentTarget as HTMLElement;
      clearTimeout(opening);
      clearTimeout(closing);
      const open = () => setCurrent({ event, anchor: target.getBoundingClientRect() });
      if (current()) open();
      else opening = setTimeout(open, OPEN_DELAY);
    },
    leave() {
      clearTimeout(opening);
      clearTimeout(closing);
      closing = setTimeout(() => setCurrent(null), CLOSE_DELAY);
    },
    cancel,
  };
}

export const STATUS_DOT: Record<string, string> = {
  failed: "bg-destructive",
  sending: "bg-primary",
  posted: "bg-meter-green",
  scheduled: "bg-primary",
  draft: "bg-muted-foreground/60",
  paused: "bg-meter-yellow",
  held: "bg-meter-yellow",
};

export function statusOf(event: CalendarEvent): { tone: string; label: string } {
  if (event.delivery === "failed") return { tone: "failed", label: t("Didn't go out") };
  if (event.delivery === "sending") return event.waiting ? { tone: "held", label: t("Waiting") } : { tone: "sending", label: t("Sending") };
  const held = heldBack({ id: event.sourceId, status: event.status });
  if (held) return { tone: "held", label: held.label };
  if (event.paused) return { tone: "paused", label: t("Paused") };
  return { tone: event.status, label: statusLabel(event.status) };
}

export function PostHoverCard(props: { hover: PostHover }) {
  const auth = useAuth();
  createEffect(() => loadSocialConnections(auth.user()?.id));
  let card: HTMLDivElement | undefined;
  const [place, setPlace] = createSignal<{ left: number; top: number } | null>(null);

  createEffect(() => {
    const shown = props.hover.current();
    setPlace(null);
    if (!shown) return;
    requestAnimationFrame(() => {
      const height = card?.offsetHeight ?? 180;
      const { anchor } = shown;
      let left = anchor.right + GUTTER;
      if (left + WIDTH > window.innerWidth - PADDING) left = anchor.left - GUTTER - WIDTH;
      left = Math.max(PADDING, left);
      const top = Math.max(PADDING, Math.min(anchor.top, window.innerHeight - height - PADDING));
      setPlace({ left, top });
    });
  });

  const accounts = (event: CalendarEvent) =>
    event.platforms.flatMap((platform) => {
      const picked = accountsFor(platform, event.accounts);
      return picked.length ? picked.map((account) => ({ key: account.id, account, label: accountLabel(account) })) : [{ key: platform, account: { platform }, label: platformName(platform) }];
    });

  return (
    <Show when={props.hover.current()} keyed>
      {(shown) => (
        <Portal>
          <div
            ref={card}
            role="tooltip"
            class={cn(
              "pointer-events-none fixed z-[140] flex flex-col gap-2.5 rounded-xl border border-border-strong bg-popover p-3 text-popover-foreground",
              place() && "cal-hover-card",
            )}
            style={{
              width: `${WIDTH}px`,
              left: `${place()?.left ?? 0}px`,
              top: `${place()?.top ?? 0}px`,
              visibility: place() ? "visible" : "hidden",
            }}
          >
            <div class="flex gap-3">
              <Show when={shown.event.thumbnail}>
                {(src) => <img src={src()} alt="" class="h-20 w-[60px] shrink-0 rounded-md object-cover" />}
              </Show>
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <p class="line-clamp-2 break-words text-sm leading-[18px] font-medium text-foreground">{shown.event.title}</p>
                <p class="text-xs text-muted-foreground">
                  {formatDay(shown.event.day)}
                  {shown.event.allDay ? ` · ${t("No set time")}` : ` · ${shown.event.start}`}
                </p>
                <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span class={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[statusOf(shown.event).tone])} />
                  {statusOf(shown.event).label}
                </p>
              </div>
            </div>
            <Show when={shown.event.description?.trim().replace(/\n\s*\n+/g, "\n")}>
              {(caption) => <p class="line-clamp-3 whitespace-pre-line break-words text-xs leading-[18px] text-muted-foreground">{caption()}</p>}
            </Show>
            <Show when={accounts(shown.event).length}>
              <div class="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border-strong pt-2.5">
                <For each={accounts(shown.event).slice(0, 6)}>
                  {(item) => (
                    <span class="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-foreground">
                      <AccountAvatar account={item.account} />
                      <span class="truncate">{item.label}</span>
                    </span>
                  )}
                </For>
                <Show when={accounts(shown.event).length > 6}>
                  <span class="text-xs text-muted-foreground">+{accounts(shown.event).length - 6}</span>
                </Show>
              </div>
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  );
}
