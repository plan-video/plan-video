/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Assistant from any dashboard page: a button in the bottom-right corner
// (or ⌘J) that opens the chat in a panel above it, so a post can be asked for
// while the calendar stays in view. It is the same chat as the Assistant page
// (one store, lib/agent-chat), so the expand button carries on there. The
// panel stays open until closed, and opens by itself when the Assistant waits
// for a yes.

import Maximize2Lucide from "lucide-solid/icons/maximize-2";
import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

import { AssistantChat } from "@/components/dashboard/agent-view";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentChat, newAgentChat, openAgentChat, setAssistantPage } from "@/lib/agent-chat";
import { cx } from "@/lib/cva";
import { desktopAppPlatform } from "@/lib/desktop-app";
import { t } from "@/lib/i18n";

const HEADER_BUTTON =
  "grid size-7 place-items-center rounded-md text-(--plane-text-tertiary) outline-none press hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring disabled:pointer-events-none disabled:opacity-40 data-expanded:bg-(--plane-layer-transparent-active) data-expanded:text-(--plane-text-primary)";
/** Chats the panel's list offers; the page has the rest. */
const RECENT_CHATS = 8;

const [open, setOpen] = createSignal(false);

function HeaderButton(props: { label: string; onClick(): void; disabled?: boolean; children: JSX.Element }) {
  return (
    <Tooltip placement="bottom" openDelay={120}>
      <TooltipTrigger as="button" type="button" aria-label={props.label} disabled={props.disabled} class={HEADER_BUTTON} onClick={props.onClick}>
        {props.children}
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function RecentChats(props: { onAll(): void }) {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger as="button" type="button" aria-label={t("Chats")} title={t("Chats")} class={HEADER_BUTTON}>
        <PlaneIcon name="clock" class="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-64 gap-0.5">
          <For each={agentChat.list.slice(0, RECENT_CHATS)} fallback={<span class="px-2 py-1.5 text-xs text-(--plane-text-tertiary)">{t("No chats yet")}</span>}>
            {(chat) => (
              <DropdownMenuItem
                tone="neutral"
                disabled={agentChat.busy && agentChat.id !== chat.id}
                class={cx(agentChat.id === chat.id && "bg-input")}
                onSelect={() => void openAgentChat(chat.id)}
              >
                <span class="min-w-0 flex-1 truncate">{chat.title}</span>
              </DropdownMenuItem>
            )}
          </For>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={props.onAll}>
            <Maximize2Lucide class="size-3.5" aria-hidden="true" />
            <span class="flex-1">{t("All chats")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

export function AssistantLauncher(props: {
  /** The dashboard page in view, by its English name, so "this" and "here" can be read against it. */
  page: string;
  /** On the Assistant page itself the corner stays empty. */
  hidden: boolean;
  onExpand(): void;
}) {
  let panel: HTMLDivElement | undefined;
  /** Drawn once first opened, then kept, so a half-written message survives closing. */
  const [drawn, setDrawn] = createSignal(false);
  const shown = () => open() && !props.hidden;
  /** The button's name shows on hover only while the panel is closed. */
  const [tip, setTip] = createSignal(false);
  /** From a press until the pointer leaves the button, the name stays away: a click inside the open
   * delay leaves Kobalte's timer running, and the press shrink can slip the button's edge from under the
   * pointer, which Kobalte reads as a fresh hover and opens on mid-press. */
  let pressed = false;
  // Opening or closing the panel, by any means, starts the name afresh, so ✕, Esc or ⌘J never leave it showing.
  createEffect(on(shown, () => setTip(false)));

  createEffect(() => setAssistantPage(props.hidden ? null : props.page));
  onCleanup(() => setAssistantPage(null));

  createEffect(() => {
    if (shown()) setDrawn(true);
  });

  // A post waiting for a yes can't go unseen behind a closed panel.
  createEffect(
    on(
      () => agentChat.confirm,
      (confirm) => {
        if (confirm && !props.hidden) setOpen(true);
      },
      { defer: true },
    ),
  );

  // Opening puts the cursor in the box.
  createEffect(
    on(shown, (now) => {
      if (now) queueMicrotask(() => panel?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
    }),
  );

  // ⌘J opens and closes it from any page, even from a field, as ⌘K does search.
  onMount(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "j") return;
      event.preventDefault();
      if (!props.hidden) setOpen(!open());
    };
    window.addEventListener("keydown", onShortcut);
    onCleanup(() => window.removeEventListener("keydown", onShortcut));
  });

  const expand = () => {
    setOpen(false);
    props.onExpand();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    setOpen(false);
  };

  /** Shown on the closed button: working, or waiting for the person. */
  const status = () => (agentChat.confirm ? "waiting" : agentChat.busy ? "working" : null);

  return (
    <Show when={!props.hidden}>
      <Show when={drawn()}>
        <div
          ref={panel}
          role="dialog"
          aria-label={t("Assistant")}
          onKeyDown={onKeyDown}
          // Flat, with its border only: `!` beats index.css, which floats every dashboard dialog on a shadow.
          class={cx(
            "absolute right-4 bottom-17 z-30 flex h-[min(40rem,calc(100%-6rem))] w-[25rem] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-(--plane-border-subtle) bg-(--plane-surface-1) shadow-none!",
            shown() ? "animate-in fade-in-0 slide-in-from-bottom-2" : "hidden",
          )}
        >
          <div class="flex h-11 shrink-0 items-center gap-1 border-b border-(--plane-border-subtle) pr-2 pl-4">
            <h2 class="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium text-(--plane-text-primary)">{t("Assistant")}</h2>
            <RecentChats onAll={expand} />
            <HeaderButton label={t("New chat")} disabled={agentChat.busy} onClick={newAgentChat}>
              <PlaneIcon name="plus" class="size-4" />
            </HeaderButton>
            <HeaderButton label={t("Open full page")} onClick={expand}>
              <Maximize2Lucide class="size-3.5" aria-hidden="true" />
            </HeaderButton>
            <HeaderButton label={t("Close")} onClick={() => setOpen(false)}>
              <PlaneIcon name="close" class="size-4" />
            </HeaderButton>
          </div>
          <div class="flex min-h-0 flex-1 flex-col">
            <AssistantChat compact />
          </div>
        </div>
      </Show>
      <Tooltip placement="left" openDelay={120} open={tip()} onOpenChange={(now) => setTip(now && !pressed && !shown())}>
        <TooltipTrigger
          as="button"
          type="button"
          onPointerDown={() => {
            pressed = true;
            setTip(false);
          }}
          // Only a real leave ends it. Chrome sends a fresh pointerenter straight after a click, once the icon
          // under the pointer is swapped, so an enter can't. A leave while held is the press shrink, or a press
          // dragged off: wait for the release, and end it then only if the pointer is off the button.
          onPointerLeave={(event: PointerEvent) => {
            const button = event.currentTarget as HTMLElement;
            if (event.buttons === 0) pressed = false;
            else document.addEventListener("pointerup", () => (pressed = button.matches(":hover")), { once: true });
          }}
          aria-label={shown() ? t("Close the Assistant") : t("Assistant")}
          aria-expanded={shown()}
          aria-keyshortcuts="Meta+J Control+J"
          onClick={() => setOpen(!shown())}
          class={cx(
            "absolute right-4 bottom-4 z-30 grid size-10 place-items-center rounded-full border border-(--plane-border-subtle) bg-(--plane-surface-1) shadow-(--plane-shadow-overlay-200) outline-none press focus-ring",
            shown() ? "text-(--plane-text-primary)" : "text-(--plane-text-secondary) hover:text-(--plane-text-primary)",
          )}
        >
          <Show when={shown()} fallback={<PlaneIcon name="agent" class="size-5" />}>
            <PlaneIcon name="chevron-down" class="size-5" />
          </Show>
          <Show when={!shown() && status()}>
            {(now) => (
              <span
                aria-hidden="true"
                class={cx(
                  "absolute top-0 right-0 size-2.5 rounded-full ring-2 ring-(--plane-surface-1)",
                  now() === "waiting" ? "bg-(--plane-accent-primary)" : "animate-pulse bg-(--plane-text-tertiary) motion-reduce:animate-none",
                )}
              />
            )}
          </Show>
        </TooltipTrigger>
        <TooltipContent shortcut={desktopAppPlatform() === "macos" ? "⌘J" : "Ctrl J"}>{t("Assistant")}</TooltipContent>
      </Tooltip>
    </Show>
  );
}
