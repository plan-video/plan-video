/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { Icon } from "@/components/ui/icon";
import { AddButton, MoreOptions, Row, Section, Segmented } from "./extension-ui";
import { DEFAULT_CHAT_STYLE, insertChatMessages, type ChatStyle } from "@/engine/live-chat";
import type { KillfeedAnimation } from "@/engine/killfeed";
import { createFeed, MAX_FEED_ENTRIES, plain } from "@/lib/killfeed-feed";
import {
  badgeUrl,
  CHAT_BADGES,
  CHAT_COLORS,
  DEFAULT_CHAT,
  renderChatMessage,
  shrinkPicture,
  type ChatBackground,
  type ChatMessage,
  type ChatPlatform,
} from "@/lib/live-chat";
import { msg, t } from "@/lib/i18n";

export const CHAT_DRAG_TYPE = "application/x-plan-chat";

const BACKGROUNDS: { id: ChatBackground; label: string }[] = [
  { id: "bubble", label: msg("Bubble") },
  { id: "none", label: msg("None") },
];

const ANIMATIONS: { id: KillfeedAnimation; label: string }[] = [
  { id: "none", label: msg("None") },
  { id: "slide", label: msg("Slide") },
  { id: "fade", label: msg("Fade") },
];

const STAGE_BACKGROUND = "/site/sunset.webp";

