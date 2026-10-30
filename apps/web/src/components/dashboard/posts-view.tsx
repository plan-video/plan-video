/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Index, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";

import { EventPopover } from "@/components/calendar/event-popover";
import { SquirrelAsleep } from "@/components/brand/mascot";
import { CalendarViewToggle, useOpenCalendarPage } from "@/components/calendar/view-toggle";
import {
  allPosts,
  deleteEvent,
  everyFileOf,
  goesOutFromPicked,
  hydrateCalendar,
  loadError,
  loaded,
  postAsEvent,
  postFile,
  restoreEvent,
  setEventStatus,
  setPostThumbnail,
  setSeriesPaused,
  statusFilter,
  timeHasPassed,
  waitingOf,
} from "@/components/calendar/store";
import { dateFromKey, localDateKey, recurrenceLabel, shiftDay, statusLabel } from "@/components/calendar/utils";
import { DatePicker } from "@/components/publish/date-time-picker";
import { atLocal, formatWhen } from "@/components/publish/save";
import { threadStatus, watchThread, type ThreadStatus } from "@/components/publish/thread-status";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { PlatformLogos } from "@/components/publish/controls";
import { findProject } from "@/components/publish/project-picker";
import { loadProjectCover } from "@/projects";
import { usePostActions } from "@/components/publish/post-actions";
import { canPublish, deliveriesOf, hasFailed, heldBack, isGoingOut, overPlan, retryLabel } from "@/components/publish/publisher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { cx } from "@/lib/cva";
import { localized, msg, t } from "@/lib/i18n";
import { accountLabel, accountsFor } from "@/lib/social-connections";
import { PLATFORM_IDS, listNames, socialPlatform, type PlatformId } from "@/lib/social";
import { thumbnailFromFile } from "@/lib/post-thumbnail";

import type { PostStatus, SelectedEvent, StoredEvent } from "@/components/calendar/types";
import type { DashboardView, PostsTab } from "@/components/dashboard/types";

type Group = { key: string; label: string; note?: string; earlier?: boolean; posts: StoredEvent[] };

type ListRow = { key: string; post: StoredEvent; showDay: boolean };

type ListSection = { key: string; label: string; note?: string; earlier?: boolean; rows: ListRow[] };

type Tab = { id: PostsTab; label: string; view: DashboardView; icon: string; empty: string; hint: string };

const TABS: Tab[] = [
  {
    id: "all",
    label: msg("All"),
    view: "posts",
    icon: "list",
    empty: msg("No posts yet"),
    hint: msg("Posts you write, schedule or save as a draft show up here."),
  },
  {
    id: "scheduled",
    label: msg("Scheduled"),
    view: "scheduled",
    icon: "clock",
    empty: msg("Nothing is scheduled"),
    hint: msg("Schedule a post from New post, or drag one onto a time on the calendar."),
  },
  {
    id: "draft",
    label: msg("Drafts"),
    view: "drafts",
    icon: "document",
    empty: msg("No drafts"),
    hint: msg("Save a post as a draft to finish it later."),
  },
  {
    id: "posted",
    label: msg("Posted"),
    view: "posted",
    icon: "circle-check",
    empty: msg("Nothing has been posted"),
    hint: msg("Posts that went out, or that you marked as posted, are kept here."),
  },
  {
    id: "failed",
    label: msg("Failed"),
    view: "failed",
    icon: "alert-warning",
    empty: msg("Nothing failed"),
    hint: msg("A post that doesn't go out shows here with a retry."),
  },
];

function inTab(post: StoredEvent, tab: PostsTab) {
  if (tab === "all") return true;
  if (tab === "failed") return hasFailed(post) && !isGoingOut(post);
  return post.status === tab;
}

const PLATFORM_SET = new Set<string>(PLATFORM_IDS);

function momentOf(post: StoredEvent): number {
  return atLocal(post.day, post.allDay ? "00:00" : post.start)?.getTime() ?? 0;
}

function todayKey(offset = 0) {
  return shiftDay(localDateKey(new Date()), offset);
}

// Day keys name a calendar day, so they format in UTC whatever the zone.
const DAY_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
const DAY_YEAR_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
const SHORT_DAY_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }));

function dayLabel(key: string) {
  if (key === todayKey()) return t("Today");
  if (key === todayKey(1)) return t("Tomorrow");
  if (key === todayKey(-1)) return t("Yesterday");
  return (key.slice(0, 4) === todayKey().slice(0, 4) ? DAY_FORMAT : DAY_YEAR_FORMAT)().format(dateFromKey(key));
}

function shortDay(key: string) {
  const label = dayLabel(key);
  return label === fullDate(key) ? SHORT_DAY_FORMAT().format(dateFromKey(key)) : label;
}

function fullDate(key: string) {
  return (key.slice(0, 4) === todayKey().slice(0, 4) ? DAY_FORMAT : DAY_YEAR_FORMAT)().format(dateFromKey(key));
}

