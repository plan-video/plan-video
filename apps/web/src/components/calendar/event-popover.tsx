/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate, useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, children, createEffect, createSignal, on, onCleanup, type JSX, type ParentProps } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { PlatformLogo } from "@/components/publish/controls";
import { DatePicker } from "@/components/publish/date-time-picker";
import { YOUTUBE_PRIVATE, deliveryRows, latestRun, type DeliveryRow } from "@/components/publish/deliveries";
import { usePostActions } from "@/components/publish/post-actions";
import { useProjectName } from "@/components/publish/project-picker";
import { canPublish, deliveriesOf, heldBack, isGoingOut, overPlan, retryLabel } from "@/components/publish/publisher";
import { formatWhen } from "@/components/publish/save";
import { threadStatus, watchThread, type ThreadStatus } from "@/components/publish/thread-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/auth";
import { projectRoute, useReturnHere } from "@/hooks/use-project-route";
import { t } from "@/lib/i18n";
import { previewOf } from "@/lib/post-previews";
import { PUBLISHING_PLATFORMS, type PlatformId } from "@/lib/social";
import { accountLabel, accountsFor, loadSocialConnections, readChoices, type SocialConnection } from "@/lib/social-connections";
import { mediaKind } from "@/lib/social-media";
import { REPLY_DELAYS } from "@/lib/thread";
import { EventFields } from "./event-fields";
import { STATUS_DOT, statusOf } from "./post-hover-card";
import { CalendarPopup, fieldControlBase, fieldLabel, popupFooter, popupHeader } from "./popup";
import { SharePanel } from "./share-panel";
import {
  allPosts,
  deleteEvent,
  ownCaptions,
  postFileIds,
  postFiles,
  restoreEvent,
  setEventStatus,
  setSeriesEnd,
  setSeriesPaused,
  timeHasPassed,
  updateEvent,
} from "./store";
import { cn, displayLink, durationLabel, formatDay, platformName, recurrenceLabel, runsUntil, shiftDay } from "./utils";
import type { CalendarEvent, EventDraft, PostStatus, SelectedEvent, StoredEvent } from "./types";

type Mode = "details" | "edit" | "delete" | "end" | "share";

const STATUS_TEXT: Record<string, string> = { failed: "text-destructive", held: "text-meter-yellow", paused: "text-meter-yellow" };

