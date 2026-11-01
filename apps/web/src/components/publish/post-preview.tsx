/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createContext, createEffect, createSignal, mergeProps, useContext, type JSX } from "solid-js";

import { YouTubeIcon } from "@/components/brand/youtube-icon";
import { useAuth } from "@/context/auth";
import { AvatarPhoto, useAvatar } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { localized, t } from "@/lib/i18n";
import { accountsFor, loadSocialConnections } from "@/lib/social-connections";
import { formatDuration, picturesOut, socialPlatform, youtubeFormat, type PlatformId } from "@/lib/social";
import { summarizeMedia, type PostMedia } from "@/lib/social-media";
import { MAX_REPLY_PICTURES } from "@/lib/thread";

const COUNT = localized((locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), "en-US");

export type PreviewProps = {
  platform: PlatformId;
  account?: string;
  media: readonly PostMedia[];
  caption: string;
  title: string;
  cover?: string;
  story?: boolean;
  thread?: readonly { text: string; media?: readonly PostMedia[] }[];
  sample?: { name: string; handle: string; avatar?: string | null };
};

// Outline glyphs on a 24 grid (Lucide, ISC).
const GLYPHS = {
  heart: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
  comment: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  repost: ["m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"],
  send: ["M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939"],
  bookmark: ["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"],
  like: ["M7 10v12", "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"],
  share: ["M15 14l5-5-5-5", "M4 20v-7a4 4 0 0 1 4-4h12"],
  music: ["M9 18V5l12-2v13", "M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z", "M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"],
  chart: ["M3 3v16a2 2 0 0 0 2 2h16", "M7 16h8", "M7 11h12", "M7 6h3"],
} as const;

