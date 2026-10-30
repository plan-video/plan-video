/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A post shared for feedback, at /p/<id>: the post as each of its networks
// will show it, where and when it goes out, and the comments on it. Open to
// anyone with the link, signed in or not. Drawn like the dashboard, in its
// light or dark theme: the post's details, the phone and the comments as the
// panels of one frame, stacked on a phone.

import { A, useParams } from "@solidjs/router";
import MessageSquareLucide from "lucide-solid/icons/message-square";
import Volume2Lucide from "lucide-solid/icons/volume-2";
import VolumeXLucide from "lucide-solid/icons/volume-x";
import { For, Index, Match, Show, Switch, createEffect, createMemo, createRenderEffect, createResource, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { toast } from "somoto";

import { MARK_PATH } from "@/components/brand/logo";
import { statusLabel } from "@/components/calendar/utils";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon, type PlaneIconName } from "@/components/dashboard/plane-icons";
import { DashboardSidebarSection, dashboardNavItemClass } from "@/components/dashboard/sidebar";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { PostPreview } from "@/components/publish/post-preview";
import { CommentComposer, CommentThreads } from "@/components/publish/preview-comments";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { dashboardTheme } from "@/lib/dashboard-theme";
import { intlLocale, msg, t } from "@/lib/i18n";
import { loadPreview, previewLink, previewMediaUrl, type PreviewSnapshot, type SharedPreview } from "@/lib/post-previews";
import { accountLabel } from "@/lib/social-connections";
import { PLATFORM_IDS, picturesOut, type PlatformId } from "@/lib/social";
import { THREAD_PLATFORMS } from "@/lib/thread";
import type { PostMedia } from "@/lib/social-media";

type Loaded = { kind: "ok"; preview: SharedPreview } | { kind: "gone" } | { kind: "error" };
type Network = PreviewSnapshot["platforms"][number];
/** One of the post's files, read for the phone: its link and its shape. */
type Shown = { file: string; url: string; width: number; height: number; duration: number };

/** Comments from others show up without a reload. */
const REFRESH_MS = 30_000;

/** The file a post of one file is kept under: its own id, which the link asks for by leaving it out. No file id has a colon. */
const ONLY = ":post";

/** The phone at its own size, as New post measures it before scaling it to the room. */
const PHONE = { width: 286, height: 588 };

/** Where the post's details and the comments sit beside the phone, rather than above and below it. */
const WIDE = "(min-width: 1024px)";

const DETAILS_PANEL = "w-[280px] shrink-0 border-r border-(--plane-border-subtle) 2xl:w-[320px]";
const COMMENTS_PANEL = "w-[340px] shrink-0 border-l border-(--plane-border-subtle) 2xl:w-[380px]";

/** `when` is the day, with the time when there is one. */
const STATUS_WORDS: Record<PreviewSnapshot["status"], string> = {
  draft: msg("Draft for {when}"),
  scheduled: msg("Scheduled for {when}"),
  posted: msg("Posted on {when}"),
};

/** The same dots as the dashboard's post lists. */
const STATUS_DOT: Record<PreviewSnapshot["status"], string> = {
  draft: "bg-(--plane-text-placeholder)",
  scheduled: "bg-(--plane-accent-primary)",
  posted: "bg-meter-green",
};

/** "Scheduled for Mon, 6 Oct at 18:00 (Amsterdam time)", read in the zone the post was planned in. */
function whenLine(snapshot: PreviewSnapshot): string {
  const date = new Date(`${snapshot.day}T12:00:00`);
  const day = Number.isNaN(date.getTime())
    ? snapshot.day
    : date.toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short" });
  const when = snapshot.allDay
    ? day
    : snapshot.timeZone
      ? t("{day} at {time} ({zone} time)", { day, time: snapshot.start, zone: snapshot.timeZone.split("/").pop()?.replace(/_/g, " ") })
      : t("{day} at {time}", { day, time: snapshot.start });
  return t(STATUS_WORDS[snapshot.status] ?? msg("Planned for {when}"), { when });
}

const isPlatform = (id: string): id is PlatformId => (PLATFORM_IDS as readonly string[]).includes(id);

