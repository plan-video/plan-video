/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { intlLocale, t } from "@/lib/i18n";

import type { ChatSummary } from "@plan.video/agent-chat";

import { chatState, deleteChat, refreshChats } from "./store";

type HistoryMenuProps = {
  projectId: string;
  chatId: string | null;
  onOpen(chatId: string): void;
};

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return t("just now");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("{minutes}m", { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{hours}h", { hours });
  const days = Math.round(hours / 24);
  if (days < 7) return t("{days}d", { days });
  return new Date(timestamp).toLocaleDateString(intlLocale(), { month: "short", day: "numeric" });
}

export function HistoryMenu(props: HistoryMenuProps) {
  const chats = () => chatState.lists[props.projectId] ?? [];

  const remove = (event: MouseEvent, chat: ChatSummary) => {
    event.stopPropagation();
    event.preventDefault();
    deleteChat(props.projectId, chat.id).catch((error: Error) => toast.error(t("Could not delete the chat"), { description: error.message }));
  };

  return (
    <DropdownMenu placement="bottom-end" onOpenChange={(open) => open && void refreshChats(props.projectId)}>
      <DropdownMenuTrigger<typeof Button>
        as={(triggerProps) => (
          <Button {...triggerProps} variant="ghost" size="icon" class="text-muted-foreground" aria-label={t("Chat history")} title={t("Chat history")}>
            <Icon name="history" />
          </Button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-72">
          <DropdownMenuGroup>
            <Show
              when={chats().length > 0}
              fallback={
                <DropdownMenuItem disabled>
                  <span class="min-w-0 flex-1 truncate text-muted-foreground">{t("No chats yet")}</span>
                </DropdownMenuItem>
              }
            >
              <For each={chats()}>
                {(chat) => (
                  <DropdownMenuItem tone="neutral" class="group/row" onSelect={() => props.onOpen(chat.id)}>
                    <Show when={chat.status === "running"}>
                      <Icon name="spinner-loader" class="animate-spin size-6 -mr-1 shrink-0" />
                    </Show>
                    <Show when={chat.status === "waiting"}>
                      <Icon name="dot" class="size-6 -mr-1 shrink-0 text-primary" />
                    </Show>
                    <span class="min-w-0 flex-1 truncate" title={chat.title}>
                      {chat.title}
                    </span>
                    <Show when={chat.id !== props.chatId}>
                      <span class="shrink-0 text-[10px] text-muted-foreground group-hover/row:hidden">
                        {chat.status === "waiting" ? t("Needs you") : relativeTime(chat.updatedAt)}
                      </span>
                    </Show>
                    <Show when={chat.id === props.chatId}>
                      <Icon name="confirm-check" class="size-6 -mr-1 shrink-0 group-hover/row:hidden" />
                    </Show>
                    <button
                      type="button"
                      aria-label={t("Delete chat {title}", { title: chat.title })}
                      class="relative hidden size-6 shrink-0 -mr-1 text-muted-foreground transition-colors hover:text-foreground focus-ring group-hover/row:inline-block"
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                      onClick={(event) => remove(event, chat)}
                    >
                      <Icon
                        name="close-remove-small"
                        class="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-inherit!"
                      />
                    </button>
                  </DropdownMenuItem>
                )}
              </For>
            </Show>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