export function EventPopover(props: { onClose(): void; selected: SelectedEvent }) {
  const event = () => props.selected.event;
  const [mode, setMode] = createSignal<Mode>("details");
  const actions = usePostActions();
  const [params] = useSearchParams();
  const stored = () => allPosts().find((post) => post.id === event().sourceId);
  const posted = () => event().status === "posted";
  const status = () => statusOf(event());
  /** A post only marked as posted didn't go out through plan.video. */
  const sentAnywhere = () => {
    const post = stored();
    return !!post && deliveriesOf(post).some(({ delivery }) => delivery.state === "sent");
  };
  const failure = () => {
    const post = stored();
    return event().delivery === "failed" && post ? deliveriesOf(post).find(({ delivery }) => delivery.state === "failed")?.delivery : undefined;
  };
  const platformNames = () => event().platforms.map(platformName).join(", ");
  const onGrid = () => params.dashboard === "calendar" && params.view !== "list";

  const remove = (scope: "occurrence" | "series") => {
    const post = stored();
    const failed = deleteEvent({ day: event().day, scope, sourceId: event().sourceId });
    if (failed) {
      toast.error(t(failed));
      return;
    }
    if (scope === "occurrence") {
      toast.success(t("Skipped {date}. The rest still go out.", { date: formatDay(event().day) }));
    } else {
      const undo = post ? { action: { label: t("Undo"), onClick: () => restoreEvent(post) } } : {};
      if (posted()) {
        toast.success(t("Removed from your calendar"), {
          description: platformNames() ? t("It stays up on {platforms}.", { platforms: platformNames() }) : t("It stays up on the platform."),
          ...undo,
        });
      } else toast(t("Post deleted"), { description: post?.title, ...undo });
    }
    props.onClose();
  };

  const edit = () => {
    const post = stored();
    if (!post) return;
    actions.edit(post, true);
    props.onClose();
  };

  const postAgain = () => {
    const post = stored();
    if (!post) return;
    actions.edit(post, false);
    props.onClose();
  };

  const changeStatus = (next: PostStatus) => {
    const post = stored();
    if (!post) return;
    // Its time gone by, a post scheduled as it is would only sit past due.
    if (next === "scheduled" && timeHasPassed(post)) {
      toast.error(t("Its time has passed"), { description: t("Pick a new time to schedule it."), action: { label: t("Pick a time"), onClick: () => actions.edit(post, true) } });
      return;
    }
    const failed = setEventStatus(post.id, next);
    if (failed) {
      toast.error(t(failed));
      return;
    }
    const message = { posted: t("Marked as posted"), scheduled: t("Marked as scheduled"), draft: t("Moved to drafts") }[next];
    toast.success(message, {
      description: post.title,
      action: {
        label: t("Undo"),
        onClick: () => {
          const back = setEventStatus(post.id, post.status);
          if (back) toast.error(t(back));
        },
      },
    });
    props.onClose();
  };

  const copyCaption = async () => {
    const text = stored()?.description?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Caption copied"));
    } catch {
      toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
    }
  };

  const sendable = () => {
    const post = stored();
    if (!post || post.recurrence || post.status === "posted" || failure() || isGoingOut(post)) return false;
    return canPublish(post) && !sentAnywhere();
  };

  const send = () => {
    const post = stored();
    if (post) void actions.send(post);
    props.onClose();
  };

  const togglePause = () => {
    const { sourceId, paused } = event();
    const failed = setSeriesPaused(sourceId, !paused);
    if (failed) {
      toast.error(t(failed));
      return;
    }
    toast.success(paused ? t("Series resumed") : t("Series paused"), {
      description: paused ? t("Its runs go out again.") : t("Its runs stay on the calendar and go out nowhere until you resume it."),
      action: { label: t("Undo"), onClick: () => setSeriesPaused(sourceId, paused) },
    });
    props.onClose();
  };

  const end = (day: string | null) => {
    const { sourceId, recurrenceEnd: before } = event();
    const failed = setSeriesEnd(sourceId, day);
    if (failed) {
      toast.error(t(failed));
      return;
    }
    toast.success(day ? t("Series ends {date}", { date: formatDay(day) }) : t("Series keeps going"), {
      description: day ? t("Nothing after that day goes out.") : t("It repeats with no end date."),
      action: { label: t("Undo"), onClick: () => setSeriesEnd(sourceId, before) },
    });
    props.onClose();
  };

  return (
    <CalendarPopup
      anchor={props.selected.anchor}
      label={event().title}
      placement="right-start"
      onClose={props.onClose}
      class="w-[min(26rem,calc(100vw-2rem))]"
    >
      <div class={popupHeader}>
        <div class="min-w-0 flex-1 py-0.5">
          <h2 class="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground">{event().title}</h2>
          <p class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>
              {formatDay(event().day)}
              {event().allDay ? ` · ${t("No set time")}` : ` · ${event().start}`}
            </span>
            <span aria-hidden="true">·</span>
            <span class={cn("flex items-center gap-1.5", STATUS_TEXT[status().tone])}>
              <span class={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status().tone])} />
              {status().label}
            </span>
          </p>
        </div>
        <div class="-mr-1.5 flex shrink-0 items-center">
          <Show when={mode() === "details" && stored()}>
            {(post) => (
              <DropdownMenu placement="bottom-end">
                <DropdownMenuTrigger as="button" type="button" aria-label={t("More")} class={buttonVariants({ variant: "ghost", size: "icon-square" })}>
                  <Icon name="more-three-dots-small-horizontal" class="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  {/* Kept open by the popup: a click in the menu lands outside its panel. */}
                  <DropdownMenuContent class="w-44" data-calendar-keep-popup>
                    <Show when={!posted()}>
                      <DropdownMenuItem tone="neutral" onSelect={() => setMode("edit")}>
                        {t("Quick edit")}
                      </DropdownMenuItem>
                    </Show>
                    <Show when={post().description?.trim()}>
                      <DropdownMenuItem tone="neutral" onSelect={() => void copyCaption()}>
                        {t("Copy caption")}
                      </DropdownMenuItem>
                    </Show>
                    <Show when={!onGrid()}>
                      <DropdownMenuItem
                        tone="neutral"
                        onSelect={() => {
                          actions.openCalendar(post());
                          props.onClose();
                        }}
                      >
                        {t("Show on calendar")}
                      </DropdownMenuItem>
                    </Show>
                    <Show when={!posted() || !sentAnywhere()}>
                      <DropdownMenuSeparator />
                    </Show>
                    <Show when={!posted()}>
                      <DropdownMenuItem tone="neutral" onSelect={() => changeStatus("posted")}>
                        {t("Mark as posted")}
                      </DropdownMenuItem>
                    </Show>
                    <Show when={event().status === "draft"}>
                      <DropdownMenuItem tone="neutral" onSelect={() => changeStatus("scheduled")}>
                        {t("Mark as scheduled")}
                      </DropdownMenuItem>
                    </Show>
                    {/* A post that went out stays as the record of it; one only marked as posted can go back. */}
                    <Show when={event().status === "scheduled" || (posted() && !sentAnywhere())}>
                      <DropdownMenuItem tone="neutral" onSelect={() => changeStatus("draft")}>
                        {t("Move to drafts")}
                      </DropdownMenuItem>
                    </Show>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            )}
          </Show>
          <Button variant="ghost" size="icon-square" aria-label={t("Close")} onClick={props.onClose}>
            <Icon name="close-remove" class="size-6" />
          </Button>
        </div>
      </div>
      <Switch>
        <Match when={mode() === "details"}>
          <EventDetails event={event()} post={stored()} onTogglePause={togglePause} onEnd={() => setMode("end")} />
          <div class={popupFooter}>
            <Button
              variant="ghost"
              class="mr-auto gap-1 pl-0.5 text-destructive hover:bg-destructive/10"
              onClick={() => (event().recurring ? setMode("delete") : remove("series"))}
            >
              <Icon name="trash" class="size-6" />
              {posted() ? t("Remove") : t("Delete")}
            </Button>
            <Show when={stored()}>
              <Button variant="ghost" class="gap-1 pl-1" onClick={() => setMode("share")}>
                <Icon name="link" class="size-5" />
                {t("Share")}
                <Show when={previewOf(event().sourceId)?.comments}>
                  {(count) => <span class="rounded-md bg-primary/15 px-1 text-xxs leading-4 text-primary tabular-nums">{count()}</span>}
                </Show>
              </Button>
            </Show>
            <Show when={failure() && overPlan(failure()!)}>
              <Button
                variant="secondary"
                onClick={() => {
                  actions.upgrade();
                  props.onClose();
                }}
              >
                {t("Upgrade")}
              </Button>
            </Show>
            <Show
              when={posted()}
              fallback={
                <Button variant="secondary" onClick={edit}>
                  {t("Edit")}
                </Button>
              }
            >
              <Button variant="secondary" onClick={postAgain}>
                {t("Post again")}
              </Button>
            </Show>
            <Show when={failure()}>{(delivery) => <Button onClick={send}>{retryLabel(delivery())}</Button>}</Show>
            <Show when={sendable()}>
              <Button onClick={send}>{t("Post now")}</Button>
            </Show>
          </div>
        </Match>
        <Match when={mode() === "edit"}>
          <EventEditForm event={event()} onCancel={() => setMode("details")} onSaved={props.onClose} />
        </Match>
        <Match when={mode() === "delete"}>
          <div class="space-y-3 p-3.5">
            <div>
              <p class="text-sm font-medium text-foreground">{t("Delete repeating post?")}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {t("Skip this one and keep the rest, or delete every post in the series.")}
              </p>
            </div>
            <div class="rounded-md border border-border-strong bg-input px-3 py-2">
              <p class="text-xs text-foreground">{formatDay(event().day)}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {event().allDay ? t("No set time") : `${event().start} · ${durationLabel(event().duration)}`}
                {` · ${event().title}`}
              </p>
            </div>
          </div>
          <div class={popupFooter}>
            <Button variant="ghost" class="mr-auto" onClick={() => setMode("details")}>
              {t("Cancel")}
            </Button>
            <Button variant="secondary" onClick={() => remove("occurrence")}>
              {t("Skip this one")}
            </Button>
            <Button variant="destructive" onClick={() => remove("series")}>
              {t("All posts")}
            </Button>
          </div>
        </Match>
        <Match when={mode() === "end"}>
          <EndSeriesForm event={event()} onCancel={() => setMode("details")} onEnd={end} />
        </Match>
        <Match when={mode() === "share" && stored()}>
          {(post) => <SharePanel post={post()} onBack={() => setMode("details")} />}
        </Match>
      </Switch>
    </CalendarPopup>
  );
}