/** Where a post's link goes, when it's a web address: a link written as anything else stays words. */
function hrefOf(link: string): string | null {
  const trimmed = link.trim();
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** A file's shape and length, read from the file: the preview doesn't keep them. Zero when it can't be read. */
function measure(url: string, kind: "video" | "image"): Promise<Omit<Shown, "file" | "url">> {
  return new Promise((resolve) => {
    const done = (width = 0, height = 0, duration = 0) => resolve({ width, height, duration: Number.isFinite(duration) ? duration : 0 });
    setTimeout(() => done(), 8000);
    if (kind === "image") {
      const image = new Image();
      image.onload = () => done(image.naturalWidth, image.naturalHeight);
      image.onerror = () => done();
      image.src = url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      done(video.videoWidth, video.videoHeight, video.duration);
      // Done with it: the phone plays its own.
      video.removeAttribute("src");
      video.load();
    };
    video.onerror = () => done();
    video.src = url;
  });
}

function createMatches(query: string) {
  const list = window.matchMedia(query);
  const [matches, setMatches] = createSignal(list.matches);
  const update = () => setMatches(list.matches);
  list.addEventListener("change", update);
  onCleanup(() => list.removeEventListener("change", update));
  return matches;
}

export function PostPreviewPage() {
  const params = useParams<{ id: string }>();
  const auth = useAuth();
  const wide = createMatches(WIDE);

  // The dashboard's palette, on <html> so toasts take it too. index.html puts
  // it there before the first paint.
  const root = document.documentElement;
  root.classList.add("dashboard-theme");
  createRenderEffect(() => {
    root.dataset.dashboardTheme = dashboardTheme();
  });
  onCleanup(() => {
    root.classList.remove("dashboard-theme");
    delete root.dataset.dashboardTheme;
  });

  // Failures come back as a state, not thrown, so the page says what happened
  // itself. A refresh that fails keeps showing what was there.
  const [result, { refetch }] = createResource(
    () => params.id,
    async (id, info): Promise<Loaded> => {
      try {
        const found = await loadPreview(id);
        return found ? { kind: "ok", preview: found } : { kind: "gone" };
      } catch {
        const previous = info.value as Loaded | undefined;
        return previous?.kind === "ok" ? previous : { kind: "error" };
      }
    },
  );
  const preview = () => {
    const current = result.latest;
    return current?.kind === "ok" ? current.preview : undefined;
  };
  const reload = async () => {
    await refetch();
  };
  const accountName = () => auth.user()?.user_metadata?.full_name || auth.user()?.email?.split("@")[0] || "";

  onMount(() => {
    const previous = document.title;
    // Again when the language changes, or the post's title.
    createRenderEffect(() => {
      document.title = t("{title} | plan.video", { title: preview()?.snapshot.title.trim() || t("Post preview") });
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && preview()) void refetch();
    }, REFRESH_MS);
    onCleanup(() => {
      clearInterval(timer);
      document.title = previous;
    });
  });

  return (
    <div class="flex min-h-dvh flex-col bg-(--plane-canvas) text-(--plane-text-primary) lg:h-dvh lg:min-h-0">
      <TopBar previewId={params.id} shared={!!preview()} />
      <Frame wide={wide()}>
        <Switch>
          <Match when={result.latest?.kind === "error"}>
            <Message icon="info" title={t("This preview couldn't be loaded")} body={t("Check your connection and try again.")}>
              <PlaneButton variant="secondary" size="lg" onClick={() => void refetch()}>
                {t("Try again")}
              </PlaneButton>
            </Message>
          </Match>
          <Match when={result.latest?.kind === "gone"}>
            <Message icon="link" title={t("This preview isn't shared any more")} body={t("Ask the person who sent it for a new link.")} />
          </Match>
          <Match when={preview()}>
            {(current) => (
              <SharedPost
                previewId={params.id}
                preview={current()}
                wide={wide()}
                ownerName={accountName() || t("Author")}
                suggestedName={accountName()}
                onChanged={reload}
              />
            )}
          </Match>
          <Match when={!result.latest}>
            <Skeleton wide={wide()} />
          </Match>
        </Switch>
      </Frame>
    </div>
  );
}

