/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import AppleLucide from "lucide-solid/icons/apple";
import ClockLucide from "lucide-solid/icons/clock";
import SmileyLucide from "lucide-solid/icons/face-slightly-smiling";
import FlagLucide from "lucide-solid/icons/flag";
import HeartLucide from "lucide-solid/icons/heart";
import LightbulbLucide from "lucide-solid/icons/lightbulb";
import PawLucide from "lucide-solid/icons/paw-print";
import PersonLucide from "lucide-solid/icons/person-standing";
import PlaneLucide from "lucide-solid/icons/plane";
import BallLucide from "lucide-solid/icons/volleyball";
import { For, Match, Show, Switch, createMemo, createSignal, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Emoji, EmojiGroup } from "@/lib/emoji-data";
import { msg, t } from "@/lib/i18n";

// Loaded on first open: the data is a sizeable file most captions never need.
const [emojiData, setEmojiData] = createSignal<readonly { group: EmojiGroup; emoji: readonly Emoji[] }[] | null>(null);
let emojiLoading: Promise<void> | undefined;

function loadEmoji() {
  emojiLoading ??= import("@/lib/emoji-data")
    .then((module) => {
      setEmojiData(module.EMOJI);
    })
    .catch(() => {
      emojiLoading = undefined;
    });
}

const GROUPS: Record<EmojiGroup, { label: string; icon: Component<{ class?: string }> }> = {
  smileys: { label: msg("Smileys"), icon: SmileyLucide },
  people: { label: msg("People"), icon: PersonLucide },
  nature: { label: msg("Animals and nature"), icon: PawLucide },
  food: { label: msg("Food and drink"), icon: AppleLucide },
  travel: { label: msg("Travel and places"), icon: PlaneLucide },
  activities: { label: msg("Activities"), icon: BallLucide },
  objects: { label: msg("Objects"), icon: LightbulbLucide },
  symbols: { label: msg("Symbols"), icon: HeartLucide },
  flags: { label: msg("Flags"), icon: FlagLucide },
};

const TONE_HANDS = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
const TONE_KEY = "plan.video.emoji-tone";
const RECENT_KEY = "plan.video.recent-emoji";
const RECENT_MAX = 9;

function readRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((emoji) => typeof emoji === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function readTone(): number {
  const saved = Number(localStorage.getItem(TONE_KEY));
  return Number.isInteger(saved) && saved > 0 && saved < TONE_HANDS.length ? saved : 0;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the picker still works.
  }
}

