/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { toast } from "somoto";

import { LogoMark } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/auth";
import { track } from "@/lib/analytics";
import { addedClip, clipFromMoment, clock, deleteStream, duplicateClip, loadStreams, saveStream, type ClipEdit, type ClipStream } from "@/lib/clip-studio";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import { ClipsRefused, scanStream, type ScanStep, type StreamVideo } from "@/lib/stream-clips";

import { AddClip } from "./add-clip";
import { ClipEditor } from "./clip-editor";
import { ClipList, StoryboardThumb } from "./clip-list";
import { SOURCE_NAMES, sourceUrl } from "./sources";

type Scan = { link: string; video: StreamVideo | null; step: ScanStep | null };

/** The broadcast a link names, as its id here, so a stream already found opens without finding it again. */
function vodOf(link: string): string | null {
  const text = link.trim();
  if (/^\d{6,12}$/.test(text)) return text;
  const twitch = /twitch\.tv\/(?:[^/]+\/v\/|videos\/)(\d{6,12})/i.exec(text)?.[1];
  if (twitch) return twitch;
  const kick = /kick\.com\/(?:video|[^/]+\/videos)\/([0-9a-f-]{36})/i.exec(text)?.[1];
  if (kick) return `kick:${kick.toLowerCase()}`;
  const youtube = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(text)?.[1];
  return youtube ? `yt:${youtube}` : null;
}

const SAVE_AFTER_MS = 400;