/** The bar on the page's ground: the logo home, and the link to pass on. */
function TopBar(props: { previewId: string; shared: boolean }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(previewLink(props.previewId));
      toast.success(t("Link copied"), { description: t("Anyone with it can see this post and comment.") });
    } catch {
      toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
    }
  };

  return (
    <header class="flex h-12 shrink-0 items-center gap-3 px-4 lg:px-3.5">
      <A href="/" class="flex items-center gap-2 rounded-md pr-1 outline-none focus-ring" aria-label={t("plan.video home")}>
        {/* The workspace badge's tile, as the dashboard's bar shows it. */}
        <svg viewBox="0 0 32 32" aria-hidden="true" class="size-7 shrink-0 rounded-md bg-(--logo-tile) ring-1 ring-inset ring-(--plane-border-subtle)">
          <g transform="translate(16 16) scale(0.72) translate(-16 -16)">
            <path class="fill-(--logo-ink)" d={MARK_PATH} />
          </g>
        </svg>
        <span class="text-sm leading-5 font-medium text-(--plane-text-primary)">plan.video</span>
      </A>
      <Show when={props.shared}>
        <PlaneButton variant="secondary" size="lg" class="ml-auto gap-1.5 pl-2" onClick={() => void copy()}>
          <PlaneIcon name="link" class="size-3.5 text-(--plane-text-secondary)" />
          {t("Copy link")}
        </PlaneButton>
      </Show>
    </header>
  );
}

/** The dashboard's bordered frame on a wide screen; on a phone, the page itself. */
function Frame(props: { wide: boolean; children: JSX.Element }) {
  return (
    <div class={cx("flex min-h-0 flex-1 flex-col", props.wide && "px-2 pb-2")}>
      <div
        class={cx(
          "relative flex min-h-0 flex-1 bg-(--plane-surface-1)",
          props.wide ? "depth-frame overflow-hidden rounded-xl border border-(--plane-border-subtle)" : "flex-col border-t border-(--plane-border-subtle)",
        )}
      >
        {props.children}
      </div>
    </div>
  );
}

function SharedPost(props: {
  previewId: string;
  preview: SharedPreview;
  wide: boolean;
  ownerName: string;
  suggestedName: string;
  onChanged(): Promise<void>;
}) {
  const snapshot = () => props.preview.snapshot;

  // The account whose view of the post shows: a network, and which of its accounts.
  const [picked, setPicked] = createSignal({ platform: "", account: 0 });
  const network = (): Network | undefined => snapshot().platforms.find((item) => item.id === picked().platform) ?? snapshot().platforms[0];
  const accountIndex = () => (network()?.id === picked().platform ? picked().account : 0);

  return (
    <>
      <PostDetails
        snapshot={snapshot()}
        wide={props.wide}
        network={network()}
        accountIndex={accountIndex()}
        onPick={(platform, account) => setPicked({ platform, account })}
      />
      <PhoneStage previewId={props.previewId} snapshot={snapshot()} wide={props.wide} network={network()} accountIndex={accountIndex()} />
      <Show when={!props.wide}>
        <div class="flex flex-col gap-4 px-3 pb-6">
          <PostWords snapshot={snapshot()} network={network()} />
        </div>
      </Show>
      <CommentsPanel
        previewId={props.previewId}
        preview={props.preview}
        wide={props.wide}
        ownerName={props.ownerName}
        suggestedName={props.suggestedName}
        onChanged={props.onChanged}
      />
    </>
  );
}

/**
 * The post's sidebar: its title, when it goes out, and the accounts it goes
 * out from, each of which turns the phone to its own view. On a wide screen
 * the words follow; on a phone they come after the phone.
 */
