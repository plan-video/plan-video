/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createResource, createSignal, onCleanup } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { fieldControl } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { ClipsRefused, fetchMomentVideo, scanTwitch, type ScanResult, type ScanStep, type TwitchMoment, type TwitchVideo } from "@/lib/twitch-clips";

/** Simple Icons' Twitch glyph (CC0). */
export function TwitchLogo(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={props.class} aria-hidden="true">
      <path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

// Kept for the session, so picking another clip from the same stream needs no second scan.
const [link, setLink] = createSignal("");
const [result, setResult] = createSignal<ScanResult | null>(null);

const clock = (seconds: number) => {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

function stepText(step: ScanStep | null, video: TwitchVideo | null): string {
  if (!step) return t("Opening the stream…");
  if (step.step === "listening") return video && video.seconds > 3 * 3600 ? t("Listening to the stream and reading chat. Long streams take a few minutes…") : t("Listening to the stream and reading chat…");
  if (step.step === "transcribing") return t("Writing down what was said in the best parts ({done} of {total})…", { done: step.done, total: step.total });
  return t("Picking the best moments…");
}

type Preview = { url: string; offset: number };

/** Plays just the moment, with sound, from a small copy of its stretch. */
function MomentPreview(props: { video: TwitchVideo; moment: TwitchMoment; load(video: TwitchVideo, moment: TwitchMoment): Promise<Preview> }) {
  const [preview] = createResource(() => props.moment, (moment) => props.load(props.video, moment));
  const end = (clip: Preview) => clip.offset + (props.moment.end - props.moment.start);

  return (
    <div class="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black">
      <Switch>
        <Match when={preview.error}>
          <p class="absolute inset-0 grid place-items-center px-4 text-center text-xs text-white/70">
            {preview.error instanceof ClipsRefused ? preview.error.message : t("The preview couldn't be loaded. Try again.")}
          </p>
        </Match>
        <Match when={preview()}>
          {(clip) => (
            <video
              src={clip().url}
              class="size-full"
              controls
              autoplay
              playsinline
              onLoadedMetadata={(event) => (event.currentTarget.currentTime = clip().offset)}
              onPlay={(event) => {
                const player = event.currentTarget;
                if (player.currentTime < clip().offset - 0.5 || player.currentTime >= end(clip()) - 0.05) player.currentTime = clip().offset;
              }}
              onTimeUpdate={(event) => {
                const player = event.currentTarget;
                if (player.currentTime >= end(clip())) {
                  player.pause();
                  player.currentTime = clip().offset;
                }
              }}
            />
          )}
        </Match>
        <Match when={preview.loading}>
          <span class="absolute inset-0 grid place-items-center">
            <Icon name="spinner-loader" class="size-6 animate-spin text-white/70" />
          </span>
        </Match>
      </Switch>
    </div>
  );
}

export function TwitchClipsDialog(props: { onUse(video: TwitchVideo, moment: TwitchMoment): Promise<void>; onClose(): void }) {
  const [scanning, setScanning] = createSignal(false);
  const [video, setVideo] = createSignal<TwitchVideo | null>(null);
  const [step, setStep] = createSignal<ScanStep | null>(null);
  const [error, setError] = createSignal("");
  const [using, setUsing] = createSignal<TwitchMoment | null>(null);
  const [watching, setWatching] = createSignal<TwitchMoment | null>(null);
  let abort: AbortController | null = null;
  // Kept while the dialog is open, so opening a preview again doesn't download it again.
  const previews = new Map<TwitchMoment, Promise<Preview>>();
  const previewAbort = new AbortController();
  onCleanup(() => {
    abort?.abort();
    previewAbort.abort();
    for (const pending of previews.values()) void pending.then((clip) => URL.revokeObjectURL(clip.url), () => {});
  });

  const loadPreview = (video: TwitchVideo, moment: TwitchMoment): Promise<Preview> => {
    let pending = previews.get(moment);
    if (!pending) {
      pending = fetchMomentVideo(video, moment, { preview: true, signal: previewAbort.signal }).then(({ file, offset }) => ({ url: URL.createObjectURL(file), offset }));
      // A failed download is asked again next time.
      pending.catch(() => previews.delete(moment));
      previews.set(moment, pending);
    }
    return pending;
  };

  const find = async () => {
    const pasted = link().trim();
    if (!pasted || scanning()) return;
    abort = new AbortController();
    setScanning(true);
    setError("");
    setResult(null);
    setWatching(null);
    setVideo(null);
    setStep(null);
    try {
      setResult(await scanTwitch(pasted, { onVideo: setVideo, onStep: setStep, signal: abort.signal }));
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof ClipsRefused ? failure.message : t("Finding clips failed. Try again."));
    } finally {
      setScanning(false);
    }
  };

  const stop = () => {
    abort?.abort();
    setScanning(false);
  };

  const use = async (moment: TwitchMoment) => {
    const found = result();
    if (!found || using()) return;
    setUsing(moment);
    setError("");
    try {
      await props.onUse(found.video, moment);
      props.onClose();
    } catch (failure) {
      setError((failure as Error).message || t("That clip couldn't be made. Try again."));
    } finally {
      setUsing(null);
    }
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && !using() && props.onClose()}>
      <DialogPortal>
        <DialogContent showCloseButton={false} class="flex max-h-[85svh] w-[560px] max-w-11/12 flex-col gap-0 overflow-hidden rounded-xl border-border p-0">
          <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border pl-4 pr-1.5">
            <TwitchLogo class="size-4" />
            <p class="min-w-0 flex-1 truncate text-xs text-foreground">{t("Clips from a Twitch stream")}</p>
            <Button size="icon-square" variant="ghost" aria-label={t("Close")} disabled={!!using()} onClick={() => props.onClose()}>
              <Icon name="close-remove" class="text-foreground" />
            </Button>
          </div>

          <form
            class="flex shrink-0 flex-col gap-2 px-4 pt-4 pb-3"
            onSubmit={(event) => {
              event.preventDefault();
              void find();
            }}
          >
            <div class="flex gap-2">
              <input
                class={cx(fieldControl, "min-w-0 flex-1")}
                value={link()}
                onInput={(event) => setLink(event.currentTarget.value)}
                placeholder={t("Paste a link to a past broadcast or a channel")}
                aria-label={t("Twitch link")}
                autofocus
                disabled={scanning()}
                spellcheck={false}
                autocomplete="off"
              />
              <Show when={scanning()} fallback={<Button type="submit" disabled={!link().trim()}>{t("Find clips")}</Button>}>
                <Button type="button" variant="secondary" onClick={stop}>
                  {t("Stop")}
                </Button>
              </Show>
            </div>
            <p class="text-xs text-muted-foreground">{t("plan.video listens for the moments chat and viewers loved, then cuts them for TikTok, Shorts and Reels. Finding them uses about 25 minutes of your monthly captions.")}</p>
          </form>

          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border">
            <Switch>
              <Match when={scanning()}>
                <div class="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
                  <Icon name="spinner-loader" class="size-5 shrink-0 animate-spin" />
                  <span class="min-w-0">
                    <Show when={video()}>{(v) => <span class="block truncate text-foreground">{v().channel} · {v().title}</span>}</Show>
                    {stepText(step(), video())}
                  </span>
                </div>
              </Match>
              <Match when={result()}>
                {(found) => (
                  <>
                    <div class="flex items-baseline gap-2 px-4 pt-3 pb-1">
                      <p class="min-w-0 flex-1 truncate text-xs text-foreground">{found().video.channel} · {found().video.title}</p>
                      <p class="shrink-0 text-xs text-muted-foreground">{t("{count, plural, one {# clip} other {# clips}}", { count: found().moments.length })}</p>
                    </div>
                    <Show when={found().note}>{(note) => <p class="px-4 pb-1 text-xs text-muted-foreground">{t("Only part of the stream was checked: {reason}", { reason: note() })}</p>}</Show>
                    <Show when={found().moments.length} fallback={<p class="px-4 py-6 text-xs text-muted-foreground">{t("No moment in that stream stood on its own. Try another one.")}</p>}>
                      <ul class="flex flex-col py-1">
                        <For each={found().moments}>
                          {(moment) => (
                            <li class="flex flex-col px-4 py-2.5" classList={{ "bg-accent/50": watching() === moment, "hover:bg-accent/50": watching() !== moment }}>
                              <div class="flex items-start gap-3">
                                <span class="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{clock(moment.start)}</span>
                                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span class="text-sm text-foreground">{moment.title}</span>
                                  <span class="text-xs text-muted-foreground">{moment.reason}</span>
                                  <span class="text-xs text-muted-foreground tabular-nums">
                                    {t("{seconds} s · score {score}", { seconds: Math.round(moment.end - moment.start), score: moment.score })}
                                  </span>
                                </div>
                                <Button
                                  variant="secondary"
                                  size="icon-square"
                                  class="shrink-0"
                                  aria-label={watching() === moment ? t("Close preview") : t("Preview")}
                                  aria-pressed={watching() === moment}
                                  onClick={() => setWatching(watching() === moment ? null : moment)}
                                >
                                  <Icon name={watching() === moment ? "close-remove" : "play"} class="size-4" />
                                </Button>
                                <Button variant="secondary" class="shrink-0" disabled={!!using()} onClick={() => void use(moment)}>
                                  <Show when={using() === moment} fallback={t("Use")}>
                                    <Icon name="spinner-loader" class="-ml-0.5 size-4 animate-spin" />
                                    {t("Making…")}
                                  </Show>
                                </Button>
                              </div>
                              <Show when={watching() === moment}>
                                <div class="pl-17">
                                  <MomentPreview video={found().video} moment={moment} load={loadPreview} />
                                </div>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </>
                )}
              </Match>
            </Switch>
            <Show when={error()}>{(text) => <p class="px-4 py-3 text-xs text-destructive" role="alert">{text()}</p>}</Show>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