export function DashboardClipsView() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const userId = () => auth.user()?.id;
  const [streams, setStreams] = createSignal<ClipStream[]>([]);
  const [open, setOpen] = createStore<{ stream: ClipStream | null }>({ stream: null });
  const [scan, setScan] = createSignal<Scan | null>(null);
  const [error, setError] = createSignal("");
  const [link, setLink] = createSignal("");
  let abort: AbortController | null = null;
  onCleanup(() => abort?.abort());

  createEffect(on(userId, (uid) => void loadStreams(uid).then(setStreams)));

  const vod = () => (typeof params.vod === "string" ? params.vod : undefined);
  createEffect(
    on([vod, () => streams().length], ([id]) => {
      if (!id) {
        if (open.stream) setOpen("stream", null);
        return;
      }
      if (open.stream?.video.id === id) return;
      const found = streams().find((stream) => stream.video.id === id);
      setOpen("stream", found ? structuredClone(found) : null);
    }),
  );

  let saving: ReturnType<typeof setTimeout> | undefined;
  const saveNow = () => {
    clearTimeout(saving);
    saving = undefined;
    const current = open.stream;
    if (!current) return;
    const copy: ClipStream = { ...structuredClone(unwrap(current)), updatedAt: Date.now() };
    void saveStream(userId(), copy).catch((failure: unknown) => console.error("[clips] couldn't save", failure));
    setStreams((list) => [copy, ...list.filter((stream) => stream.video.id !== copy.video.id)]);
  };
  const persist = () => {
    clearTimeout(saving);
    saving = setTimeout(saveNow, SAVE_AFTER_MS);
  };
  onCleanup(() => saving && saveNow());

  const updateClip = (id: string) => (change: (clip: ClipEdit) => void) => {
    setOpen("stream", "clips", (clip) => clip.id === id, produce(change));
    persist();
  };

  const clipId = () => (typeof params.clip === "string" ? params.clip : undefined);
  const selected = createMemo(() => open.stream?.clips.find((clip) => clip.id === clipId()));
  const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
  // On a wide screen a stream opens on its best clip; on a phone it opens on the list.
  createEffect(() => {
    const stream = open.stream;
    if (!stream || selected() || !wide()) return;
    const best = [...stream.clips].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
    if (best) setParams({ clip: best.id }, { replace: true });
  });

  const openStream = (id: string) => setParams({ vod: id, clip: undefined });
  const closeStream = () => setParams({ vod: undefined, clip: undefined });

  async function find(text: string, again = false) {
    const pasted = text.trim();
    if (!pasted || scan()) return;
    const known = vodOf(pasted);
    if (!again && known && streams().some((stream) => stream.video.id === known)) {
      openStream(known);
      return;
    }
    setError("");
    abort = new AbortController();
    setScan({ link: pasted, video: null, step: null });
    try {
      const result = await scanStream(pasted, {
        again,
        signal: abort.signal,
        onVideo: (video) => setScan((now) => now && { ...now, video }),
        onStep: (step) => setScan((now) => now && { ...now, step }),
      });
      const now = Date.now();
      const stream: ClipStream = {
        video: result.video,
        ...(result.note ? { note: result.note } : {}),
        clips: result.moments.map((moment) => clipFromMoment(moment, result.video)),
        createdAt: now,
        updatedAt: now,
      };
      await saveStream(userId(), stream).catch(() => {});
      setStreams((list) => [stream, ...list.filter((entry) => entry.video.id !== stream.video.id)]);
      if (open.stream?.video.id === stream.video.id) setOpen("stream", structuredClone(stream));
      setLink("");
      track("clips_found", { count: stream.clips.length });
      openStream(stream.video.id);
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof ClipsRefused ? failure.message : t("Finding clips failed. Try again."));
    } finally {
      setScan(null);
      abort = null;
    }
  }

  const stop = () => {
    abort?.abort();
    setScan(null);
  };

  const removeStream = (stream: ClipStream) => {
    void deleteStream(userId(), stream.video.id);
    setStreams((list) => list.filter((entry) => entry.video.id !== stream.video.id));
    if (vod() === stream.video.id) closeStream();
    toast(t("Stream removed"), {
      action: {
        label: t("Undo"),
        onClick: () => {
          void saveStream(userId(), stream);
          setStreams((list) => [stream, ...list]);
        },
      },
    });
  };

  const removeClip = (id: string) => {
    const stream = open.stream;
    const clip = stream?.clips.find((entry) => entry.id === id);
    if (!stream || !clip) return;
    const index = stream.clips.indexOf(clip);
    const kept = structuredClone(unwrap(clip));
    setOpen("stream", "clips", (clips) => clips.filter((entry) => entry.id !== id));
    if (clipId() === id) setParams({ clip: undefined }, { replace: true });
    persist();
    toast(t("Clip deleted"), {
      action: {
        label: t("Undo"),
        onClick: () => {
          setOpen("stream", "clips", (clips) => [...clips.slice(0, index), kept, ...clips.slice(index)]);
          persist();
        },
      },
    });
  };

  const duplicate = (id: string) => {
    const clip = open.stream?.clips.find((entry) => entry.id === id);
    if (!clip) return;
    const copy = duplicateClip(unwrap(clip));
    copy.title = t("{title} (copy)", { title: clip.title });
    setOpen("stream", "clips", (clips) => [...clips, copy]);
    persist();
    setParams({ clip: copy.id });
  };

  const addClip = (at: number, length: number) => {
    const stream = open.stream;
    if (!stream) return;
    const clip = addedClip(at, length, stream.video, t("Clip at {time}", { time: clock(at) }));
    setOpen("stream", "clips", (clips) => [...clips, clip]);
    persist();
    setParams({ clip: clip.id });
  };

  const crumbs = () => {
    const stream = open.stream;
    if (!stream) return undefined;
    return [
      { label: "Stream Clipper", icon: "clips" as const, onClick: closeStream },
      { label: `${stream.video.channel} · ${stream.video.title}` },
    ];
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardPageHeader crumbs={crumbs()} noPhoneCrumbs={!!selected()}>
        <Show when={open.stream}>
          {(stream) => (
            <>
              <AddClip video={stream().video} onAdd={addClip} />
              <DropdownMenu placement="bottom-end">
                <DropdownMenuTrigger
                  as="button"
                  type="button"
                  aria-label={t("More")}
                  class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none press hover:bg-accent hover:text-foreground focus-ring"
                >
                  <Icon name="more-three-dots-small-horizontal" class="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent class="w-52">
                    <DropdownMenuItem tone="neutral" onSelect={() => window.open(sourceUrl(stream().video.id, stream().video.source), "_blank", "noopener")}>
                      {t("Watch on {platform}", { platform: SOURCE_NAMES[stream().video.source ?? "twitch"] })}
                    </DropdownMenuItem>
                    <DropdownMenuItem tone="neutral" onSelect={() => void find(stream().video.id, true)}>
                      {t("Find clips again")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => removeStream(unwrap(stream()))}>
                      {t("Remove stream")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            </>
          )}
        </Show>
      </DashboardPageHeader>

      <Switch>
        <Match when={scan()}>{(now) => <Scanning scan={now()} onStop={stop} />}</Match>
        <Match when={open.stream}>
          {(stream) => (
            <div class="flex min-h-0 flex-1 overflow-hidden">
              <aside
                class={cx(
                  "flex w-[300px] shrink-0 flex-col border-r border-(--plane-border-subtle) bg-(--plane-surface-1) max-lg:w-full max-lg:border-r-0",
                  selected() && "max-lg:hidden",
                )}
              >
                <Show when={stream().note}>
                  <p class="border-b border-(--plane-border-subtle) px-3 py-2 text-xs text-muted-foreground">
                    {t("Only part of the stream was checked: {reason}", { reason: stream().note! })}
                  </p>
                </Show>
                <Show
                  when={stream().clips.length}
                  fallback={<p class="px-4 py-8 text-center text-xs text-muted-foreground">{t("No clips here yet. Add one from the button above.")}</p>}
                >
                  <ClipList
                    clips={stream().clips}
                    board={stream().video.storyboard}
                    active={clipId()}
                    onOpen={(id) => setParams({ clip: id })}
                    onDuplicate={duplicate}
                    onDelete={removeClip}
                  />
                </Show>
              </aside>
              <Show
                when={selected()?.id}
                keyed
                fallback={
                  <div class="grid flex-1 place-items-center max-lg:hidden">
                    <p class="text-xs text-muted-foreground">{t("Pick a clip to edit it.")}</p>
                  </div>
                }
              >
                {(id) => (
                  <ClipEditor
                    video={stream().video}
                    clip={stream().clips.find((clip) => clip.id === id)!}
                    update={updateClip(id)}
                    onBack={() => setParams({ clip: undefined })}
                  />
                )}
              </Show>
            </div>
          )}
        </Match>
        <Match when={true}>
          <Start
            link={link()}
            onLink={setLink}
            error={error()}
            streams={streams()}
            onFind={() => void find(link())}
            onOpen={openStream}
            onRemove={removeStream}
          />
        </Match>
      </Switch>
    </div>
  );
}