function PostDetails(props: {
  snapshot: PreviewSnapshot;
  wide: boolean;
  network: Network | undefined;
  accountIndex: number;
  onPick(platform: string, account: number): void;
}) {
  // Every account, or the network itself where none was picked.
  const rows = () =>
    props.snapshot.platforms.flatMap((network) =>
      network.handles.length
        ? network.handles.map((handle, account) => ({ network, account, label: accountLabel({ platform: network.id, handle }), avatar: network.avatars?.[account] ?? "" }))
        : [{ network, account: 0, label: network.name, avatar: "" }],
    );

  return (
    <aside class={cx("flex flex-col", props.wide ? `${DETAILS_PANEL} overflow-y-auto` : "")}>
      <div class={cx("flex flex-col gap-1.5 px-5", props.wide ? "pt-3 pb-4" : "pt-5 pb-3")}>
        <h1 class="line-clamp-3 break-words text-[15px] leading-6 font-medium tracking-[-0.01em] text-(--plane-text-primary)">
          {props.snapshot.title.trim() || t("Post preview")}
        </h1>
        <p class="flex items-start gap-2 text-xs leading-5 text-(--plane-text-secondary)">
          <span class={cx("mt-[7px] size-1.5 shrink-0 rounded-full", STATUS_DOT[props.snapshot.status])} title={statusLabel(props.snapshot.status)} />
          {whenLine(props.snapshot)}
        </p>
      </div>
      <div class={cx("flex flex-col gap-4 px-3", props.wide ? "pb-5" : "pb-2")}>
        <Show when={rows().length}>
          <DashboardSidebarSection title={t("Accounts")}>
            <div role="radiogroup" aria-label={t("Preview platform")} class="flex flex-col gap-0.5">
              <Index each={rows()}>
                {(row) => {
                  const active = () => props.network?.id === row().network.id && props.accountIndex === row().account;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active()}
                      title={`${row().network.name}, ${row().label}`}
                      class={dashboardNavItemClass(active())}
                      onClick={() => props.onPick(row().network.id, row().account)}
                    >
                      <span class="flex min-w-0 items-center gap-1.5 py-px">
                        <AccountAvatar account={{ platform: row().network.id, avatarUrl: row().avatar.startsWith("https://") ? row().avatar : undefined }} />
                        <span class="min-w-0 truncate text-sm leading-5 font-medium">{row().label}</span>
                      </span>
                    </button>
                  );
                }}
              </Index>
            </div>
          </DashboardSidebarSection>
        </Show>
        <Show when={props.wide}>
          <PostWords snapshot={props.snapshot} network={props.network} />
        </Show>
      </div>
    </aside>
  );
}