function Glyph(props: { name: keyof typeof GLYPHS; class?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      class={cx("size-4 shrink-0", props.class)}
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width={props.filled ? 0 : 2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <For each={GLYPHS[props.name]}>{(d) => <path d={d} />}</For>
    </svg>
  );
}

function RichText(props: { text: string; tagClass?: string }) {
  const parts = () => props.text.split(/([#@][\p{L}\p{N}_.]+)/gu).filter(Boolean);
  return (
    <For each={parts()}>
      {(part) => (/^[#@]/.test(part) ? <span class={props.tagClass ?? "text-[#4ea4f6]"}>{part}</span> : part)}
    </For>
  );
}

type Account = { name(): string; handle(): string; avatar(): string | null };

const AccountContext = createContext<Account>();

/** A Facebook post comes from the Page, so it shows the Page's name and picture rather than the person's. */
function createAccount(platform: () => PlatformId, accountId: () => string | undefined, sample: () => PreviewProps["sample"]): Account {
  const auth = useAuth();
  const avatar = useAvatar();
  // Read as it changes: a shared preview moves between its networks' accounts.
  if (sample()) return { name: () => sample()?.name ?? "", handle: () => sample()?.handle ?? "", avatar: () => sample()?.avatar || null };
  createEffect(() => loadSocialConnections(auth.user()?.id));
  const connected = () => accountsFor(platform(), accountId() ? { [platform()]: [accountId()!] } : undefined)[0];
  const page = () => (platform() === "facebook" ? connected() : undefined);
  const person = () => auth.user()?.user_metadata?.full_name || auth.user()?.email?.split("@")[0] || t("Your account");
  const name = () => page()?.handle || person();
  const handle = () => connected()?.handle || person().toLowerCase().replace(/[^a-z0-9_.]+/g, "") || "you";
  return { name, handle, avatar: () => page()?.avatarUrl || avatar() };
}

const useAccount = () => useContext(AccountContext)!;

function Avatar(props: { class?: string }) {
  const account = useAccount();
  return (
    <AvatarPhoto
      url={account.avatar()}
      class={cx("shrink-0 rounded-full object-cover", props.class)}
      fallback={
        <span class={cx("grid shrink-0 place-items-center rounded-full bg-white/15 text-[10px] font-semibold text-white", props.class)}>
          {account.name().charAt(0).toUpperCase()}
        </span>
      }
    />
  );
}

function MediaFill(props: {
  media: readonly PostMedia[];
  cover?: string;
  still?: boolean;
  aspect?: number;
  class?: string;
  fit?: "cover" | "contain";
  /** Where the "1/N" count sits; the vertical layouts keep it under their status bar. */
  countClass?: string;
}) {
  const first = () => props.media[0];
  const style = () => (props.aspect ? { "aspect-ratio": String(props.aspect) } : undefined);
  const plays = () => first()?.kind === "video" && !(props.still && props.cover);
  const [paused, setPaused] = createSignal(false);
  let video: HTMLVideoElement | undefined;

  const toggle = () => {
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  return (
    <Show
      when={first()}
      fallback={
        <Show
          when={props.cover}
          fallback={<div class={cx("grid place-items-center bg-white/5 text-[10px] text-white/40", props.class)} style={style()}>{t("No media")}</div>}
        >
          {(cover) => (
            <div class={cx("relative overflow-hidden bg-black", props.class)} style={style()}>
              <img src={cover()} alt="" class="size-full object-cover" />
            </div>
          )}
        </Show>
      }
    >
      {(item) => (
        <div
          class={cx("relative overflow-hidden bg-black outline-none focus-ring", props.class)}
          classList={{ "cursor-pointer": plays() }}
          style={style()}
          role={plays() ? "button" : undefined}
          tabIndex={plays() ? 0 : undefined}
          aria-label={plays() ? (paused() ? t("Play preview") : t("Pause preview")) : undefined}
          onClick={() => plays() && toggle()}
          onKeyDown={(event) => {
            if (!plays() || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            toggle();
          }}
        >
          <Show
            when={plays()}
            fallback={
              <img
                src={item().kind === "video" ? props.cover : item().url}
                alt=""
                class="size-full"
                classList={{ "object-cover": props.fit !== "contain", "object-contain": props.fit === "contain" }}
              />
            }
          >
            <video
              ref={video}
              src={item().url}
              poster={props.cover ?? item().poster}
              class="pointer-events-none size-full"
              classList={{ "object-cover": props.fit !== "contain", "object-contain": props.fit === "contain" }}
              autoplay
              muted
              loop
              playsinline
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
            />
            <Show when={paused()}>
              <span class="pointer-events-none absolute inset-0 grid place-items-center">
                <span class="grid size-11 place-items-center rounded-full bg-black/55 text-white">
                  <svg viewBox="0 0 24 24" class="size-5 translate-x-px" fill="currentColor" aria-hidden="true">
                    <path d="M7 6.25 17 12 7 17.75Z" />
                  </svg>
                </span>
              </span>
            </Show>
          </Show>
          <Show when={props.media.length > 1}>
            <span class={cx("absolute rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white", props.countClass ?? "right-2 top-2")}>
              1/{props.media.length}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}

function StatusBar(props: { light?: boolean }) {
  const ink = () => (props.light ? "bg-black" : "bg-white");
  return (
    <div class={cx("flex h-6 shrink-0 items-center justify-between px-5 text-[10px] font-semibold", props.light ? "text-black" : "text-white")}>
      <span>9:41</span>
      <span class="flex items-center gap-1">
        <span class="flex items-end gap-px">
          <span class={cx("h-1 w-0.5 rounded-[1px]", ink())} />
          <span class={cx("h-1.5 w-0.5 rounded-[1px]", ink())} />
          <span class={cx("h-2 w-0.5 rounded-[1px]", ink())} />
          <span class={cx("h-2.5 w-0.5 rounded-[1px]", ink())} />
        </span>
        <span class={cx("relative h-2.5 w-5 rounded-[3px] border p-px", props.light ? "border-black/60" : "border-white/60")}>
          <span class={cx("block h-full w-3/4 rounded-[1px]", ink())} />
        </span>
      </span>
    </div>
  );
}

function Phone(props: { children: JSX.Element; class?: string }) {
  return (
    <div class="mx-auto w-full max-w-[272px] rounded-[34px] bg-[#1a1a1a] p-[7px] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div class={cx("relative flex aspect-[9/19.5] flex-col overflow-hidden rounded-[28px] bg-black", props.class)}>
        <div class="pointer-events-none absolute left-1/2 top-1.5 z-30 h-[18px] w-[72px] -translate-x-1/2 rounded-full bg-black" />
        {props.children}
      </div>
    </div>
  );
}

function RailButton(props: { glyph: keyof typeof GLYPHS; label: string; filled?: boolean }) {
  return (
    <span class="flex flex-col items-center gap-0.5 text-white">
      <Glyph name={props.glyph} filled={props.filled} class="size-6 drop-shadow" />
      <span class="text-[9px] font-semibold drop-shadow">{props.label}</span>
    </span>
  );
}

function StoryPreview(props: PreviewProps) {
  const account = useAccount();
  return (
    <Phone>
      <StatusBar />
      <div class="relative mx-1 min-h-0 flex-1 overflow-hidden rounded-xl">
        <MediaFill media={props.media} cover={props.cover} fit="contain" class="absolute inset-0" />
        <div class="pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-black/50 to-transparent" />
        <div class="pointer-events-none relative z-10 flex flex-col gap-2 px-2.5 pt-2">
          <span class="h-0.5 w-full overflow-hidden rounded-full bg-white/35">
            <span class="block h-full w-1/3 rounded-full bg-white" />
          </span>
          <div class="flex items-center gap-1.5 text-white drop-shadow">
            <Avatar class="size-6" />
            <span class="truncate text-[11px] font-semibold">{props.platform === "facebook" ? account.name() : account.handle()}</span>
            <span class="text-[10px] text-white/70">{t("now")}</span>
            <Glyph name="more" class="ml-auto size-4" />
            <span class="text-[15px] leading-none">×</span>
          </div>
        </div>
      </div>
      <div class="flex h-12 shrink-0 items-center gap-3 px-3">
        <span class="flex h-8 flex-1 items-center rounded-full border border-white/40 px-3 text-[10.5px] text-white/80">
          {props.platform === "facebook" ? t("Reply…") : t("Send message")}
        </span>
        <Glyph name={props.platform === "facebook" ? "like" : "heart"} class="size-5 text-white" />
        <Glyph name="send" class="size-5 text-white" />
      </div>
    </Phone>
  );
}

function VerticalPreview(props: PreviewProps) {
  const account = useAccount();
  const id = () => props.platform;
  return (
    <Phone>
      <MediaFill media={props.media} cover={props.cover} class="absolute inset-0" countClass="right-2 top-16" />
      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.35)_0%,transparent_18%,transparent_55%,rgba(0,0,0,0.65)_100%)]" />
      <div class="pointer-events-none relative z-10 flex h-full flex-col">
        <StatusBar />
        <div class="flex h-8 items-center justify-center gap-4 text-[12px] font-semibold text-white drop-shadow">
          <Switch>
            <Match when={id() === "tiktok"}>
              <span class="text-white/60">{t({ message: "Following", context: "feed tab" })}</span>
              <span class="relative">
                {t("For You")}
                <span class="absolute -bottom-1.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-white" />
              </span>
            </Match>
            <Match when={id() === "instagram"}>
              <span class="mr-auto pl-3 text-[15px] font-bold">Reels</span>
            </Match>
            <Match when={id() === "youtube"}>
              <span class="mr-auto pl-3 text-[13px] font-bold">Shorts</span>
            </Match>
          </Switch>
        </div>

        <div class="mt-auto flex items-end gap-2 px-3 pb-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1.5 text-white drop-shadow">
            <div class="flex items-center gap-1.5">
              <Show when={id() !== "tiktok"}>
                <Avatar class="size-6" />
              </Show>
              <span class="truncate text-[11px] font-semibold">@{account.handle()}</span>
              <Show when={id() === "instagram"}>
                <span class="rounded-md border border-white/70 px-1.5 py-px text-[9px] font-semibold">{t("Follow")}</span>
              </Show>
              <Show when={id() === "youtube"}>
                <span class="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-black">{t("Subscribe")}</span>
              </Show>
            </div>
            <Show when={id() === "youtube" && props.title.trim()}>
              <p class="line-clamp-2 text-[11px] font-medium leading-snug">{props.title}</p>
            </Show>
            <Show when={id() !== "youtube" && props.caption.trim()}>
              <p class="line-clamp-3 whitespace-pre-line text-[10.5px] leading-snug">
                <RichText text={props.caption} tagClass="font-semibold" />
              </p>
            </Show>
            <Show when={id() !== "youtube"}>
              <span class="flex items-center gap-1 text-[9.5px] text-white/90">
                <Glyph name="music" class="size-3" />
                <span class="truncate">{t("Original audio · {name}", { name: account.name() })}</span>
              </span>
            </Show>
          </div>

          <div class="flex shrink-0 flex-col items-center gap-3 pb-1">
            <Show when={id() === "tiktok"}>
              <span class="relative mb-1">
                <Avatar class="size-8 ring-1 ring-white" />
                <span class="absolute -bottom-1.5 left-1/2 grid size-3.5 -translate-x-1/2 place-items-center rounded-full bg-[#fe2c55] text-[10px] font-bold leading-none text-white">+</span>
              </span>
            </Show>
            <RailButton glyph={id() === "youtube" ? "like" : "heart"} label={COUNT().format(12_400)} filled={id() === "tiktok"} />
            <RailButton glyph="comment" label={COUNT().format(318)} filled={id() === "tiktok"} />
            <Show when={id() === "tiktok"}>
              <RailButton glyph="bookmark" label={COUNT().format(1_200)} filled />
            </Show>
            <RailButton glyph={id() === "instagram" ? "send" : "share"} label={t("Share")} />
            <Show when={id() !== "youtube"}>
              <span class="size-6 rounded-md border-2 border-white/80 bg-white/20" />
            </Show>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function AppBar(props: { platform: PlatformId }) {
  const platform = () => socialPlatform(props.platform);
  return (
    <div class="flex h-9 shrink-0 items-center justify-center border-b border-white/10">
      <svg viewBox="0 0 24 24" class="size-4" fill="white" aria-label={platform().name}>
        <path d={platform().logo} />
      </svg>
    </div>
  );
}

function replyAspect(media: readonly PostMedia[]) {
  const first = media[0];
  if (!first || !first.width || !first.height) return 1;
  return Math.min(1.91, Math.max(0.8, first.width / first.height));
}

function FeedPreview(props: PreviewProps) {
  const account = useAccount();
  const id = () => props.platform;
  const wide = () => id() === "facebook" || id() === "linkedin";
  const replies = () => (props.thread ?? []).filter((reply) => reply.text.trim() || reply.media?.length);
  const aspect = () => {
    const first = props.media[0];
    if (!first || !first.width || !first.height) return 1;
    return Math.min(1.91, Math.max(0.8, first.width / first.height));
  };

  return (
    <Phone>
      <StatusBar />
      <AppBar platform={id()} />
      <div class="min-h-0 flex-1 overflow-hidden">
        <article class="flex gap-2 px-3 pt-3" classList={{ "flex-col": wide() }}>
          <div class="flex shrink-0 items-start gap-2" classList={{ "items-center": wide(), "flex-col": !wide() && replies().length > 0 }}>
            <Avatar class="size-8" />
            <Show when={!wide() && replies().length}>
              <span class="-mb-3 w-0.5 flex-1 self-center rounded-full bg-white/15" />
            </Show>
            <Show when={wide()}>
              <div class="flex min-w-0 flex-col">
                <span class="truncate text-[11px] font-semibold text-white">{account.name()}</span>
                <span class="text-[9.5px] text-white/50">{id() === "linkedin" ? t("Creator · Now") : t("Just now · Public")}</span>
              </div>
              <Glyph name="more" class="ml-auto size-4 text-white/60" />
            </Show>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <Show when={!wide()}>
              <div class="flex min-w-0 items-center gap-1 text-[11px]">
                <span class="truncate font-semibold text-white">{account.name()}</span>
                <span class="truncate text-white/45">{id() === "threads" ? t("now") : t("@{handle} · now", { handle: account.handle() })}</span>
              </div>
            </Show>
            <Show when={props.caption.trim()}>
              <p class="line-clamp-[8] whitespace-pre-line break-words text-[11px] leading-snug text-white/95">
                <RichText text={props.caption} tagClass={id() === "linkedin" ? "font-semibold text-[#71b7fb]" : "text-[#4ea4f6]"} />
              </p>
            </Show>
            <Show when={props.media.length || props.cover}>
              <MediaFill
                media={props.media}
                cover={props.cover}
                aspect={aspect()}
                class={cx("w-full", wide() ? "-mx-3 w-[calc(100%+1.5rem)]" : "rounded-xl border border-white/10")}
                fit="cover"
              />
            </Show>
            <div class="flex items-center justify-between pr-2 pt-1 text-white/55" classList={{ "border-t border-white/10 pt-2": wide() }}>
              <Switch>
                <Match when={wide()}>
                  <span class="flex items-center gap-1 text-[10px]"><Glyph name="like" class="size-3.5" />{t("Like")}</span>
                  <span class="flex items-center gap-1 text-[10px]"><Glyph name="comment" class="size-3.5" />{t("Comment")}</span>
                  <span class="flex items-center gap-1 text-[10px]"><Glyph name={id() === "linkedin" ? "repost" : "share"} class="size-3.5" />{id() === "linkedin" ? t("Repost") : t("Share")}</span>
                </Match>
                <Match when={!wide()}>
                  <Glyph name="comment" class="size-3.5" />
                  <Glyph name="repost" class="size-3.5" />
                  <Glyph name="heart" class="size-3.5" />
                  <Show when={id() === "x"} fallback={<Glyph name="send" class="size-3.5" />}>
                    <Glyph name="chart" class="size-3.5" />
                  </Show>
                </Match>
              </Switch>
            </div>
          </div>
        </article>
        <Show
          when={replies().length}
          fallback={
            <div class="mx-3 mt-3 flex gap-2 border-t border-white/10 pt-3 opacity-30">
              <Show when={!wide()}>
                <div class="size-8 shrink-0 rounded-full bg-white/20" />
              </Show>
              <div class="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                <div class="h-2 w-2/3 rounded-full bg-white/20" />
                <div class="h-2 w-1/2 rounded-full bg-white/20" />
              </div>
            </div>
          }
        >
          <Show
            when={!wide()}
            fallback={
              <div class="flex flex-col gap-2 px-3 pt-2.5">
                <For each={replies().filter((reply) => reply.text.trim())}>
                  {(reply) => (
                    <div class="flex gap-1.5">
                      <Avatar class="size-6" />
                      <div class="min-w-0 flex-1 rounded-lg rounded-tl-none bg-white/8 px-2 py-1.5">
                        <span class="block truncate text-[10px] font-semibold text-white">{account.name()}</span>
                        <p class="line-clamp-4 whitespace-pre-line break-words text-[10.5px] leading-snug text-white/90">
                          <RichText text={reply.text} tagClass="font-semibold text-[#71b7fb]" />
                        </p>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <For each={replies()}>
              {(reply, index) => (
                <article class="flex gap-2 px-3 pt-3">
                  <div class="flex shrink-0 flex-col items-center">
                    <Avatar class="size-8" />
                    <Show when={index() < replies().length - 1}>
                      <span class="-mb-3 mt-1 w-0.5 flex-1 rounded-full bg-white/15" />
                    </Show>
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <div class="flex min-w-0 items-center gap-1 text-[11px]">
                      <span class="truncate font-semibold text-white">{account.name()}</span>
                      <span class="truncate text-white/45">{t("@{handle} · now", { handle: account.handle() })}</span>
                    </div>
                    <Show when={reply.text.trim()}>
                      <p class="line-clamp-[6] whitespace-pre-line break-words text-[11px] leading-snug text-white/95">
                        <RichText text={reply.text} />
                      </p>
                    </Show>
                    <Show when={reply.media?.length}>
                      <MediaFill
                        media={reply.media!.slice(0, MAX_REPLY_PICTURES)}
                        aspect={replyAspect(reply.media!)}
                        class="w-full rounded-xl border border-white/10"
                        fit="cover"
                      />
                    </Show>
                  </div>
                </article>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </Phone>
  );
}

function YouTubeVideoPreview(props: PreviewProps) {
  const account = useAccount();
  const first = () => props.media[0];
  return (
    <Phone>
      <StatusBar />
      <div class="flex h-9 shrink-0 items-center px-3">
        <YouTubeIcon label />
      </div>
      <div class="relative">
        <MediaFill media={props.media} cover={props.cover} still class="aspect-video w-full" />
        <Show when={first()?.kind === "video"}>
          <span class="absolute bottom-1.5 right-1.5 rounded-[3px] bg-black/80 px-1 text-[9px] font-semibold text-white">
            {formatDuration(first()!.duration)}
          </span>
        </Show>
      </div>
      <div class="flex gap-2 px-3 py-2.5">
        <Avatar class="size-7" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <p class="line-clamp-2 text-[11.5px] font-medium leading-snug text-white">{props.title.trim() || t("Add a title")}</p>
          <span class="truncate text-[9.5px] text-white/55">{t("{name} · No views · Just now", { name: account.name() })}</span>
        </div>
      </div>
      <div class="mx-3 flex flex-col gap-2 opacity-30">
        <div class="aspect-video w-full rounded-lg bg-white/10" />
      </div>
    </Phone>
  );
}

function PinterestPreview(props: PreviewProps) {
  const account = useAccount();
  return (
    <Phone class="bg-white">
      <StatusBar light />
      <div class="grid min-h-0 flex-1 grid-cols-2 gap-1.5 overflow-hidden px-2 pt-2">
        <div class="flex flex-col gap-1">
          <MediaFill media={props.media} cover={props.cover} still class="aspect-[2/3] w-full rounded-xl" />
          <Show when={props.title.trim()}>
            <p class="line-clamp-2 px-0.5 text-[10px] font-semibold leading-tight text-black">{props.title}</p>
          </Show>
          <span class="flex items-center gap-1 px-0.5">
            <Avatar class="size-4" />
            <span class="truncate text-[9px] text-black/70">{account.name()}</span>
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="aspect-[3/4] w-full rounded-xl bg-black/10" />
          <div class="aspect-square w-full rounded-xl bg-black/10" />
        </div>
      </div>
    </Phone>
  );
}

export function PostPreview(props: PreviewProps) {
  const shown = mergeProps(props, {
    get media() {
      return props.media[0]?.kind === "image" ? props.media.slice(0, picturesOut(props.platform)) : props.media;
    },
  });
  const shortForm = () => youtubeFormat(summarizeMedia(props.media)) === "short";
  return (
    <AccountContext.Provider value={createAccount(() => props.platform, () => props.account, () => props.sample)}>
      <Switch fallback={<FeedPreview {...shown} />}>
        <Match when={props.story}>
          <StoryPreview {...shown} />
        </Match>
        <Match when={props.platform === "tiktok" || props.platform === "instagram"}>
          <VerticalPreview {...shown} />
        </Match>
        <Match when={props.platform === "youtube" && (shortForm() || !props.media.length)}>
          <VerticalPreview {...shown} />
        </Match>
        <Match when={props.platform === "youtube"}>
          <YouTubeVideoPreview {...shown} />
        </Match>
        <Match when={props.platform === "pinterest"}>
          <PinterestPreview {...shown} />
        </Match>
      </Switch>
    </AccountContext.Provider>
  );
}