function DetailRow(props: ParentProps<{ icon?: string; leading?: JSX.Element }>) {
  const leading = children(() => props.leading);
  return (
    <>
      <span class="grid h-5 place-items-center">
        <Show
          when={leading()}
          fallback={<Icon name={props.icon!} class="size-5 text-muted-foreground" />}
        >
          {leading()}
        </Show>
      </span>
      <div class="min-w-0 leading-5">{props.children}</div>
    </>
  );
}

const seriesAction =
  "flex h-6 items-center gap-0.5 rounded-md border border-(--border-input) pl-0.5 pr-2 text-xs text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring";

function EventDetails(props: { event: CalendarEvent; post?: StoredEvent; onTogglePause(): void; onEnd(): void }) {
  const auth = useAuth();
  createEffect(() => loadSocialConnections(auth.user()?.id));
  const held = () => (props.event.delivery ? null : heldBack({ id: props.event.sourceId, status: props.event.status }));
  const own = () => (props.post ? Object.entries(ownCaptions(props.post)) : []);
  const titles = () => {
    const post = props.post;
    if (!post) return [];
    const shared = post.title.trim();
    const list: { platform: string; title: string }[] = [];
    const youtube = post.youtube?.title.trim();
    if (post.platforms.includes("youtube") && youtube && youtube !== shared) list.push({ platform: "youtube", title: youtube });
    const pinterest = post.pinterest?.title.trim();
    if (post.platforms.includes("pinterest") && pinterest && pinterest !== shared) list.push({ platform: "pinterest", title: pinterest });
    return list;
  };
  const hasRows = () =>
    props.event.platforms.length > 0 || props.event.recurring || !!props.post?.thread?.length || !!props.event.link || !!props.event.projectId;

  return (
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div class="flex flex-col gap-3 p-3.5">
        <Show when={props.post}>{(post) => <PostMedia post={post()} />}</Show>
        <Show when={props.event.delivery === "sending" && props.event.waiting}>
          {(waiting) => <p class="text-xs leading-4 text-meter-yellow">{t("{label}. {detail}", { label: t("Waiting"), detail: t(waiting()) })}</p>}
        </Show>
        <Show when={held()}>
          {(state) => <p class="text-xs leading-4 text-meter-yellow">{t("{label}. {detail}", { label: state().label, detail: state().detail })}</p>}
        </Show>
        <For each={titles()}>
          {(item) => (
            <div class="flex flex-col gap-1">
              <p class="text-xs text-muted-foreground">{t("Title on {network}", { network: platformName(item.platform) })}</p>
              <p class="break-words text-[13px] font-medium leading-5 text-foreground select-text">{item.title}</p>
            </div>
          )}
        </For>
        <CaptionBlock text={props.event.description} />
        <For each={own()}>{([platform, words]) => <CaptionBlock label={t("Caption for {network}", { network: platformName(platform) })} text={words} />}</For>
        <Show when={hasRows()}>
          <div class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-2.5 border-t border-border-strong pt-3 text-xs">
            <Show when={props.post}>{(post) => <AccountRows post={post()} />}</Show>
            <Show when={props.event.recurring}>
              <DetailRow icon={props.event.paused ? "pause" : "loop"}>
                <p class="text-foreground">
                  {recurrenceLabel(props.event.recurrence, props.event.firstDay, props.event.recurrenceEnd) ?? t("Repeating post")}
                </p>
                <Show when={props.event.paused}>
                  <p class="text-meter-yellow">{t("Paused. No run goes out until you resume it.")}</p>
                </Show>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <button type="button" class={seriesAction} onClick={() => props.onTogglePause()}>
                    <Icon name={props.event.paused ? "play" : "pause"} class="size-5" />
                    <span class="cap-centered">{props.event.paused ? t("Resume series") : t("Pause series")}</span>
                  </button>
                  <button type="button" class={seriesAction} onClick={() => props.onEnd()}>
                    <Icon name="no-loop" class="size-5" />
                    <span class="cap-centered">{props.event.recurrenceEnd ? t("Change end") : t("End series")}</span>
                  </button>
                </div>
              </DetailRow>
            </Show>
            <Show when={props.post?.thread?.length ? props.post : undefined}>{(post) => <ThreadRow post={post()} />}</Show>
            <Show when={props.event.link}>
              {(link) => (
                <DetailRow icon="link">
                  <a class="break-all rounded-sm text-primary outline-none hover:underline focus-ring" href={link()} target="_blank" rel="noopener noreferrer">
                    {displayLink(link())}
                  </a>
                </DetailRow>
              )}
            </Show>
            <Show when={props.event.projectId}>{(key) => <ProjectDetail projectKey={key()} />}</Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

type Loaded = { kind: "video" | "image"; url: string };

function PostMedia(props: { post: StoredEvent }) {
  let urls: string[] = [];
  let gone = false;
  const release = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  };
  // A signal rather than a resource: reading a resource while it loads suspends,
  // and the dashboard's Suspense boundary would swap the calendar for its skeleton.
  const [shown, setShown] = createSignal<Loaded[]>([]);
  let asked = 0;
  createEffect(
    on(
      () => postFileIds(props.post).join("|"),
      () => {
        const ask = ++asked;
        void postFiles(props.post)
          .catch(() => [] as File[])
          .then((found) => {
            if (gone || ask !== asked) return;
            release();
            const list = found.flatMap((file): Loaded[] => {
              const kind = mediaKind(file);
              return kind ? [{ kind, url: URL.createObjectURL(file) }] : [];
            });
            urls = list.map((item) => item.url);
            setShown(list);
          });
      },
    ),
  );
  onCleanup(() => {
    gone = true;
    release();
  });

  return (
    <Switch>
      <Match when={shown()[0]?.kind === "video" && shown()[0]}>
        {(item) => (
          <Well>
            <VideoView src={item().url} poster={props.post.thumbnail} coverTime={props.post.coverTime} />
          </Well>
        )}
      </Match>
      <Match when={shown().length > 1}>
        <div class="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-0.5 [scrollbar-width:thin]">
          <For each={shown()}>{(item) => <img src={item.url} alt="" draggable={false} class="h-44 w-auto shrink-0 rounded-lg object-cover" />}</For>
        </div>
      </Match>
      <Match when={shown()[0]}>
        {(item) => (
          <Well>
            <img src={item().url} alt="" draggable={false} class="max-h-56 max-w-full object-contain" />
          </Well>
        )}
      </Match>
      <Match when={props.post.thumbnail}>
        {(src) => (
          <Well>
            <img src={src()} alt="" draggable={false} class="max-h-56 max-w-full object-contain" />
          </Well>
        )}
      </Match>
    </Switch>
  );
}

function Well(props: ParentProps) {
  return <div class="flex justify-center overflow-hidden rounded-lg bg-input">{props.children}</div>;
}

/** The post's small picture stands in until the video's frame at the cover is decoded. */
function VideoView(props: { src: string; poster?: string; coverTime?: number | null }) {
  let video!: HTMLVideoElement;
  const [started, setStarted] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [decoded, setDecoded] = createSignal(false);
  const play = () => {
    setStarted(true);
    void video.play().catch(() => setPlaying(false));
  };
  return (
    // Its own pointer events: scrubbing the video mustn't drag the popup along.
    <div class="relative flex max-w-full justify-center" onPointerDown={(event) => event.stopPropagation()}>
      <video
        ref={video}
        src={props.src}
        poster={decoded() ? undefined : props.poster}
        preload="metadata"
        playsinline
        controls={started()}
        class="max-h-56 max-w-full object-contain"
        onLoadedMetadata={() => {
          video.currentTime = typeof props.coverTime === "number" ? props.coverTime : 0.01;
        }}
        onSeeked={() => setDecoded(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <Show when={!playing() && !started()}>
        <button type="button" aria-label={t("Play")} class="absolute inset-0 grid place-items-center rounded-lg outline-none focus-ring" onClick={play}>
          <span class="grid size-11 place-items-center rounded-full bg-black/55 text-white">
            <svg viewBox="0 0 24 24" class="size-5 translate-x-px" fill="currentColor" aria-hidden="true">
              <path d="M7 6.25 17 12 7 17.75Z" />
            </svg>
          </span>
        </button>
      </Show>
    </div>
  );
}

function RichCaption(props: { text: string }) {
  const parts = () => props.text.split(/([#@][\p{L}\p{N}_.]+)/u);
  return <For each={parts()}>{(part) => (/^[#@][\p{L}\p{N}_]/u.test(part) ? <span class="text-primary">{part}</span> : part)}</For>;
}

function CaptionBlock(props: { text: string | null | undefined; label?: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [clipped, setClipped] = createSignal(false);
  let box: HTMLParagraphElement | undefined;
  createEffect(
    on(
      () => [props.text, expanded()],
      () => {
        requestAnimationFrame(() => {
          if (box) setClipped(!expanded() && box.scrollHeight > box.clientHeight + 1);
        });
      },
    ),
  );
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.label}>{(label) => <p class="text-xs text-muted-foreground">{label()}</p>}</Show>
      <Show when={props.text?.trim()} fallback={<p class="text-xs text-muted-foreground">{t("No caption")}</p>}>
        {(text) => (
          <p ref={box} class={cn("whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground select-text", !expanded() && "line-clamp-6")}>
            <RichCaption text={text()} />
          </p>
        )}
      </Show>
      <Show when={clipped() || expanded()}>
        <button
          type="button"
          class="self-start rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-ring"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded() ? t("Show less") : t("Show more")}
        </button>
      </Show>
    </div>
  );
}

type AccountRowInfo = { key: string; platform: string; account?: SocialConnection; publishes: boolean };

function accountRowsOf(post: StoredEvent): AccountRowInfo[] {
  return post.platforms.flatMap((platform) => {
    const picked = accountsFor(platform, post.accounts);
    const publishes = PUBLISHING_PLATFORMS.includes(platform);
    return picked.length ? picked.map((account) => ({ key: account.id, platform, account, publishes })) : [{ key: platform, platform, publishes }];
  });
}

type Outcome = {
  tone: "sent" | "inbox" | "sending" | "waiting" | "failed";
  label: string;
  detail?: string;
  url?: string;
};

const OUTCOME_TEXT: Record<Outcome["tone"], string> = {
  sent: "text-muted-foreground",
  inbox: "text-foreground",
  sending: "text-primary",
  waiting: "text-meter-yellow",
  failed: "text-destructive",
};

function liveLink(platform: string, id: string | null | undefined) {
  if (!id) return undefined;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (platform === "x") return `https://x.com/i/status/${encodeURIComponent(id)}`;
  return undefined;
}

function outcomeOf(post: StoredEvent, row: AccountRowInfo, run: DeliveryRow[]): Outcome | undefined {
  const sent = (platform: string, url: string | undefined, note: string | null | undefined): Outcome => {
    if (platform === "tiktok" && note === "inbox") return { tone: "inbox", label: t("In inbox"), detail: t("Open the notification in TikTok to finish it"), url };
    if (platform === "youtube" && note === "private") return { tone: "sent", label: t("Private on YouTube"), detail: t(YOUTUBE_PRIVATE), url };
    return { tone: "sent", label: t("Posted"), url };
  };
  const mine = run
    .filter((item) => item.platform === row.platform && (row.account ? item.connection_id === row.account.id : item.connection_id === "none"))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (mine) {
    if (mine.state === "sent") return sent(row.platform, mine.url ?? liveLink(row.platform, mine.publish_id), mine.error);
    if (mine.state === "failed") return { tone: "failed", label: t("Didn't go out"), detail: t(mine.error ?? "It didn't go out.") };
    if (mine.state === "queued" && mine.error) return { tone: "waiting", label: t("Waiting"), detail: t(mine.error) };
    return { tone: "sending", label: t("Sending") };
  }
  const kept = post.deliveries?.[row.platform];
  if (!kept) return undefined;
  if (kept.state === "sent") return sent(row.platform, liveLink(row.platform, kept.publishId), row.platform === "tiktok" && post.tiktok?.inbox ? "inbox" : kept.note);
  if (kept.state === "failed") return { tone: "failed", label: t("Didn't go out"), detail: t(kept.error ?? "It didn't go out.") };
  if (kept.waiting) return { tone: "waiting", label: t("Waiting"), detail: t(kept.waiting) };
  return { tone: "sending", label: t("Sending") };
}

function AccountRows(props: { post: StoredEvent }) {
  const run = () => latestRun(deliveryRows(props.post.id));
  return (
    <For each={accountRowsOf(props.post)}>
      {(row) => {
        const outcome = () => outcomeOf(props.post, row, run());
        const name = () => (row.account && accountLabel(row.account)) || platformName(row.platform);
        return (
          <DetailRow leading={row.account ? <AccountAvatar account={row.account} class="size-5" /> : <PlatformLogo id={row.platform as PlatformId} class="rounded-md" />}>
            <div class="flex min-w-0 items-center justify-between gap-3">
              <p class="min-w-0 truncate text-foreground" title={row.account ? platformName(row.platform) : undefined}>
                {name()}
              </p>
              <Switch>
                <Match when={outcome()}>
                  {(state) => (
                    <span class="flex shrink-0 items-center gap-2">
                      <span class={cn("flex items-center gap-1", OUTCOME_TEXT[state().tone])}>
                        <Show when={state().tone === "sending"}>
                          <Icon name="spinner-loader" class="-ml-1 size-4 animate-spin" />
                        </Show>
                        {state().label}
                      </span>
                      <Show when={state().url}>
                        {(url) => (
                          <a
                            href={url()}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t("Open on {network}", { network: platformName(row.platform) })}
                            class="flex items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-ring"
                          >
                            {t("Open")}
                            <Icon name="external-link" class="size-4" />
                          </a>
                        )}
                      </Show>
                    </span>
                  )}
                </Match>
                <Match when={!row.account && row.publishes}>
                  <span class="shrink-0 text-meter-yellow">{t("No account picked")}</span>
                </Match>
              </Switch>
            </div>
            <Show when={outcome()?.detail}>{(detail) => <p class="mt-0.5 text-muted-foreground">{detail()}</p>}</Show>
          </DetailRow>
        );
      }}
    </For>
  );
}

function threadLine(status: ThreadStatus): string {
  if (status.state === "failed") return `${t("Follow-up {number} didn't go out on {network}.", { number: status.step, network: status.network })} ${t(status.error)}`.trim();
  if (status.state === "waiting") return t("Thread · next follow-up {when}", { when: formatWhen(status.at) });
  return t("{count, plural, one {Thread · # follow-up sent} other {Thread · # follow-ups sent}}", { count: status.count });
}

function delayLabel(minutes: number) {
  const option = REPLY_DELAYS.find((item) => item.minutes === minutes) ?? REPLY_DELAYS[0]!;
  return option.minutes === 0 ? t(option.label) : t("{delay} later", { delay: t(option.label) });
}

function ThreadRow(props: { post: StoredEvent }) {
  watchThread(() => props.post);
  const status = () => threadStatus(props.post);
  const replies = () => props.post.thread ?? [];
  return (
    <DetailRow icon="ask-chat">
      <p class={status()?.state === "failed" ? "text-destructive" : "text-foreground"}>
        <Show when={status()} fallback={t("{count, plural, one {Thread · # follow-up} other {Thread · # follow-ups}}", { count: replies().length })}>
          {(current) => threadLine(current())}
        </Show>
      </p>
      <ol class="mt-1 flex flex-col gap-1.5">
        <For each={replies()}>
          {(reply, index) => (
            <li class="flex gap-2 text-muted-foreground">
              <span class="shrink-0 tabular-nums">{index() + 1}.</span>
              <span class="flex min-w-0 flex-1 flex-col">
                <Show when={reply.text.trim()}>
                  <span class="line-clamp-2 whitespace-pre-line break-words text-foreground">{reply.text}</span>
                </Show>
                <span class="flex items-center gap-1">
                  {delayLabel(reply.delay)}
                  <Show when={reply.files?.length}>
                    {(count) => (
                      <>
                        <span aria-hidden="true">·</span>
                        <Icon name="image" class="size-4" />
                        <span class="tabular-nums">{count()}</span>
                      </>
                    )}
                  </Show>
                </span>
              </span>
            </li>
          )}
        </For>
      </ol>
    </DetailRow>
  );
}

type EndChoice = "after" | "before" | "date";

function EndSeriesForm(props: { event: CalendarEvent; onCancel(): void; onEnd(day: string | null): void }) {
  const first = () => props.event.firstDay ?? props.event.day;
  const isFirst = () => props.event.day <= first();
  const [choice, setChoice] = createSignal<EndChoice>("after");
  const [picked, setPicked] = createSignal(props.event.recurrenceEnd ?? props.event.day);

  const day = () => (choice() === "after" ? props.event.day : choice() === "before" ? shiftDay(props.event.day, -1) : picked());
  const runs = () => (props.event.recurrence ? runsUntil(props.event.recurrence, first(), day()) : 0);

  const options = (): { id: EndChoice; title: string; detail: string }[] => [
    { id: "after", title: t("After this run"), detail: t("{date} is the last one", { date: formatDay(props.event.day) }) },
    ...(isFirst() ? [] : [{ id: "before" as const, title: t("Before this run"), detail: t("{date} is the last day", { date: formatDay(shiftDay(props.event.day, -1)) }) }]),
    { id: "date", title: t("On a date"), detail: t("Pick the last day it can go out") },
  ];

  return (
    <>
      <div class="space-y-3 p-3.5">
        <div>
          <p class="text-sm font-medium text-foreground">{t("End this series?")}</p>
          <p class="mt-1 text-xs text-muted-foreground">{t("Runs up to the last day stay as they are. Nothing after it goes out.")}</p>
        </div>
        <div class="flex flex-col gap-1" role="radiogroup" aria-label={t("Where it ends")}>
          <For each={options()}>
            {(option) => (
              <button
                type="button"
                role="radio"
                aria-checked={choice() === option.id}
                class="flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors focus-ring"
                classList={{
                  "border-primary/70 bg-primary/10": choice() === option.id,
                  "border-(--border-input) hover:bg-accent": choice() !== option.id,
                }}
                onClick={() => setChoice(option.id)}
              >
                <span
                  class="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border"
                  classList={{ "border-primary": choice() === option.id, "border-border-strong": choice() !== option.id }}
                >
                  <Show when={choice() === option.id}>
                    <span class="size-1.5 rounded-full bg-primary" />
                  </Show>
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-xs text-foreground">{option.title}</span>
                  <span class="text-xs text-muted-foreground">{option.detail}</span>
                </span>
              </button>
            )}
          </For>
        </div>
        <Show when={choice() === "date"}>
          <DatePicker label={t("Last day")} value={picked()} min={first()} onChange={setPicked} />
        </Show>
        <p class="text-xs text-muted-foreground">
          {t("Ends {date}, with {count, plural, one {# post} other {# posts}} in the series from its first day.", { date: formatDay(day()), count: runs() })}
        </p>
      </div>
      <div class={popupFooter}>
        <Button variant="ghost" class="mr-auto" onClick={props.onCancel}>
          {t("Cancel")}
        </Button>
        <Show when={props.event.recurrenceEnd}>
          <Button variant="secondary" onClick={() => props.onEnd(null)}>
            {t("Keep it going")}
          </Button>
        </Show>
        <Button onClick={() => props.onEnd(day())}>{t("End series")}</Button>
      </div>
    </>
  );
}

function ProjectDetail(props: { projectKey: string }) {
  const navigate = useNavigate();
  const returnHere = useReturnHere();
  const name = useProjectName(() => props.projectKey);

  return (
    <DetailRow icon="project-file">
      <Show when={!name.loading}>
        <Show when={name()} fallback={<p class="text-muted-foreground">{t("The linked project is gone")}</p>}>
          {(current) => (
            <button
              type="button"
              class="block max-w-full truncate rounded-md text-left leading-5 text-primary hover:underline focus-ring"
              onClick={() => navigate(projectRoute(props.projectKey), { state: returnHere() })}
            >
              {current()}
            </button>
          )}
        </Show>
      </Show>
    </DetailRow>
  );
}

function EventEditForm(props: { event: CalendarEvent; onCancel(): void; onSaved(): void }) {
  const stored = allPosts().find((post) => post.id === props.event.sourceId);
  const [draft, setDraft] = createStore<EventDraft>({
    allDay: props.event.allDay,
    calendarId: props.event.calendarId,
    day: props.event.day,
    description: props.event.description ?? "",
    duration: props.event.duration,
    link: props.event.link ?? "",
    accounts: readChoices(props.event.accounts),
    platforms: [...props.event.platforms],
    captions: stored ? ownCaptions(stored) : {},
    repeat: "",
    start: props.event.start,
    status: props.event.status,
    title: (stored?.platforms.includes("youtube") && stored.youtube?.title) || props.event.title,
  });
  const [error, setError] = createSignal<string | null>(null);
  createEffect(on(() => ({ ...draft }), () => setError(null), { defer: true }));
  const ownWords = () => draft.platforms.filter((id) => draft.captions?.[id] !== undefined);

  const save = (event?: SubmitEvent) => {
    event?.preventDefault();
    const failure = updateEvent(props.event.sourceId, draft);
    if (failure) {
      setError(failure);
      return;
    }
    toast.success(t("Post updated."));
    props.onSaved();
  };

  return (
    <form
      class="flex min-h-0 flex-1 flex-col"
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
      }}
    >
      <div class="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3.5">
        <EventFields draft={draft} setDraft={setDraft} />
        <For each={ownWords()}>
          {(id) => (
            <label class="block">
              <span class={fieldLabel}>{t("{platform} caption", { platform: platformName(id) })}</span>
              <textarea
                class={cn(fieldControlBase, "min-h-14 resize-none py-1.5 leading-relaxed")}
                placeholder={t("Goes out with the caption above")}
                rows={3}
                value={draft.captions?.[id] ?? ""}
                onInput={(event) => setDraft("captions", id, event.currentTarget.value)}
              />
            </label>
          )}
        </For>
        <Show when={error()}>
          <p role="alert" class="text-xs text-destructive">{t(error() ?? "")}</p>
        </Show>
      </div>
      <div class={popupFooter}>
        <Button type="button" variant="secondary" onClick={props.onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="submit">{t("Save changes")}</Button>
      </div>
    </form>
  );
}