function createChatExtension(platform: ChatPlatform): { Panel: Component; Cover: Component } {
  /** Kept across tab switches. */
  const feed = createFeed<ChatMessage>(structuredClone(DEFAULT_CHAT[platform]));
  const { spec, set: setSpec } = feed;
  const [style, setStyle] = createStore<ChatStyle>({ ...DEFAULT_CHAT_STYLE });
  /** Badges you added, as data URLs. */
  const [ownBadges, setOwnBadges] = createSignal<string[]>([]);

  const badgeIds = () => [...CHAT_BADGES[platform].map((badge) => badge.id), ...ownBadges()];
  const draw = (message: ChatMessage, scale: number) => renderChatMessage(platform, message, style.background, scale);

  const toggleBadge = (id: string) => {
    const current = spec().badges;
    const on = current.includes(id);
    // Kept in the grid's order, the way the apps line them up.
    setSpec("badges", badgeIds().filter((item) => (item === id ? !on : current.includes(item))));
  };

  const addBadge = async (file: File) => {
    try {
      const url = await shrinkPicture(file);
      setOwnBadges((current) => (current.includes(url) ? current : [...current, url]));
      if (!spec().badges.includes(url)) setSpec("badges", [...spec().badges, url]);
    } catch (error) {
      toast.error(t("Could not add that picture"), { description: (error as Error).message });
    }
  };

  const removeBadge = (url: string) => {
    feed.updateAll((message) => {
      message.badges = message.badges.filter((badge) => badge !== url);
    });
    setOwnBadges((current) => current.filter((badge) => badge !== url));
  };

  const setAvatar = async (file: File) => {
    try {
      setSpec("avatar", await shrinkPicture(file));
    } catch (error) {
      toast.error(t("Could not add that picture"), { description: (error as Error).message });
    }
  };

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer?.setData(CHAT_DRAG_TYPE, JSON.stringify({ platform, messages: plain(feed.entries()), style: plain(style) }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  };

  function Panel() {
    const world = useWorld();
    const [adding, setAdding] = createSignal(false);

    const add = async () => {
      setAdding(true);
      try {
        const placed = await insertChatMessages(world, platform, plain(feed.entries()), plain(style));
        if (!placed.length) toast(t("Nothing to add it to"), { description: t("Open a scene first.") });
      } catch (error) {
        toast.error(t("Could not add the chat message"), { description: (error as Error).message });
      } finally {
        setAdding(false);
      }
    };

    const count = () => feed.entries().length;

    return (
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Stage />

          <div class="flex flex-col gap-5 px-3 pb-4 pt-1">
            <MessageField />

            <Section label={t("Username")}>
              <div class="flex flex-col gap-2">
                <label class="flex h-8 items-center gap-2 rounded-md bg-input px-2.5 focus-within:ring-1 focus-within:ring-ring">
                  <Show when={platform === "tiktok"}>
                    <AvatarButton />
                  </Show>
                  <input
                    type="text"
                    value={spec().name}
                    placeholder={t("Username")}
                    aria-label={t("Username")}
                    maxLength={40}
                    onInput={(event) => setSpec("name", event.currentTarget.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                    class="h-full min-w-0 flex-1 bg-transparent text-xs font-450 outline-none placeholder:text-muted-foreground"
                    style={{ color: `light-dark(var(--foreground), ${spec().color})` }}
                  />
                </label>
                <Swatches />
              </div>
            </Section>

            <Section label={t("Message")}>
              <textarea
                value={spec().text}
                placeholder={t("Say something")}
                aria-label={t("Message")}
                rows={2}
                maxLength={500}
                onInput={(event) => setSpec("text", event.currentTarget.value)}
                onKeyDown={(event) => event.stopPropagation()}
                class="min-h-14 w-full resize-y rounded-md bg-input px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              />
            </Section>

            <Section label={t("Badges")}>
              <Badges />
            </Section>

            <MoreOptions>
              <Row label={t("Background")}>
                <Segmented options={BACKGROUNDS} value={style.background} onChange={(background) => setStyle("background", background)} />
              </Row>
              <Row label={t("Animation")}>
                <Segmented options={ANIMATIONS} value={style.animation} onChange={(animation) => setStyle("animation", animation)} />
              </Row>
            </MoreOptions>
          </div>
        </div>

        <AddButton
          label={count() > 1 ? t("{count, plural, one {Add # message to scene} other {Add # messages to scene}}", { count: count() }) : undefined}
          busy={adding()}
          onClick={() => void add()}
        />
      </div>
    );
  }

  function Stage() {
    const several = () => feed.entries().length > 1;
    return (
      <div class="sticky top-0 z-10 bg-background px-3 pb-3 pt-3">
        <div
          draggable={true}
          onDragStart={handleDragStart}
          class="group relative flex max-h-44 min-h-20 cursor-grab flex-col justify-end gap-1 overflow-hidden rounded-md border border-border bg-black p-3 active:cursor-grabbing"
        >
          <img src={STAGE_BACKGROUND} alt="" draggable={false} class="pointer-events-none absolute inset-0 size-full object-cover" />
          <For each={feed.entries()}>
            {(message, index) => (
              <Show when={several()} fallback={<Message message={message} class="relative" />}>
                <button
                  type="button"
                  aria-label={t("Message {n}", { n: index() + 1 })}
                  aria-pressed={index() === feed.selected()}
                  class="relative block w-fit max-w-full shrink-0 rounded-[3px] outline-offset-2 focus-ring"
                  classList={{ "outline outline-1 outline-white/70": index() === feed.selected() }}
                  onClick={() => feed.select(index())}
                >
                  <Message message={message} />
                </button>
              </Show>
            )}
          </For>
          <span class="pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-0.5 rounded-sm bg-black/60 px-1.5 py-px text-[10px] text-white/70 opacity-0 transition-opacity group-hover:opacity-100">
            <Icon name="move-small" class="size-3.5" />
            {t("Drag onto the video")}
          </span>
        </div>
      </div>
    );
  }

  /** The message drawn as it goes on the video, at the size the app shows it. */
  function Message(props: { message: ChatMessage; class?: string }) {
    const [picture, setPicture] = createSignal<{ url: string; width: number }>();
    let version = 0;
    createEffect(() => {
      const message = plain(props.message);
      const pixels = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
      const mine = ++version;
      draw(message, pixels)
        .then((canvas) => {
          if (mine === version) setPicture({ url: canvas.toDataURL("image/png"), width: canvas.width / pixels });
        })
        .catch(() => {});
    });
    return (
      <Show when={picture()}>
        {(drawn) => (
          <img
            src={drawn().url}
            alt={t("Chat preview")}
            draggable={false}
            class={`pointer-events-none block h-auto max-w-full ${props.class ?? ""}`}
            style={{ width: `${drawn().width}px` }}
          />
        )}
      </Show>
    );
  }

  function MessageField() {
    const count = () => feed.entries().length;
    const picked = (index: number) => index === feed.selected();
    return (
      <Section
        label={t("Messages")}
        action={
          <Show when={count() > 1}>
            <button
              type="button"
              title={t("Remove message {n}", { n: feed.selected() + 1 })}
              class="flex h-5 items-center gap-0.5 rounded-sm pr-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
              onClick={() => feed.remove()}
            >
              <Icon name="close-remove-small" class="size-4" />
              {t("Remove")}
            </button>
          </Show>
        }
      >
        <div role="radiogroup" aria-label={t("Messages")} class="grid gap-1" style={{ "grid-template-columns": `repeat(${MAX_FEED_ENTRIES}, minmax(0, 1fr))` }}>
          <For each={feed.entries()}>
            {(_, index) => (
              <button
                type="button"
                role="radio"
                aria-checked={picked(index())}
                aria-label={t("Message {n}", { n: index() + 1 })}
                class="h-7 rounded-md text-xs tabular-nums transition-colors focus-ring"
                classList={{
                  "bg-secondary-hover font-450 text-foreground": picked(index()),
                  "bg-accent text-muted-foreground hover:text-foreground": !picked(index()),
                }}
                onClick={() => feed.select(index())}
              >
                {index() + 1}
              </button>
            )}
          </For>
          <Show when={count() < MAX_FEED_ENTRIES}>
            <button
              type="button"
              aria-label={t("Add a message")}
              title={t("Add a message")}
              class="grid h-7 place-items-center rounded-md bg-accent text-muted-foreground transition-colors hover:text-foreground focus-ring"
              onClick={() => feed.add()}
            >
              <Icon name="plus-add" />
            </button>
          </Show>
        </div>
      </Section>
    );
  }

  function Swatches() {
    const colors = CHAT_COLORS[platform];
    const custom = () => !colors.includes(spec().color);
    return (
      <div class="flex flex-wrap gap-1" role="radiogroup" aria-label={t("Name color")}>
        <For each={colors}>
          {(color) => (
            <button
              type="button"
              role="radio"
              aria-checked={spec().color === color}
              aria-label={color}
              title={color}
              class="grid size-6 place-items-center rounded-full border transition-colors focus-ring"
              classList={{
                "border-foreground": spec().color === color,
                "border-transparent hover:border-border-input": spec().color !== color,
              }}
              onClick={() => setSpec("color", color)}
            >
              <span class="size-4 rounded-full border border-black/10 dark:border-white/15" style={{ background: color }} />
            </button>
          )}
        </For>
        <label
          title={t("Any color")}
          class="relative grid size-6 cursor-pointer place-items-center rounded-full border transition-colors focus-within:ring-1 focus-within:ring-ring"
          classList={{ "border-foreground": custom(), "border-transparent hover:border-border-input": !custom() }}
        >
          <span
            class="size-4 rounded-full border border-black/10 dark:border-white/15"
            style={{ background: custom() ? spec().color : "conic-gradient(#FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)" }}
          />
          <input
            type="color"
            aria-label={t("Any color")}
            value={/^#[0-9a-f]{6}$/i.test(spec().color) ? spec().color : "#FFFFFF"}
            onInput={(event) => setSpec("color", event.currentTarget.value.toUpperCase())}
            class="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    );
  }

  function AvatarButton() {
    let input!: HTMLInputElement;
    return (
      <span class="relative -ml-1 flex shrink-0 items-center">
        <button
          type="button"
          title={spec().avatar ? t("Change profile picture") : t("Add a profile picture")}
          aria-label={spec().avatar ? t("Change profile picture") : t("Add a profile picture")}
          class="group/avatar grid size-6 place-items-center overflow-hidden rounded-full bg-[#8A8B91] focus-ring"
          onClick={(event) => {
            event.preventDefault();
            input.click();
          }}
        >
          <Show when={spec().avatar} fallback={<Icon name="plus-add" class="size-3.5 text-white" />}>
            {(url) => <img src={url()} alt="" draggable={false} class="size-full object-cover" />}
          </Show>
        </button>
        <Show when={spec().avatar}>
          <button
            type="button"
            title={t("Remove profile picture")}
            aria-label={t("Remove profile picture")}
            class="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-foreground text-background focus-ring"
            onClick={(event) => {
              event.preventDefault();
              setSpec("avatar", undefined);
            }}
          >
            <Icon name="close-remove-small" class="size-3" />
          </button>
        </Show>
        <input
          ref={input}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void setAvatar(file);
          }}
        />
      </span>
    );
  }

  function Badges() {
    let input!: HTMLInputElement;
    const label = (id: string) => {
      const badge = CHAT_BADGES[platform].find((item) => item.id === id);
      return badge ? t(badge.label, badge.params) : t("Your badge");
    };
    return (
      <div class="grid grid-cols-6 gap-1.5">
        <For each={badgeIds()}>
          {(id) => {
            const on = () => spec().badges.includes(id);
            const own = id.startsWith("data:");
            return (
              <div class="group/badge relative">
                <button
                  type="button"
                  aria-pressed={on()}
                  title={label(id)}
                  aria-label={label(id)}
                  class="grid aspect-square w-full place-items-center rounded-md border bg-[#18181B] px-1 transition-colors focus-ring"
                  classList={{
                    "border-primary ring-1 ring-primary": on(),
                    "border-border hover:border-border-strong": !on(),
                  }}
                  onClick={() => toggleBadge(id)}
                >
                  <img src={badgeUrl(platform, id)} alt="" draggable={false} class="pointer-events-none h-[18px] max-w-full object-contain" />
                </button>
                <Show when={own}>
                  <button
                    type="button"
                    title={t("Remove this badge")}
                    aria-label={t("Remove this badge")}
                    class="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-foreground text-background opacity-0 transition-opacity focus-ring group-hover/badge:opacity-100 focus-visible:opacity-100"
                    onClick={() => removeBadge(id)}
                  >
                    <Icon name="close-remove-small" class="size-3.5" />
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
        <button
          type="button"
          title={t("Add your own badge")}
          aria-label={t("Add your own badge")}
          class="grid aspect-square w-full place-items-center rounded-md border border-dashed border-border-input text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-ring"
          onClick={() => input.click()}
        >
          <Icon name="plus-add" />
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void addBadge(file);
          }}
        />
      </div>
    );
  }

  function Cover() {
    const [src, setSrc] = createSignal<string>();
    renderChatMessage(platform, DEFAULT_CHAT[platform], "bubble", 2)
      .then((canvas) => setSrc(canvas.toDataURL("image/png")))
      .catch(() => {});
    return (
      <div class="relative flex h-20 w-full items-center justify-center overflow-hidden bg-black px-3">
        <img src={STAGE_BACKGROUND} alt="" draggable={false} class="pointer-events-none absolute inset-0 size-full object-cover" />
        <Show when={src()}>
          {(url) => <img src={url()} alt="" draggable={false} class="pointer-events-none relative max-h-full max-w-full object-contain" />}
        </Show>
      </div>
    );
  }

  return { Panel, Cover };
}

const twitch = createChatExtension("twitch");
const tiktok = createChatExtension("tiktok");

export const TwitchChatPanel = twitch.Panel;
export const TwitchChatCover = twitch.Cover;
export const TikTokChatPanel = tiktok.Panel;
export const TikTokChatCover = tiktok.Cover;
