/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Show } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { EmojiPicker } from "@/components/emoji-picker";
import { VaultPicker } from "@/components/publish/vault-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";
import { toggleStyle, type TextStyle } from "@/lib/text-style";
import { vaultSignature, type VaultItem } from "@/lib/vault";

const TOOL =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring data-[expanded]:bg-accent data-[expanded]:text-foreground";

function typeInto(field: HTMLTextAreaElement, text: string, select = false) {
  const start = field.selectionStart;
  field.focus();
  // The browser's own typing keeps its undo; setRangeText is for a browser without it.
  if (!document.execCommand("insertText", false, text)) {
    field.setRangeText(text, start, field.selectionEnd, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (select) field.setSelectionRange(start, start + text.length);
}

function styleSelection(field: HTMLTextAreaElement, style: TextStyle) {
  let { selectionStart: start, selectionEnd: end } = field;
  const text = field.value;
  if (start === end) {
    while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
    while (end < text.length && !/\s/.test(text[end])) end += 1;
  }
  field.focus();
  if (start === end) return;
  field.setSelectionRange(start, end);
  typeInto(field, toggleStyle(text.slice(start, end), style), true);
}

/** On a Mac, Ctrl+B and Ctrl+I move the cursor, so only ⌘ styles. */
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export function captionShortcut(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): boolean {
  if (!(MAC ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return false;
  const style = ({ b: "bold", i: "italic" } as const)[event.key.toLowerCase()];
  if (!style) return false;
  event.preventDefault();
  styleSelection(event.currentTarget, style);
  return true;
}

export function CaptionTools(props: { field(): HTMLTextAreaElement | undefined; onVaultPick(item: VaultItem): void }) {
  const [, setParams] = useSearchParams();

  const style = (style: TextStyle) => {
    const field = props.field();
    if (field) styleSelection(field, style);
  };

  return (
    <div class="flex items-center gap-0.5">
      <EmojiPicker
        label={t("Emoji")}
        tooltip
        class={TOOL}
        placement="top-start"
        onPick={(emoji) => props.field() && typeInto(props.field()!, emoji)}
        returnFocus={props.field}
      >
        <Icon name="emoji" class="size-5" />
      </EmojiPicker>
      <Tool icon="bold" label={t("Bold")} shortcut={MAC ? "⌘B" : "Ctrl+B"} onClick={() => style("bold")} />
      <Tool icon="italic" label={t("Italic")} shortcut={MAC ? "⌘I" : "Ctrl+I"} onClick={() => style("italic")} />
      <span class="mx-1 h-4 w-px bg-border-strong" />
      <VaultPicker placement="top-start" kind="hashtags" icon="hashtag" label={t("Hashtags")} class={TOOL} onPick={props.onVaultPick} />
      <VaultPicker placement="top-start" icon="vault" label={t("Vault")} class={TOOL} onPick={props.onVaultPick} />
      <Show when={!vaultSignature()}>
        <Tool icon="signature" label={t("Add a signature")} onClick={() => setParams({ dashboard: "vault" })} />
      </Show>
    </div>
  );
}

function Tool(props: { icon: string; label: string; shortcut?: string; onClick(): void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        class={TOOL}
        aria-label={props.label}
        // Keeps the caption's selection, so the style lands on it.
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        onClick={() => props.onClick()}
      >
        <Icon name={props.icon} class="size-5" />
      </TooltipTrigger>
      <TooltipContent shortcut={props.shortcut}>{props.label}</TooltipContent>
    </Tooltip>
  );
}