/** Caption text with its hashtags and mentions picked out. */
function Caption(props: { text: string }) {
  const parts = () => props.text.split(/([#@][\p{L}\p{N}_.]+)/u);
  return (
    <p class="whitespace-pre-wrap break-words text-[13px] leading-5 text-(--plane-text-primary) select-text">
      <For each={parts()}>{(part) => (/^[#@][\p{L}\p{N}_]/u.test(part) ? <span class="text-(--plane-accent-secondary)">{part}</span> : part)}</For>
    </p>
  );
}

/** What the post says on the network that shows: its title there, its caption, and its link. */
function PostWords(props: { snapshot: PreviewSnapshot; network: Network | undefined }) {
  const id = () => props.network?.id ?? "";
  const own = () => props.snapshot.captions?.[id()];
  const caption = () => own() ?? props.snapshot.caption;
  const title = () => (id() === "youtube" ? props.snapshot.youtubeTitle : id() === "pinterest" ? props.snapshot.pinterestTitle : null) ?? "";
  // Only the networks that post a thread show it.
  const thread = () => ((THREAD_PLATFORMS as readonly string[]).includes(id()) ? (props.snapshot.thread ?? []) : []);

  return (
    <>
      <Show when={title().trim()}>
        <DashboardSidebarSection title={t("Title")}>
          <p class="px-2 text-[13px] leading-5 font-medium break-words text-(--plane-text-primary) select-text">{title()}</p>
        </DashboardSidebarSection>
      </Show>
      <Show when={!props.snapshot.story}>
        <DashboardSidebarSection title={own() !== undefined && props.network ? t("Caption for {network}", { network: props.network.name }) : t("Caption")}>
          <div class="px-2">
            <Show when={caption().trim()} fallback={<p class="text-[13px] leading-5 text-(--plane-text-tertiary)">{t("No caption")}</p>}>
              <Caption text={caption()} />
            </Show>
          </div>
        </DashboardSidebarSection>
      </Show>
      <Show when={thread().length}>
        <DashboardSidebarSection title={t("Thread")}>
          <ol class="flex flex-col gap-2 px-2">
            <For each={thread()}>
              {(text) => (
                <li>
                  <Caption text={text} />
                </li>
              )}
            </For>
          </ol>
        </DashboardSidebarSection>
      </Show>
      <Show when={props.snapshot.link?.trim()}>
        {(link) => (
          <DashboardSidebarSection title={t("Link")}>
            <Show when={hrefOf(link())} fallback={<p class="truncate px-2 text-[13px] leading-5 text-(--plane-text-secondary) select-text">{link()}</p>}>
              {(href) => (
                <a
                  href={href()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate rounded-sm px-2 text-[13px] leading-5 text-(--plane-accent-secondary) outline-none hover:underline focus-ring"
                >
                  {link()}
                </a>
              )}
            </Show>
          </DashboardSidebarSection>
        )}
      </Show>
    </>
  );
}

/**
 * The post in a phone, as the picked network shows it, scaled to the room.
 * Under it: the pictures one by one when there are several, and the sound
 * for a video, which plays muted until it's turned on.
 */
function PhoneStage(props: { previewId: string; snapshot: PreviewSnapshot; wide: boolean; network: Network | undefined; accountIndex: number }) {
  const platform = (): PlatformId | undefined => {
    const id = props.network?.id;
    return id && isPlatform(id) ? id : undefined;
  };
  const kind = () => props.snapshot.media;
  const files = () => props.snapshot.files ?? (kind() ? [ONLY] : []);
  // Pictures past what the network puts out are left out, as they would be.
  const count = () => {
    const id = platform();
    if (kind() !== "image") return Math.min(1, files().length);
    return id ? Math.min(files().length, picturesOut(id)) : files().length;
  };
  const [shownAt, setShownAt] = createSignal(0);
  const at = () => Math.min(shownAt(), Math.max(0, count() - 1));

  // A post with several pictures reads each one as it comes up.
  let readAt = 0;
  const [media, { refetch: readAgain }] = createResource(
    () => (kind() ? files()[at()] : undefined),
    async (file): Promise<Shown | null> => {
      readAt = Date.now();
      const url = await previewMediaUrl(props.previewId, file === ONLY ? undefined : file);
      if (!url) return null;
      return { file, url, ...(await measure(url, kind() ?? "image")) };
    },
  );
  // Until the next picture has come, the last one stays.
  const items = createMemo((): PostMedia[] => {
    const shown = media.latest;
    const type = kind();
    if (!shown || !type) return [];
    return [{ id: shown.file, file: new File([], ""), kind: type, url: shown.url, width: shown.width, height: shown.height, duration: shown.duration, poster: "" }];
  });
  const missing = () => !!kind() && !media.loading && media.latest === null;

  const account = createMemo(() => {
    const network = props.network;
    if (!network) return { name: "", handle: "" };
    // A network with no account picked borrows the post's other handle, as a brand mostly keeps one.
    const handle = network.handles[props.accountIndex] ?? props.snapshot.platforms.find((item) => item.handles.length)?.handles[0] ?? "";
    const avatar = network.handles[props.accountIndex] ? network.avatars?.[props.accountIndex] : undefined;
    return {
      name: handle || network.name,
      handle: handle.replace(/\s+/g, "").toLowerCase() || network.name.toLowerCase().replace(/[^a-z0-9_.]+/g, ""),
      avatar: avatar?.startsWith("https://") ? avatar : null,
    };
  });
  const caption = () => (props.snapshot.story ? "" : (props.snapshot.captions?.[props.network?.id ?? ""] ?? props.snapshot.caption));
  const title = () => (platform() === "youtube" ? props.snapshot.youtubeTitle : platform() === "pinterest" ? props.snapshot.pinterestTitle : null) ?? "";

  const [scale, setScale] = createSignal(1);
  const [sound, setSound] = createSignal(false);
  let stage!: HTMLDivElement;

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stage.clientWidth <= 0) return;
      // Room for the bar under the phone, and a margin all round.
      const fit = props.wide
        ? Math.min((stage.clientWidth - 64) / PHONE.width, (stage.clientHeight - 120) / PHONE.height)
        : (stage.clientWidth - 40) / PHONE.width;
      setScale(Math.min(props.wide ? 1.5 : 1.15, Math.max(0.6, fit)));
    });
    observer.observe(stage);
    onCleanup(() => observer.disconnect());

    // A file's link lasts a quarter of an hour: one that has run out is asked for again.
    const failed = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement)) return;
      if (Date.now() - readAt > 60_000) void readAgain();
    };
    stage.addEventListener("error", failed, true);
    onCleanup(() => stage.removeEventListener("error", failed, true));
  });

  const applySound = (on: boolean) => {
    for (const video of stage.querySelectorAll("video")) {
      video.muted = !on;
      if (on && video.paused) void video.play().catch(() => {});
    }
  };
  // Right in the click: a phone only lets a video play its sound from a tap.
  const toggleSound = () => {
    setSound(!sound());
    applySound(sound());
  };
  // The phone draws a new video for each network: it takes the sound as it's set.
  createEffect(() => {
    const on = sound();
    items();
    platform();
    requestAnimationFrame(() => applySound(on));
  });

  return (
    <section ref={stage} aria-label={t("Preview")} class={cx("relative flex min-w-0 flex-col", props.wide ? "min-h-0 flex-1 overflow-auto p-8" : "px-5 py-4")}>
      {/* Centred by its margins, so a phone taller than the room still scrolls to its top. */}
      <div class="my-auto flex flex-col items-center gap-4">
        <Show when={platform()}>
          {(id) => (
            <div class="w-[272px] shrink-0" style={{ zoom: String(scale()) }}>
              <PostPreview
                platform={id()}
                media={items()}
                caption={caption()}
                thread={THREAD_PLATFORMS.includes(id()) ? props.snapshot.thread?.map((text) => ({ text })) : undefined}
                title={title()}
                story={props.snapshot.story}
                sample={account()}
              />
            </div>
          )}
        </Show>
        <Show when={missing()}>
          <p class="text-center text-xs text-(--plane-text-tertiary)">
            {kind() === "video" ? t("The video isn't available right now.") : t("The picture isn't available right now.")}
          </p>
        </Show>
        <Show when={count() > 1 || (kind() === "video" && media.latest)}>
          <div class="flex shrink-0 items-center gap-0.5 rounded-lg border border-(--plane-border-subtle) bg-(--plane-surface-1) p-0.5 shadow-(--plane-shadow-raised-100)">
            <Show when={count() > 1}>
              <StageButton label={t("Previous picture")} disabled={at() === 0} onClick={() => setShownAt(at() - 1)}>
                <PlaneIcon name="chevron-left" class="size-4" />
              </StageButton>
              <span class="min-w-11 text-center text-xs tabular-nums text-(--plane-text-secondary)">
                {at() + 1} / {count()}
              </span>
              <StageButton label={t("Next picture")} disabled={at() >= count() - 1} onClick={() => setShownAt(at() + 1)}>
                <PlaneIcon name="chevron-right" class="size-4" />
              </StageButton>
            </Show>
            <Show when={kind() === "video" && media.latest}>
              <StageButton label={sound() ? t("Mute") : t("Unmute")} pressed={sound()} onClick={toggleSound}>
                <Show when={sound()} fallback={<VolumeXLucide class="size-4" aria-hidden="true" />}>
                  <Volume2Lucide class="size-4" aria-hidden="true" />
                </Show>
              </StageButton>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}