export function EmojiPicker(props: {
  label: string;
  tooltip?: boolean;
  class?: string;
  placement?: "top-start" | "top-end" | "bottom-start" | "bottom-end";
  onPick(emoji: string): void;
  returnFocus?(): HTMLElement | undefined;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [recent, setRecent] = createSignal<string[]>([]);
  const [tone, setTone] = createSignal(0);
  const [shown, setShown] = createSignal<EmojiGroup | "recent">("smileys");
  let list: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;

  const drawn = (emoji: Emoji) => (tone() && emoji[2] ? emoji[2][tone() - 1] : emoji[0]);

  const matches = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const data = emojiData();
    if (!words.length || !data) return [];
    return data.flatMap((group) => group.emoji.filter((emoji) => emoji[0] === query().trim() || words.every((word) => emoji[1].toLowerCase().includes(word))));
  });

  const openChange = (next: boolean) => {
    if (next) {
      loadEmoji();
      setRecent(readRecent());
      setTone(readTone());
      setShown(readRecent().length ? "recent" : "smileys");
    } else setQuery("");
    setOpen(next);
  };

  const pick = (emoji: string) => {
    const next = [emoji, ...recent().filter((other) => other !== emoji)].slice(0, RECENT_MAX);
    remember(RECENT_KEY, JSON.stringify(next));
    setOpen(false);
    setQuery("");
    props.onPick(emoji);
  };

  const nextTone = () => {
    const next = (tone() + 1) % TONE_HANDS.length;
    setTone(next);
    remember(TONE_KEY, String(next));
  };

  const jumpTo = (id: EmojiGroup | "recent") => {
    setQuery("");
    const section = list?.querySelector<HTMLElement>(`[data-group="${id}"]`);
    if (list && section) list.scrollTop = section.offsetTop;
  };

  const followScroll = () => {
    if (!list) return;
    let current: string | undefined;
    for (const section of list.querySelectorAll<HTMLElement>("[data-group]")) {
      if (section.offsetTop <= list.scrollTop + 1) current = section.dataset.group;
    }
    if (current) setShown(current as EmojiGroup | "recent");
  };

  const current = () => (query().trim() ? undefined : shown());

  const tabs = () => [
    ...(recent().length ? [{ id: "recent" as const, label: msg("Recently used"), icon: ClockLucide }] : []),
    ...(emojiData() ?? []).map(({ group }) => ({ id: group, ...GROUPS[group] })),
  ];

  return (
    <Popover placement={props.placement ?? "bottom-start"} open={open()} onOpenChange={openChange}>
      {/* Mouse, not pointer, events: the tooltip uses those. */}
      <Show
        when={props.tooltip}
        fallback={
          <PopoverTrigger type="button" aria-label={props.label} class={props.class} onMouseEnter={loadEmoji}>
            {props.children}
          </PopoverTrigger>
        }
      >
        <Tooltip>
          <TooltipTrigger<typeof PopoverTrigger>
            as={(triggerProps: object) => (
              <PopoverTrigger {...triggerProps} type="button" aria-label={props.label} class={props.class} onMouseEnter={loadEmoji}>
                {props.children}
              </PopoverTrigger>
            )}
          />
          <TooltipContent>{props.label}</TooltipContent>
        </Tooltip>
      </Show>
      <PopoverPortal>
        <PopoverContent
          data-calendar-keep-popup
          class="z-[10000] flex w-80 flex-col overflow-hidden rounded-xl p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            search?.focus();
          }}
          onCloseAutoFocus={(event: Event) => {
            const target = props.returnFocus?.();
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
        >
          <div class="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-2">
            <Icon name="search" class="text-muted-foreground" />
            <input
              ref={search}
              type="text"
              value={query()}
              placeholder={t("Search emoji")}
              aria-label={t("Search emoji")}
              autocomplete="off"
              class="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") return;
                event.stopPropagation();
                if (event.key === "Enter" && matches()[0]) {
                  event.preventDefault();
                  pick(drawn(matches()[0]));
                }
              }}
            />
            <Tooltip>
              <TooltipTrigger
                type="button"
                class="grid size-7 shrink-0 place-items-center rounded-md text-base leading-none press hover:bg-accent focus-ring"
                aria-label={t("Skin tone")}
                onClick={nextTone}
              >
                {TONE_HANDS[tone()]}
              </TooltipTrigger>
              <TooltipContent>{t("Skin tone")}</TooltipContent>
            </Tooltip>
          </div>

          <div class="flex shrink-0 items-center gap-0.5 px-1.5 pt-1.5" role="tablist" aria-label={t("Emoji")}>
            <For each={tabs()}>
              {(tab) => (
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    role="tab"
                    aria-selected={current() === tab.id}
                    aria-label={t(tab.label)}
                    class="grid size-7 shrink-0 place-items-center rounded-md press focus-ring"
                    classList={{
                      "bg-secondary text-foreground": current() === tab.id,
                      "text-muted-foreground hover:bg-accent hover:text-foreground": current() !== tab.id,
                    }}
                    onClick={() => jumpTo(tab.id)}
                  >
                    <Dynamic component={tab.icon} class="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>{t(tab.label)}</TooltipContent>
                </Tooltip>
              )}
            </For>
          </div>

          <div
            ref={list}
            class="relative h-72 overflow-y-auto px-2 pb-2"
            onScroll={followScroll}
            onClick={(event) => {
              const button = (event.target as HTMLElement).closest<HTMLElement>("[data-emoji]");
              if (button?.dataset.emoji) pick(button.dataset.emoji);
            }}
          >
            <Switch>
              <Match when={!emojiData()}>
                <div class="grid h-full place-items-center">
                  <Icon name="spinner-loader" class="size-5 animate-spin text-muted-foreground" />
                </div>
              </Match>
              <Match when={query().trim()}>
                <Show when={matches().length} fallback={<p class="grid h-full place-items-center text-xs text-muted-foreground">{t("No emoji found")}</p>}>
                  <EmojiGrid emoji={matches().map((emoji) => [drawn(emoji), emoji[1]] as const)} />
                </Show>
              </Match>
              <Match when={emojiData()}>
                {(data) => (
                  <>
                    <Show when={recent().length}>
                      <EmojiSection id="recent" label={t("Recently used")} emoji={recent().map((emoji) => [emoji, ""] as const)} />
                    </Show>
                    <For each={data()}>
                      {(group) => <EmojiSection id={group.group} label={t(GROUPS[group.group].label)} emoji={group.emoji.map((emoji) => [drawn(emoji), emoji[1]] as const)} />}
                    </For>
                  </>
                )}
              </Match>
            </Switch>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function EmojiSection(props: { id: string; label: string; emoji: readonly (readonly [string, string])[] }) {
  return (
    <section data-group={props.id}>
      <h3 class="sticky top-0 z-10 bg-popover px-1 pt-2 pb-1 text-xs text-muted-foreground">{props.label}</h3>
      <EmojiGrid emoji={props.emoji} />
    </section>
  );
}

function EmojiGrid(props: { emoji: readonly (readonly [string, string])[] }) {
  return (
    <div class="grid grid-cols-9 gap-0.5 pt-1">
      <For each={props.emoji}>
        {([emoji, name]) => (
          <button
            type="button"
            data-emoji={emoji}
            title={name || undefined}
            aria-label={name || emoji}
            class="grid size-8 place-items-center rounded-md text-xl leading-none transition-colors hover:bg-accent focus-ring"
          >
            {emoji}
          </button>
        )}
      </For>
    </div>
  );
}