function byDay(posts: StoredEvent[], newestFirst: boolean): Group[] {
  const sorted = [...posts].sort((a, b) => (newestFirst ? momentOf(b) - momentOf(a) : momentOf(a) - momentOf(b)));
  const groups: Group[] = [];
  for (const post of sorted) {
    const last = groups.at(-1);
    if (last?.key === post.day) last.posts.push(post);
    else {
      const label = dayLabel(post.day);
      groups.push({ key: post.day, label, posts: [post] });
    }
  }
  return groups;
}

const undo = (failure: string | undefined) => failure && toast.error(t(failure));

const needsWatching = (post: StoredEvent) => isGoingOut(post) || hasFailed(post);

function isPastDue(post: StoredEvent, now: number) {
  return post.status === "scheduled" && momentOf(post) < now && !needsWatching(post);
}

function matches(post: StoredEvent, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${post.title}\n${post.description ?? ""}\n${post.link ?? ""}\n${post.platforms.join(" ")}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

// Past-due scheduled posts sort to the top: they don't go out on their own yet.
function groupPosts(posts: StoredEvent[], tab: PostsTab, now: number): Group[] {
  if (tab === "posted") return byDay(posts, true);

  const goingOut = posts.filter(isGoingOut);
  const sending = goingOut.filter((post) => !waitingOf(post));
  const waiting = goingOut.filter((post) => waitingOf(post));
  const failed = posts.filter((post) => !isGoingOut(post) && hasFailed(post));
  const pastDue = posts.filter((post) => isPastDue(post, now));
  const rest = posts.filter((post) => !needsWatching(post) && !isPastDue(post, now));
  const upcoming = rest.filter((post) => momentOf(post) >= now || post.day === todayKey());
  const earlier = rest.filter((post) => !upcoming.includes(post));

  const groups: Group[] = [];
  if (sending.length) groups.push({ key: "sending", label: t("Sending"), posts: sending });
  if (waiting.length) groups.push({ key: "waiting", label: t("Waiting"), posts: waiting });
  if (failed.length) {
    groups.push({ key: "failed", label: t("Didn't go out"), posts: failed });
  }
  if (pastDue.length) {
    groups.push({ key: "past-due", label: t("Past due"), posts: [...pastDue].sort((a, b) => momentOf(a) - momentOf(b)) });
  }
  const past = byDay(earlier, true);
  if (past[0] && (groups.length || upcoming.length)) past[0].earlier = true;
  groups.push(...byDay(upcoming, false), ...past);
  return groups;
}

const thumbnails = new Map<string, Promise<string | null>>();
const readThumbnails = new Map<string, string | null>();

const youtubeVideoId = (post: StoredEvent) => (post.deliveries?.youtube?.state === "sent" ? post.deliveries.youtube.publishId : undefined);

function thumbnailOf(post: StoredEvent): Promise<string | null> {
  if (post.thumbnail) return Promise.resolve(post.thumbnail);
  const key = thumbnailKey(post);
  let found = thumbnails.get(key);
  if (!found) {
    found = (async () => {
      const file = await postFile(everyFileOf(post)[0] ?? post.id);
      if (file) {
        const made = await thumbnailFromFile(file, post.coverTime);
        if (made) setPostThumbnail(post.id, made);
        return made;
      }
      if (post.projectId) {
        const project = await findProject(post.projectId);
        if (project?.cover) return loadProjectCover(project.dir, project.cover);
      }
      const video = youtubeVideoId(post);
      return video ? `https://i.ytimg.com/vi/${encodeURIComponent(video)}/mqdefault.jpg` : null;
    })()
      .catch(() => null)
      .then((url) => {
        readThumbnails.set(key, url);
        return url;
      });
    thumbnails.set(key, found);
  }
  return found;
}

function thumbnailKey(post: StoredEvent) {
  return post.thumbnail ?? `${everyFileOf(post)[0] ?? post.id}:${post.coverTime ?? ""}:${post.projectId ?? ""}:${youtubeVideoId(post) ?? ""}`;
}

function knownThumbnail(post: StoredEvent) {
  return post.thumbnail || readThumbnails.get(thumbnailKey(post));
}

export function PostThumbnail(props: { post: StoredEvent }) {
  const [src, setSrc] = createSignal<string | null>(knownThumbnail(props.post) ?? null);
  let near = false;
  const load = () => {
    const key = thumbnailKey(props.post);
    void thumbnailOf(props.post).then((url) => {
      if (thumbnailKey(props.post) === key) setSrc(url);
    });
  };
  let box!: HTMLSpanElement;
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        near = true;
        load();
      },
      { rootMargin: "200px" },
    );
    observer.observe(box);
    onCleanup(() => observer.disconnect());
  });
  createEffect(
    on(
      () => thumbnailKey(props.post),
      () => {
        if (near) load();
        else setSrc(knownThumbnail(props.post) ?? null);
      },
      { defer: true },
    ),
  );
  return (
    <span ref={box} class="grid h-10 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-accent/50 text-muted-foreground/60">
      <Show when={src()} fallback={<Icon name="image" class="size-4" />}>
        {(url) => <img src={url()} alt="" class="size-full object-cover" draggable={false} />}
      </Show>
    </span>
  );
}