function StageButton(props: { label: string; disabled?: boolean; pressed?: boolean; onClick(): void; children: JSX.Element }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      class="grid size-7 place-items-center rounded-md text-(--plane-text-secondary) outline-none press hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring disabled:pointer-events-none disabled:text-(--plane-text-disabled)"
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

/**
 * The comments: a panel beside the post on a wide screen, with the box kept
 * at its foot; on a phone, the end of the page.
 */
function CommentsPanel(props: {
  previewId: string;
  preview: SharedPreview;
  wide: boolean;
  ownerName: string;
  suggestedName: string;
  onChanged(): Promise<void>;
}) {
  let list: HTMLDivElement | undefined;
  const count = () => props.preview.comments.length;

  const posted = async () => {
    await props.onChanged();
    // The new thread is the last open one, at the foot of the list.
    if (props.wide) requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" }));
  };

  return (
    <section
      aria-label={t("Comments")}
      class={cx("flex flex-col", props.wide ? `${COMMENTS_PANEL} min-h-0` : "border-t border-(--plane-border-subtle) px-5 pt-3 pb-8")}
    >
      <div class={cx("flex h-11 shrink-0 items-center gap-2", props.wide && "px-4")}>
        <h2 class="text-[15px] leading-5 font-medium tracking-[-0.01em] text-(--plane-text-primary)">{t("Comments")}</h2>
        <Show when={count()}>
          <span class="text-xs tabular-nums text-(--plane-text-tertiary)">{count()}</span>
        </Show>
      </div>
      <div ref={list} class={cx(props.wide && "min-h-0 flex-1 overflow-y-auto px-4")}>
        <CommentThreads
          previewId={props.previewId}
          comments={props.preview.comments}
          isOwner={!!props.preview.isOwner}
          ownerName={props.ownerName}
          onChanged={props.onChanged}
          fallback={
            <div class={cx("flex flex-col items-center justify-center gap-2.5 text-center", props.wide ? "h-full pb-12" : "py-8")}>
              <span class="grid size-9 place-items-center rounded-lg border border-(--plane-border-subtle) bg-(--plane-layer-1) text-(--plane-text-tertiary)">
                <MessageSquareLucide class="size-4" aria-hidden="true" />
              </span>
              <p class="text-[13px] leading-5 text-(--plane-text-tertiary)">{t("No comments yet.")}</p>
            </div>
          }
        />
      </div>
      <div class={cx("shrink-0", props.wide ? "p-3" : "pt-3")}>
        <CommentComposer
          previewId={props.previewId}
          ownerName={props.preview.isOwner ? props.ownerName : undefined}
          suggestedName={props.suggestedName}
          onPosted={posted}
        />
      </div>
    </section>
  );
}

function Message(props: { icon: PlaneIconName; title: string; body: string; children?: JSX.Element }) {
  return (
    <div class="m-auto flex max-w-sm flex-col items-center gap-4 px-6 py-24 text-center">
      <span class="grid size-10 place-items-center rounded-lg border border-(--plane-border-subtle) bg-(--plane-layer-1) text-(--plane-text-tertiary)">
        <PlaneIcon name={props.icon} class="size-5" />
      </span>
      <div class="flex flex-col gap-1">
        <h1 class="text-[15px] leading-6 font-medium text-(--plane-text-primary)">{props.title}</h1>
        <p class="text-[13px] leading-5 text-(--plane-text-tertiary)">{props.body}</p>
      </div>
      {props.children}
    </div>
  );
}

/** The panels' shapes while the post loads. */
function Skeleton(props: { wide: boolean }) {
  const bar = "animate-pulse rounded-md bg-(--plane-layer-2)";
  return (
    <>
      <div class={cx("flex flex-col gap-2.5 px-5 py-4", props.wide && DETAILS_PANEL)}>
        <span class={cx(bar, "h-4 w-2/3")} />
        <span class={cx(bar, "h-3 w-5/6")} />
        <span class={cx(bar, "mt-5 h-7 w-full")} />
        <span class={cx(bar, "h-7 w-full")} />
      </div>
      <div class={cx("flex items-center justify-center p-8", props.wide && "flex-1")}>
        <span class={cx(bar, "aspect-[9/19.5] w-[240px] rounded-[30px]")} />
      </div>
      <Show when={props.wide}>
        <div class={cx(COMMENTS_PANEL, "flex flex-col gap-2.5 px-4 py-4")}>
          <span class={cx(bar, "h-4 w-1/3")} />
        </div>
      </Show>
    </>
  );
}