type Platform = "twitch" | "kick" | "youtube";

const platformOf = (link: string): Platform | null =>
  /kick\.com/i.test(link) ? "kick" : /youtube\.com|youtu\.be/i.test(link) ? "youtube" : /twitch\.tv/i.test(link) ? "twitch" : null;

const MARKS: Record<Platform, { tile: string; ink: string; path: string }> = {
  twitch: { tile: "#9146FF", ink: "#FFFFFF", path: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" },
  kick: { tile: "#0B0E0F", ink: "#53FC18", path: "M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z" },
  youtube: { tile: "#FF0000", ink: "#FFFFFF", path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
};

/** The platform's own mark on its colour, from Simple Icons (CC0). */
function SourceMark(props: { id: Platform; class?: string }) {
  const mark = () => MARKS[props.id];
  return (
    <span class={cx("grid shrink-0 place-items-center rounded-md", props.class)} style={{ background: mark().tile }} aria-hidden="true">
      <svg viewBox="0 0 24 24" class="size-[58%]" fill={mark().ink}>
        <path d={mark().path} />
      </svg>
    </span>
  );
}

const PLATFORMS: { id: Platform; label: string; placeholder: string }[] = [
  { id: "twitch", label: "Twitch", placeholder: msg("Paste a Twitch video or channel link") },
  { id: "kick", label: "Kick", placeholder: msg("Paste a Kick video or channel link") },
  { id: "youtube", label: "YouTube", placeholder: msg("Paste a YouTube video or channel link") },
];

/** A soft dusk light behind the paste box, drawn once. */
const GLOW = [
  "radial-gradient(42% 46% at 58% 28%, rgb(249 115 22 / 0.55), transparent 72%)",
  "radial-gradient(38% 42% at 40% 40%, rgb(239 68 68 / 0.42), transparent 72%)",
  "radial-gradient(46% 44% at 52% 78%, rgb(37 99 235 / 0.55), transparent 72%)",
].join(", ");

function Start(props: {
  link: string;
  onLink(value: string): void;
  error: string;
  streams: ClipStream[];
  onFind(): void;
  onOpen(id: string): void;
  onRemove(stream: ClipStream): void;
}) {
  const [chosen, setChosen] = createSignal<Platform | null>(null);
  let field!: HTMLTextAreaElement;
  const platform = () => platformOf(props.link) ?? chosen();
  const dated = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" }) : "");
  const paste = async () => {
    const text = await navigator.clipboard?.readText?.().catch(() => "");
    if (text?.trim()) props.onLink(text.trim());
    field.focus();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div class="flex w-full flex-col items-center px-8 pt-20 pb-12 max-md:px-4 max-md:pt-10">
        <LogoMark class="size-12 text-foreground max-md:size-9" />
        <h2 class="mt-6 text-center text-[52px] leading-[1.08] font-normal tracking-[-0.035em] text-balance text-foreground max-md:mt-4 max-md:text-[34px]">
          {t("Turn a stream into clips")}
        </h2>

        <div class="mt-8 flex flex-wrap justify-center gap-2 max-md:mt-6" role="radiogroup" aria-label={t("Platform")}>
          <For each={PLATFORMS}>
            {(entry) => (
              <button
                type="button"
                role="radio"
                aria-checked={platform() === entry.id}
                class="flex h-9 items-center gap-2 rounded-xl border pr-3.5 pl-2 text-sm outline-none focus-ring"
                classList={{
                  "border-(--plane-border-strong) bg-(--plane-surface-1) text-foreground": platform() === entry.id,
                  "border-(--plane-border-subtle) bg-(--plane-layer-1) text-muted-foreground hover:text-foreground": platform() !== entry.id,
                }}
                onClick={() => {
                  setChosen(entry.id);
                  field.focus();
                }}
              >
                <SourceMark id={entry.id} class="size-5" />
                {entry.label}
              </button>
            )}
          </For>
        </div>

        <div class="relative isolate mt-5 w-full max-w-[680px]">
          <div class="pointer-events-none absolute -inset-x-[30%] -top-10 -bottom-16 -z-10 opacity-45 blur-2xl dark:opacity-100 max-md:hidden" style={{ background: GLOW }} aria-hidden="true" />
          <form
            class="flex min-h-36 flex-col justify-between gap-4 rounded-2xl border border-(--plane-border-subtle) bg-(--plane-surface-1) p-4 shadow-xs focus-within:border-(--plane-border-strong)"
            onSubmit={(event) => {
              event.preventDefault();
              props.onFind();
            }}
          >
            <textarea
              ref={field}
              rows={2}
              class="w-full resize-none bg-transparent px-1 text-[17px] text-foreground outline-none placeholder:text-(--plane-text-placeholder)"
              value={props.link}
              onInput={(event) => props.onLink(event.currentTarget.value.replace(/\s*\n\s*/g, " "))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (props.link.trim()) props.onFind();
                }
              }}
              placeholder={(() => {
                const entry = PLATFORMS.find((item) => item.id === platform());
                return entry ? t(entry.placeholder) : t("Paste a Twitch, Kick or YouTube link");
              })()}
              aria-label={t("Stream link")}
              spellcheck={false}
              autocomplete="off"
              autofocus
            />
            <div class="flex items-center gap-2">
              <Button type="button" variant="ghost" class="gap-1.5 pl-1.5 text-muted-foreground" onClick={() => void paste()}>
                <Icon name="clipboard" class="size-4" />
                {t("Paste")}
              </Button>
              <span class="flex-1" />
              <span class="text-xs text-muted-foreground max-sm:hidden">{t("Up to 30 clips")}</span>
              <Button type="submit" class="size-9 rounded-full p-0" disabled={!props.link.trim()} aria-label={t("Find clips")} title={t("Find clips")}>
                <Icon name="arrow-top" class="size-4.5" />
              </Button>
            </div>
          </form>
          <div class="mx-4 flex items-center gap-3 rounded-b-xl border border-t-0 border-(--plane-border-subtle) bg-(--plane-layer-1) px-4 py-2.5 text-xs">
            <Show when={props.error} fallback={<span class="text-muted-foreground">{t("Uses about 35 minutes of your monthly captions.")}</span>}>
              <span class="text-destructive" role="alert">
                {props.error}
              </span>
            </Show>
            <span class="ml-auto flex shrink-0 gap-1.5">
              <For each={PLATFORMS}>{(entry) => <SourceMark id={entry.id} class="size-4.5 rounded-[5px]" />}</For>
            </span>
          </div>
        </div>

        <Show when={props.streams.length}>
          <section class="mt-24 flex w-full flex-col gap-4 max-md:mt-14">
            <h3 class="flex items-baseline gap-2 px-0.5 text-base font-medium text-foreground">
              {t("Recent streams")}
              <span class="text-sm font-normal text-muted-foreground tabular-nums">{props.streams.length}</span>
            </h3>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5 max-sm:grid-cols-1">
              <For each={props.streams}>
                {(stream) => (
                  <div class="group relative">
                    <button
                      type="button"
                      class="flex w-full flex-col overflow-hidden rounded-2xl border border-(--plane-border-subtle) bg-(--plane-surface-1) text-left outline-none hover:border-(--plane-border-strong) focus-ring"
                      onClick={() => props.onOpen(stream.video.id)}
                    >
                      <span class="relative block w-full border-b border-(--plane-border-subtle)">
                        <StoryboardThumb board={stream.video.storyboard} seconds={stream.clips[0]?.start ?? 0} still={stream.clips[0]?.thumb} class="w-full rounded-none" />
                        <SourceMark id={stream.video.source ?? "twitch"} class="absolute top-3 left-3 size-7 rounded-lg ring-2 ring-black/20" />
                        <Show when={stream.video.seconds}>
                          <span class="absolute right-3 bottom-3 rounded-md bg-black/65 px-1.5 py-0.5 text-xs text-white tabular-nums">{clock(stream.video.seconds)}</span>
                        </Show>
                      </span>
                      <span class="flex items-center gap-3 px-4 py-3.5">
                        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span class="truncate text-[15px] font-medium text-foreground">{stream.video.title || stream.video.channel}</span>
                          <span class="truncate text-sm text-muted-foreground">{[stream.video.channel, dated(stream.video.createdAt)].filter(Boolean).join(", ")}</span>
                        </span>
                        <span class="shrink-0 rounded-full bg-(--plane-layer-2) px-2.5 py-1 text-xs text-foreground tabular-nums">
                          {t("{count, plural, one {# clip} other {# clips}}", { count: stream.clips.length })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t("Remove stream")}
                      class="absolute top-3 right-3 grid size-7 place-items-center rounded-md bg-black/65 text-white opacity-0 outline-none group-hover:opacity-100 hover:bg-black/80 focus-ring focus-visible:opacity-100 max-md:opacity-100"
                      onClick={() => props.onRemove(stream)}
                    >
                      <Icon name="trash" class="size-4" />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </div>
    </div>
  );
}

const STEPS = [
  { id: "open", label: msg("Opening the stream") },
  { id: "listening", label: msg("Listening to it and reading chat") },
  { id: "transcribing", label: msg("Writing down what was said in the best parts") },
  { id: "picking", label: msg("Picking the best moments") },
] as const;

function Scanning(props: { scan: Scan; onStop(): void }) {
  const current = () => {
    const step = props.scan.step?.step;
    return step === "listening" ? 1 : step === "transcribing" ? 2 : step === "picking" ? 3 : 0;
  };
  const counted = () => {
    const step = props.scan.step;
    return step?.step === "transcribing" && step.total ? ` (${step.done}/${step.total})` : "";
  };
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-14 pb-16 max-md:pt-8">
      <div class="flex w-full max-w-[440px] flex-col gap-4 rounded-xl border border-(--plane-border-subtle) bg-(--plane-surface-1) p-4">
        <div class="flex items-center gap-3">
          <StoryboardThumb board={props.scan.video?.storyboard} seconds={0} class="w-20" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-sm text-foreground">{props.scan.video?.title || t("Finding clips…")}</span>
            <span class="truncate text-xs text-muted-foreground">
              {props.scan.video ? `${props.scan.video.channel} · ${clock(props.scan.video.seconds)}` : props.scan.link}
            </span>
          </div>
        </div>
        <ol class="flex flex-col gap-2.5">
          <For each={STEPS}>
            {(step, index) => (
              <li class="flex items-center gap-2.5 text-xs">
                <span class="grid size-5 shrink-0 place-items-center">
                  <Switch>
                    <Match when={index() < current()}>
                      <Icon name="circle-check" class="size-4.5 text-primary" />
                    </Match>
                    <Match when={index() === current()}>
                      <Icon name="spinner-loader" class="size-5 animate-spin text-foreground" />
                    </Match>
                    <Match when={true}>
                      <span class="size-1.5 rounded-full bg-(--plane-text-placeholder)" />
                    </Match>
                  </Switch>
                </span>
                <span class={index() <= current() ? "text-foreground" : "text-muted-foreground"}>
                  {t(step.label)}
                  {index() === 2 && index() === current() ? counted() : ""}
                </span>
              </li>
            )}
          </For>
        </ol>
        <p class="text-xs text-muted-foreground">{t("A 2-hour stream takes about a minute. Keep this page open until it’s done.")}</p>
        <Button variant="secondary" class="self-start" onClick={props.onStop}>
          {t("Stop")}
        </Button>
      </div>
    </div>
  );
}