const MONTH_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }));
const MONTH_NAME = localized((locale) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }));

/** A series counts in the month of its first day, as its row does. */
const inMonth = (post: StoredEvent, month: string) => post.day.startsWith(month);

function passesFilter(post: StoredEvent) {
  if (!goesOutFromPicked(post)) return false;
  const status = statusFilter();
  if (status === "failed") return hasFailed(post) && !isGoingOut(post);
  return status === "all" || post.status === status;
}

function toSections(groups: Group[]): ListSection[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    note: group.note,
    earlier: group.earlier,
    rows: group.posts.map((post) => ({
      key: `${group.key}:${post.id}`,
      post,
      showDay: group.key === "past-due" || group.key === "failed" || group.key === "sending" || group.key === "waiting",
    })),
  }));
}

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i]);

const [listQuery, setListQuery] = createSignal("");
export { listQuery, setListQuery };

export function CalendarPostList(props: {
  date: string;
  picked?: string | null;
  onShowMonth?(): void;
}) {
  const [, setParams] = useSearchParams();
  const query = listQuery;
  // Cleared on leave so it doesn't filter the list unseen next time.
  onCleanup(() => setListQuery(""));
  const [selected, setSelected] = createSignal<SelectedEvent | null>(null);
  const [now, setNow] = createSignal(Date.now());
  let scroller: HTMLDivElement | undefined;

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(
    on(
      () => props.date,
      (day) => {
        requestAnimationFrame(() => {
          const month = day.slice(0, 7);
          const days = [...(scroller?.querySelectorAll<HTMLElement>("[data-day]") ?? [])]
            .map((node) => node.dataset.day)
            .filter((value): value is string => !!value && value.startsWith(month))
            .sort();
          const target = days.includes(day) ? day : days[0];
          if (target) scroller?.querySelector(`[data-day="${target}"]`)?.scrollIntoView({ block: "start" });
        });
      },
      { defer: true },
    ),
  );

  const visible = () => allPosts().filter(passesFilter);
  const month = () => props.date.slice(0, 7);

  const sections = createMemo(() => {
    const searching = !!query().trim();
    const day = props.picked;
    const posts = visible().filter((post) =>
      searching ? matches(post, query()) : day ? post.day === day : inMonth(post, month()),
    );
    return toSections(groupPosts(posts, statusFilter() === "posted" ? "posted" : "all", now()));
  });
  // Keyed rows: when posts are read again only a changed row redraws; redrawing every row made the list blink.
  const sectionKeys = createMemo(() => sections().map((section) => section.key), undefined, { equals: sameKeys });
  const sectionsByKey = createMemo(() => new Map(sections().map((section) => [section.key, section])));
  const rowsByKey = createMemo(() => new Map(sections().flatMap((section) => section.rows.map((row) => [row.key, row]))));

  const { edit, send, openCalendar, upgrade } = usePostActions();

  const remove = (post: StoredEvent) => {
    const failure = deleteEvent({ sourceId: post.id });
    if (failure) {
      toast.error(t(failure));
      return;
    }
    toast(t("Post deleted"), { description: post.title, action: { label: t("Undo"), onClick: () => restoreEvent(post) } });
  };

  const changeStatus = (post: StoredEvent, status: PostStatus) => {
    if (status === "scheduled" && timeHasPassed(post)) {
      toast.error(t("Its time has passed"), { description: t("Pick a new time to schedule it."), action: { label: t("Pick a time"), onClick: () => edit(post, true) } });
      return;
    }
    const failure = setEventStatus(post.id, status);
    if (failure) {
      toast.error(t(failure));
      return;
    }
    const message = { posted: t("Marked as posted"), scheduled: t("Marked as scheduled"), draft: t("Moved to drafts") }[status];
    toast.success(message, {
      description: post.title,
      action: { label: t("Undo"), onClick: () => undo(setEventStatus(post.id, post.status)) },
    });
  };

  const togglePause = (post: StoredEvent) => {
    const paused = !!post.paused;
    const failure = setSeriesPaused(post.id, !paused);
    if (failure) {
      toast.error(t(failure));
      return;
    }
    toast.success(paused ? t("Series resumed") : t("Series paused"), {
      description: post.title,
      action: { label: t("Undo"), onClick: () => undo(setSeriesPaused(post.id, paused)) },
    });
  };

  const open = (post: StoredEvent, event: MouseEvent) => {
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setSelected({ anchor: new DOMRect(event.clientX, row.top, 0, row.height), event: postAsEvent(post) });
  };

  const empty = () => {
    if (query().trim()) return t("No posts match “{query}”", { query: query() });
    if (!allPosts().length) return t("No posts yet");
    if (props.picked) return t("No posts on {date}", { date: fullDate(props.picked) });
    if (statusFilter() === "all") return t("No posts in {month}", { month: MONTH_FORMAT().format(dateFromKey(`${month()}-01`)) });
    if (statusFilter() === "posted") return t("Nothing has been posted");
    if (statusFilter() === "draft") return t("No drafts");
    if (statusFilter() === "scheduled") return t("Nothing is scheduled");
    if (statusFilter() === "failed") return t("Nothing failed");
    return t("No posts");
  };

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header and rows both keep room for a scrollbar, so the columns line up. */}
      <Show when={sections().length}>
        <div class="hidden shrink-0 overflow-hidden px-3 [scrollbar-gutter:stable] lg:block">
          <ColumnNames />
        </div>
      </Show>
      <div ref={scroller} class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div class="flex w-full flex-col px-3 pb-16">
          <Show when={props.picked && !query().trim() && props.onShowMonth}>
            <div class="flex justify-end pt-2">
              <button
                type="button"
                class="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-ring"
                onClick={() => props.onShowMonth?.()}
              >
                {t("All of {month}", { month: MONTH_NAME().format(dateFromKey(`${month()}-01`)) })}
              </button>
            </div>
          </Show>
          <Show
            when={sections().length}
            fallback={
              <div class="flex flex-col items-center gap-2 px-6 pt-12 text-center">
                <Show when={!allPosts().length}>
                  <SquirrelAsleep width={92} class="mb-3 text-(--plane-text-tertiary) opacity-70" />
                </Show>
                <h2 class="text-sm font-medium text-foreground">{empty()}</h2>
                <Show when={!allPosts().length}>
                  <p class="text-xs text-muted-foreground">{t("Posts you write, schedule or save as a draft show up here.")}</p>
                  <Button class="mt-1 px-2.5" onClick={() => setParams({ dashboard: "new-post", date: undefined, view: undefined })}>
                    {t("New post")}
                  </Button>
                </Show>
              </div>
            }
          >
            <For each={sectionKeys()}>
              {(key) => {
                // The last copy is kept for the moment a section that's gone is still drawn.
                const section = createMemo<ListSection>((last) => sectionsByKey().get(key) ?? last!);
                const rowKeys = createMemo(() => section().rows.map((row) => row.key), undefined, { equals: sameKeys });
                return (
                  <section class="flex flex-col" data-day={key.length === 10 ? key : undefined}>
                    <SectionHeader id={key} label={section().label} note={section().note} earlier={section().earlier} />
                    <div class="flex flex-col">
                      <For each={rowKeys()}>
                        {(rowKey) => {
                          const row = createMemo<ListRow>((last) => rowsByKey().get(rowKey) ?? last!);
                          return (
                            <PostRow
                              post={row().post}
                              showDay={row().showDay}
                              pastDue={isPastDue(row().post, now())}
                              onOpen={(event) => open(row().post, event)}
                              onSend={() => void send(row().post)}
                              onUpgrade={upgrade}
                              onEdit={(replace) => edit(row().post, replace)}
                              onStatus={(status) => changeStatus(row().post, status)}
                              onCalendar={() => openCalendar(row().post)}
                              onPause={() => togglePause(row().post)}
                              onDelete={() => remove(row().post)}
                            />
                          );
                        }}
                      </For>
                    </div>
                  </section>
                );
              }}
            </For>
          </Show>
        </div>
      </div>

      <Show when={selected()} keyed>
        {(current) => <EventPopover selected={current} onClose={() => setSelected(null)} />}
      </Show>
    </div>
  );
}

