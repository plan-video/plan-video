/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { toast } from "somoto";

import { ClipsArt } from "@/components/dashboard/empty-art";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { fieldControl } from "@/components/publish/controls";
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
import { SOURCE_NAMES, SourceLogo, sourceUrl } from "./source-logo";

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

function Start(props: {
  link: string;
  onLink(value: string): void;
  error: string;
  streams: ClipStream[];
  onFind(): void;
  onOpen(id: string): void;
  onRemove(stream: ClipStream): void;
}) {
  const dated = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(intlLocale(), { day: "numeric", month: "short", year: "numeric" }) : "");
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-14 pb-16 max-md:pt-8">
      <div class="flex w-full max-w-[560px] flex-col items-center gap-4 text-center">
        <ClipsArt />
        <div class="flex flex-col gap-1">
          <h2 class="text-sm font-medium text-foreground">{t("Clips from a stream")}</h2>
          <p class="max-w-sm text-xs text-balance text-muted-foreground">
            {t("Paste a link to a past stream on Twitch, Kick or YouTube. plan.video finds up to 30 moments worth posting, and you finish each one here.")}
          </p>
        </div>
        <form
          class="flex w-full gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            props.onFind();
          }}
        >
          <div class="relative min-w-0 flex-1">
            <PlaneIcon name="link" class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--plane-text-placeholder)" />
            <input
              class={cx(fieldControl, "h-9 w-full pl-8")}
              value={props.link}
              onInput={(event) => props.onLink(event.currentTarget.value)}
              placeholder={t("A stream's link, or a channel's for its latest")}
              aria-label={t("Stream link")}
              spellcheck={false}
              autocomplete="off"
              autofocus
            />
          </div>
          <Button type="submit" class="h-9 px-3" disabled={!props.link.trim()}>
            {t("Find clips")}
          </Button>
        </form>
        <Show when={props.error}>
          <p class="text-xs text-destructive" role="alert">
            {props.error}
          </p>
        </Show>
        <div class="flex items-center gap-3" aria-label={t("Works with Twitch, Kick and YouTube")}>
          <SourceLogo source="twitch" />
          <SourceLogo source="kick" />
          <SourceLogo source="youtube" />
        </div>
        <p class="text-xs text-muted-foreground">{t("Finding them uses about 35 minutes of your monthly captions, however long the stream.")}</p>
      </div>

      <Show when={props.streams.length}>
        <section class="mt-10 flex w-full max-w-[560px] flex-col gap-2">
          <h3 class="px-1 text-xs font-medium text-muted-foreground">{t("Recent streams")}</h3>
          <ul class="flex flex-col divide-y divide-(--plane-border-subtle) overflow-hidden rounded-lg border border-(--plane-border-subtle) bg-(--plane-surface-1)">
            <For each={props.streams}>
              {(stream) => (
                <li class="group relative">
                  <button type="button" class="flex w-full items-center gap-3 p-2 pr-10 text-left outline-none press hover:bg-(--plane-layer-1) focus-ring" onClick={() => props.onOpen(stream.video.id)}>
                    <StoryboardThumb board={stream.video.storyboard} seconds={stream.clips[0]?.start ?? 0} still={stream.clips[0]?.thumb} class="w-20" />
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="flex items-center gap-1.5">
                        <SourceLogo source={stream.video.source} class="scale-75" />
                        <span class="truncate text-sm text-foreground">{stream.video.title || stream.video.channel}</span>
                      </span>
                      <span class="truncate text-xs text-muted-foreground">
                        {[stream.video.channel, dated(stream.video.createdAt), t("{count, plural, one {# clip} other {# clips}}", { count: stream.clips.length })].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <PlaneIcon name="chevron-right" class="size-4 text-(--plane-text-placeholder)" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("Remove stream")}
                    class="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 outline-none press group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-ring focus-visible:opacity-100 max-md:opacity-100"
                    onClick={() => props.onRemove(stream)}
                  >
                    <Icon name="trash" class="size-4" />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
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