export function DashboardPostsView(props: { tab: PostsTab }) {
  const [, setParams] = useSearchParams();
  const [query, setQuery] = createSignal("");
  const [day, setDay] = createSignal("");
  const [selected, setSelected] = createSignal<SelectedEvent | null>(null);
  const [now, setNow] = createSignal(Date.now());

  const openCalendarPage = useOpenCalendarPage();

  onMount(() => {
    void hydrateCalendar();
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (selected()) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu], [role=listbox]"))) return;
      const key = event.key.toLowerCase();
      if (key !== "w" && key !== "m") return;
      event.preventDefault();
      openCalendarPage(key === "w" ? "week" : "month");
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const page = () => TABS.find((tab) => tab.id === props.tab) ?? TABS[0]!;
  const counts = createMemo(() => {
    const posts = allPosts();
    return Object.fromEntries(TABS.map((tab) => [tab.id, posts.filter((post) => inTab(post, tab.id)).length])) as Record<PostsTab, number>;
  });
  const tabs = () => TABS.filter((tab) => tab.id !== "failed" || counts().failed > 0 || props.tab === "failed");
  const ofTab = () => allPosts().filter((post) => inTab(post, props.tab));
  const shown = createMemo(() => ofTab().filter((post) => matches(post, query()) && (!day() || post.day === day())));
  const groups = createMemo(() => groupPosts(shown(), props.tab, now()));
  const openTab = (tab: Tab) => setParams({ dashboard: tab.view, date: undefined, view: undefined }, { replace: true });

  const { edit, send, openCalendar, upgrade } = usePostActions();

  const remove = (post: StoredEvent) => {
    const failure = deleteEvent({ sourceId: post.id });
    if (failure) {
      toast.error(t(failure));
      return;
    }
    toast(t("Post deleted"), { description: post.title, action: { label: t("Undo"), onClick: () => restoreEvent(post) } });
  };

  const changeStatus = (post: StoredEvent, status: PostStatus) => {
    if (status === "scheduled" && timeHasPassed(post)) {
      toast.error(t("Its time has passed"), { description: t("Pick a new time to schedule it."), action: { label: t("Pick a time"), onClick: () => edit(post, true) } });
      return;
    }
    const failure = setEventStatus(post.id, status);
    if (failure) {
      toast.error(t(failure));
      return;
    }
    const message = { posted: t("Marked as posted"), scheduled: t("Marked as scheduled"), draft: t("Moved to drafts") }[status];
    toast.success(message, {
      description: post.title,
      action: { label: t("Undo"), onClick: () => undo(setEventStatus(post.id, post.status)) },
    });
  };

  const togglePause = (post: StoredEvent) => {
    const paused = !!post.paused;
    const failure = setSeriesPaused(post.id, !paused);
    if (failure) {
      toast.error(t(failure));
      return;
    }
    toast.success(paused ? t("Series resumed") : t("Series paused"), {
      description: post.title,
      action: { label: t("Undo"), onClick: () => undo(setSeriesPaused(post.id, paused)) },
    });
  };

  const open = (post: StoredEvent, event: MouseEvent) => {
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setSelected({ anchor: new DOMRect(event.clientX, row.top, 0, row.height), event: postAsEvent(post) });
  };

  return (
    <div class="@container flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border-strong px-6">
        <h1 class="sr-only">{t("Posts")}</h1>
        <CalendarViewToggle value="list" onChange={openCalendarPage} />
        <div role="tablist" aria-label={t("Show")} class="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          <For each={tabs()}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={props.tab === tab.id}
                class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm press focus-ring"
                classList={{
                  "bg-secondary text-foreground": props.tab === tab.id,
                  "text-muted-foreground hover:bg-accent hover:text-foreground": props.tab !== tab.id,
                }}
                onClick={() => openTab(tab)}
              >
                {t(tab.label)}
                <Show when={loaded() && counts()[tab.id] > 0}>
                  <span
                    class="text-xs tabular-nums"
                    classList={{ "text-destructive": tab.id === "failed", "text-muted-foreground": tab.id !== "failed" }}
                  >
                    {counts()[tab.id]}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <span class="flex-1" />
        <Show when={ofTab().length}>
          <div class="flex shrink-0 items-center gap-0.5">
            <DatePicker value={day()} onChange={setDay} placeholder={t("Any day")} label={t("Show one day")} class="h-8 w-48 text-sm" />
            <Show when={day()}>
              <Button variant="ghost" size="icon-square" aria-label={t("Show every day")} onClick={() => setDay("")}>
                <Icon name="close-remove" class="size-5 text-muted-foreground" />
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={ofTab().length}>
          <label class="flex h-8 w-64 min-w-32 shrink items-center gap-1 rounded-md border border-(--border-input) bg-input pl-1 pr-2 transition-colors focus-within:border-primary">
            <Icon name="search" class="size-5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={query()}
              placeholder={t("Search posts")}
              aria-label={t("Search posts")}
              class="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </Show>
        <Button class="px-2.5" onClick={() => setParams({ dashboard: "new-post", date: undefined, view: undefined })}>
          {t("New post")}
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex w-full flex-col px-3 pb-16">
          <Switch>
            <Match when={loadError()}>
              <p class="py-16 text-center text-xs text-muted-foreground">{t(loadError() ?? "")}</p>
            </Match>
            <Match when={!loaded()}>
              <div />
            </Match>
            <Match when={!ofTab().length}>
              <div class="flex flex-col items-center gap-3 pt-12 text-center">
                <span class="grid size-11 place-items-center rounded-full bg-accent text-muted-foreground">
                  <Icon name={page().icon} class="size-6" />
                </span>
                <div class="flex flex-col gap-1">
                  <h2 class="text-sm font-medium text-foreground">{t(page().empty)}</h2>
                  <p class="text-xs text-muted-foreground">{t(page().hint)}</p>
                </div>
                <div class="flex items-center gap-1.5 pt-1">
                  <Button variant="secondary" onClick={() => setParams({ dashboard: "calendar", date: undefined, view: undefined })}>
                    {t("Open calendar")}
                  </Button>
                  <Button class="px-2.5" onClick={() => setParams({ dashboard: "new-post", date: undefined, view: undefined })}>
                    {t("New post")}
                  </Button>
                </div>
              </div>
            </Match>
            <Match when={!shown().length}>
              <p class="py-16 text-center text-sm text-muted-foreground">
                {query()
                  ? day()
                    ? t("No posts match “{query}” on {date}.", { query: query(), date: fullDate(day()) })
                    : t("No posts match “{query}”.", { query: query() })
                  : day()
                    ? t("No posts on {date}.", { date: fullDate(day()) })
                    : t("No posts.")}
              </p>
            </Match>
            <Match when>
              <For each={groups()}>
                {(group) => (
                  <section class="flex flex-col">
                    <SectionHeader id={group.key} label={group.label} note={group.note} earlier={group.earlier} />
                    <div class="flex flex-col">
                      <For each={group.posts}>
                        {(post) => (
                          <PostRow
                            post={post}
                            showDay={group.key === "past-due" || group.key === "failed" || group.key === "sending" || group.key === "waiting"}
                            pastDue={isPastDue(post, now())}
                            onOpen={(event) => open(post, event)}
                            onSend={() => void send(post)}
                            onUpgrade={upgrade}
                            onEdit={(replace) => edit(post, replace)}
                            onStatus={(status) => changeStatus(post, status)}
                            onCalendar={() => openCalendar(post)}
                            onPause={() => togglePause(post)}
                            onDelete={() => remove(post)}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </Match>
          </Switch>
        </div>
      </div>

      <Show when={selected()} keyed>
        {(current) => <EventPopover selected={current} onClose={() => setSelected(null)} />}
      </Show>
    </div>
  );
}

function SectionHeader(props: { id: string; label: string; note?: string; earlier?: boolean }) {
  return (
    <>
      <Show when={props.earlier}>
        <div class="mt-4 border-t border-border-strong" />
      </Show>
      {/* The page's own colour: no band of its own, yet rows still pass under it when it sticks. */}
      <div class="sticky top-0 z-10 flex h-10 items-end gap-2 bg-(--plane-surface-1) px-3 pb-2">
        <h3
          class="shrink-0 text-sm font-medium"
          classList={{
            "text-meter-yellow": props.id === "past-due",
            "text-destructive": props.id === "failed",
            "text-foreground": props.id !== "past-due" && props.id !== "failed",
          }}
        >
          {props.label}
        </h3>
        <Show when={props.note}>
          <span class="min-w-0 truncate text-xs text-muted-foreground">{props.note}</span>
        </Show>
      </div>
    </>
  );
}

type StatusTone = "sending" | "failed" | "late" | "posted" | "scheduled" | "draft";

const STATUS_TONE: Record<StatusTone, string> = {
  sending: "text-primary",
  failed: "text-destructive",
  late: "text-meter-yellow",
  posted: "text-foreground",
  scheduled: "text-foreground",
  draft: "text-muted-foreground",
};

const STATUS_DOT: Record<StatusTone, string> = {
  sending: "bg-primary",
  failed: "bg-destructive",
  late: "bg-meter-yellow",
  posted: "bg-meter-green",
  scheduled: "bg-primary",
  draft: "bg-muted-foreground/60",
};

function PostAccounts(props: { post: StoredEvent; platforms: PlatformId[] }) {
  const accounts = () =>
    props.platforms.flatMap((platform) => {
      const picked = accountsFor(platform, props.post.accounts);
      return picked.length
        ? picked.map((account) => ({ key: account.id, account: account as { platform: string; avatarUrl?: string }, label: accountLabel(account) }))
        : [{ key: platform, account: { platform }, label: socialPlatform(platform).name }];
    });
  const more = () => accounts().length - 1;
  return (
    <Show when={accounts().length}>
      <span class="flex min-w-0 items-center gap-2">
        <span class="flex shrink-0 gap-1">
          {/* By place, so a refresh of the posts keeps the pictures rather than loading them again. */}
          <Index each={accounts().slice(0, 3)}>{(item) => <AccountAvatar account={item().account} class="size-5" compact />}</Index>
        </span>
        {/* The badge hangs below the picture, so the words sit a pixel lower to look centred. */}
        <span class="min-w-0 translate-y-px truncate text-xs text-foreground">{accounts()[0]!.label}</span>
        <Show when={more() > 0}>
          <span class="shrink-0 translate-y-px text-xs text-muted-foreground">+{more()}</span>
        </Show>
      </span>
    </Show>
  );
}

const ROW_COLUMNS = "lg:grid lg:grid-cols-[4.5rem_minmax(0,5fr)_minmax(0,3fr)_minmax(6rem,2fr)_2rem] lg:gap-x-4";

function ColumnNames() {
  return (
    <div class={`hidden h-9 items-end px-3 pb-1.5 text-xs text-muted-foreground ${ROW_COLUMNS}`}>
      <span>{t("Time")}</span>
      <span class="pl-11">{t({ message: "Post", context: "noun" })}</span>
      <span>{t("Accounts")}</span>
      <span>{t("Status")}</span>
    </div>
  );
}

function threadLine(status: ThreadStatus): string {
  if (status.state === "failed") return `${t("Follow-up {number} didn't go out on {network}.", { number: status.step, network: status.network })} ${t(status.error)}`.trim();
  if (status.state === "waiting") return t("Thread · next follow-up {when}", { when: formatWhen(status.at) });
  return t("{count, plural, one {Thread · # follow-up sent} other {Thread · # follow-ups sent}}", { count: status.count });
}

function PostRow(props: {
  post: StoredEvent;
  showDay: boolean;
  pastDue: boolean;
  onOpen(event: MouseEvent): void;
  onSend(): void;
  onUpgrade(): void;
  onEdit(replace: boolean): void;
  onStatus(status: PostStatus): void;
  onCalendar(): void;
  onPause(): void;
  onDelete(): void;
}) {
  const platforms = () => props.post.platforms.filter((id): id is PlatformId => PLATFORM_SET.has(id));
  const firstLine = () => props.post.description?.split("\n").map((line) => line.trim()).find(Boolean);
  const caption = () => (firstLine() === props.post.title.trim() ? undefined : firstLine());
  const time = () => (props.post.allDay ? t("All day") : props.post.start);
  const sending = () => isGoingOut(props.post);
  const waiting = () => (sending() ? waitingOf(props.post) : undefined);
  const sendingTo = () =>
    deliveriesOf(props.post)
      .filter(({ platform, delivery }) => delivery.state === "sending" && PLATFORM_SET.has(platform))
      .map(({ platform }) => platform as PlatformId);
  const failure = () =>
    sending() || !hasFailed(props.post) ? undefined : deliveriesOf(props.post).find(({ delivery }) => delivery.state === "failed")?.delivery;
  const sent = () => deliveriesOf(props.post).some(({ delivery }) => delivery.state === "sent");
  const inInbox = () => !!props.post.tiktok?.inbox && sent() && props.post.status !== "posted" && !sending() && !failure();
  const sendable = () => canPublish(props.post) && !props.post.recurrence && props.post.status !== "posted" && !sent() && !sending();
  const copies = () => props.post.status === "posted";
  const held = () => (sending() || failure() ? null : heldBack(props.post));
  watchThread(() => props.post);
  const thread = () => (sending() || failure() ? null : threadStatus(props.post));
  const status = () =>
    waiting() ? t("Waiting") : sending() ? t("Sending") : failure() ? t("Failed") : held() ? t(held()!.label) : inInbox() ? t("In inbox") : props.pastDue ? t("Past due") : statusLabel(props.post.status);
  const tone = (): StatusTone =>
    waiting() ? "late" : sending() ? "sending" : failure() ? "failed" : held() ? "late" : inInbox() ? "scheduled" : props.pastDue ? "late" : props.post.status === "posted" ? "posted" : props.post.status === "scheduled" ? "scheduled" : "draft";

  return (
    <div class={`group relative flex h-14 items-center gap-3 rounded-md px-3 transition-colors hover:bg-accent ${ROW_COLUMNS} lg:items-center`}>
      <button
        type="button"
        class="absolute inset-0 rounded-md focus-ring"
        aria-label={t("Open {title}", { title: props.post.title })}
        onClick={(event) => props.onOpen(event)}
      />
      <div class="pointer-events-none flex w-18 shrink-0 flex-col">
        <span class="text-sm tabular-nums text-muted-foreground">{time()}</span>
        <Show when={props.showDay}>
          <span class="truncate text-xs text-muted-foreground">{shortDay(props.post.day)}</span>
        </Show>
      </div>
      <div class="pointer-events-none flex min-w-0 flex-1 items-center gap-3">
        <PostThumbnail post={props.post} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm font-medium text-foreground">{props.post.title}</span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground empty:hidden">
            <Switch
              fallback={
                <>
                  <Show when={props.post.recurrence}>
                    <span class="flex shrink-0 items-center" classList={{ "text-meter-yellow": !!props.post.paused }}>
                      <Icon name={props.post.paused ? "pause" : "loop"} class="-my-1 -ml-1 size-4" />
                      {props.post.paused
                        ? t("Paused · {repeats}", { repeats: recurrenceLabel(props.post.recurrence, props.post.day, props.post.recurrenceEnd) ?? t("Repeats") })
                        : (recurrenceLabel(props.post.recurrence, props.post.day, props.post.recurrenceEnd) ?? t("Repeats"))}
                    </span>
                  </Show>
                  <Show when={caption()}>
                    {(text) => <span class="truncate">{text()}</span>}
                  </Show>
                </>
              }
            >
              <Match when={waiting()}>
                {(reason) => <span class="truncate text-meter-yellow">{t(reason())}</span>}
              </Match>
              <Match when={sending()}>
                <span class="truncate">{props.post.tiktok?.inbox && sendingTo().join() === "tiktok" ? t("Sending to your TikTok inbox…") : t("Sending to {platforms}…", { platforms: listNames(sendingTo()) })}</span>
              </Match>
              <Match when={failure()}>
                {(delivery) => <span class="truncate text-destructive">{t(delivery().error || msg("It didn't go out."))}</span>}
              </Match>
              <Match when={held()}>
                {(state) => <span class="truncate text-meter-yellow">{t(state().detail)}</span>}
              </Match>
              <Match when={thread()?.state === "failed" && thread()}>
                {(status) => (
                  <span class="truncate text-destructive" title={threadLine(status())}>
                    {threadLine(status())}
                  </span>
                )}
              </Match>
              <Match when={thread()}>{(status) => <span class="truncate">{threadLine(status())}</span>}</Match>
            </Switch>
          </span>
        </div>
        <Show when={failure()}>
          {(delivery) => (
            <>
              <Show when={overPlan(delivery())}>
                <Button class="pointer-events-auto relative shrink-0 px-2.5" onClick={() => props.onUpgrade()}>
                  {t("Upgrade")}
                </Button>
              </Show>
              <Button variant="secondary" class="pointer-events-auto relative shrink-0 px-2.5" onClick={() => props.onSend()}>
                {t(retryLabel(delivery()))}
              </Button>
            </>
          )}
        </Show>
      </div>
      <div class="pointer-events-none hidden w-24 shrink-0 justify-end sm:flex lg:hidden">
        <Show when={platforms().length}>
          <PlatformLogos ids={platforms()} max={4} class="gap-1" logoClass="size-5" compact />
        </Show>
      </div>
      <div class="pointer-events-none hidden min-w-0 lg:flex">
        <PostAccounts post={props.post} platforms={platforms()} />
      </div>
      <span
        class="flex w-24 shrink-0 items-center gap-2 text-xs lg:w-auto"
        classList={{ [STATUS_TONE[tone()]]: true, "pointer-events-none": !inInbox() && !held() && !waiting() }}
        title={waiting() ? t(waiting()!) : inInbox() ? t("Open the notification in TikTok to finish it") : held() ? t(held()!.detail) : undefined}
      >
        <Show when={sending() && !waiting()} fallback={<span class={cx("size-1.5 shrink-0 rounded-full", STATUS_DOT[tone()])} />}>
          <Icon name="spinner-loader" class="-mx-1 size-4 shrink-0 animate-spin" />
        </Show>
        {status()}
      </span>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger
          as="button"
          type="button"
          aria-label={t("More")}
          class="relative grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 press hover:bg-accent hover:text-foreground focus-ring group-hover:opacity-100 focus-visible:opacity-100 data-[expanded]:opacity-100"
        >
          <Icon name="more-three-dots-small-horizontal" class="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-44">
            <Show when={sendable()}>
              <DropdownMenuItem tone="neutral" onSelect={() => props.onSend()}>
                {failure() ? t(retryLabel(failure()!)) : t("Post now")}
              </DropdownMenuItem>
            </Show>
            <DropdownMenuItem tone="neutral" onSelect={() => props.onEdit(!copies())}>
              {copies() ? t("Post again") : t("Open in New post")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <Show when={props.post.status !== "posted"}>
              <DropdownMenuItem tone="neutral" onSelect={() => props.onStatus("posted")}>
                {t("Mark as posted")}
              </DropdownMenuItem>
              <Show when={props.post.status !== "scheduled"}>
                <DropdownMenuItem tone="neutral" onSelect={() => props.onStatus("scheduled")}>
                  {t("Mark as scheduled")}
                </DropdownMenuItem>
              </Show>
              <Show when={props.post.status !== "draft"}>
                <DropdownMenuItem tone="neutral" onSelect={() => props.onStatus("draft")}>
                  {t("Move to drafts")}
                </DropdownMenuItem>
              </Show>
            </Show>
            <DropdownMenuItem tone="neutral" onSelect={() => props.onCalendar()}>
              {t("Show on calendar")}
            </DropdownMenuItem>
            <Show when={props.post.recurrence}>
              <DropdownMenuItem tone="neutral" onSelect={() => props.onPause()}>
                {props.post.paused ? t("Resume series") : t("Pause series")}
              </DropdownMenuItem>
            </Show>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete()}>
              {t("Delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  );
}
