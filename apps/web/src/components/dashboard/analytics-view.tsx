/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";

import { PlatformLogo, Segmented } from "@/components/publish/controls";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { AnalyticsArt } from "@/components/dashboard/empty-art";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "somoto";
import { useAuth } from "@/context/auth";
import { intlLocale, msg, rich, t } from "@/lib/i18n";
import {
  ANALYTICS_METRICS,
  ANALYTICS_PLATFORMS,
  DAY_MS,
  INTERVALS,
  analyticsReport,
  analyticsSources,
  change,
  compactNumber,
  dayKeyOf,
  defaultInterval,
  engagement,
  followersOf,
  fullNumber,
  intervalsFor,
  percent,
  postTimeline,
  samplePostDays,
  totals,
  type AnalyticsMetric,
  type AnalyticsPlatform,
  type AnalyticsPlatformId,
  type AnalyticsPost,
  type AnalyticsSource,
  type Interval,
  type Span,
  type Totals,
} from "@/lib/social-analytics";
import { loadPostDays, syncAnalytics, syncState } from "@/lib/analytics-sync";
import { ENOUGH_POSTS, postingTimes, WEEKDAY_NAMES, WEEKDAY_SHORT, type SlotStats } from "@/lib/posting-times";
import { addQueueSlots, loadQueueSlots, queueSlots } from "@/lib/queue-slots";
import { accountLabel, loadSocialConnections, socialConnections } from "@/lib/social-connections";
import { zonedFormat, zonedParts } from "@/lib/time-zone";

import { AnalyticsRangePicker, compareLabel, resolveRange } from "./analytics-range";
import {
  analyticsHidden,
  analyticsInterval,
  analyticsMetric,
  analyticsRange,
  setAnalyticsInterval,
  setAnalyticsMetric,
  setAnalyticsRange,
} from "./analytics-state";
import type { AnalyticsSection, DashboardView } from "./types";

type PostSort = AnalyticsMetric | "engagement";

const POST_SORTS: readonly { id: PostSort; label: string }[] = [
  ...ANALYTICS_METRICS,
  { id: "engagement", label: msg("Engagement") },
];

const EMPTY_RANGE: Record<AnalyticsMetric, string> = {
  views: msg("No views in this range"),
  likes: msg("No likes in this range"),
  comments: msg("No comments in this range"),
};

const SINCE_POSTED: Record<AnalyticsMetric, string> = {
  views: msg("Views since it went out"),
  likes: msg("Likes since it went out"),
  comments: msg("Comments since it went out"),
};

const card = "rounded-xl border border-border-strong bg-accent/30";

const shortDate = zonedFormat({ month: "short", day: "numeric" }, "en");
const shortDateYear = zonedFormat({ month: "short", day: "numeric", year: "numeric" }, "en");
const longDate = zonedFormat({ weekday: "short", month: "short", day: "numeric" }, "en");
const longDateYear = zonedFormat({ weekday: "short", month: "short", day: "numeric", year: "numeric" }, "en");
const monthShort = zonedFormat({ month: "short" }, "en");
const monthYear = zonedFormat({ month: "long", year: "numeric" }, "en");
const monthShortYear = zonedFormat({ month: "short", year: "numeric" }, "en");
const clock = zonedFormat({ hour: "2-digit", minute: "2-digit" }, "en-GB");

const thisYear = (time: number) => zonedParts(time).year === zonedParts(Date.now()).year;

function ago(time: number) {
  const days = Math.round((Date.parse(dayKeyOf(Date.now())) - Date.parse(dayKeyOf(time))) / DAY_MS);
  if (days <= 0) return t("Today, {time}", { time: clock.format(time) });
  if (days === 1) return t("Yesterday, {time}", { time: clock.format(time) });
  if (days < 7) return t("{count, plural, one {# day ago} other {# days ago}}", { count: days });
  return (thisYear(time) ? shortDate : shortDateYear).format(time);
}

function axisLabel(bucket: Span, interval: Interval, before: Span | undefined) {
  const date = new Date(bucket.start);
  const previous = before && zonedParts(before.start);
  if (interval === "hour") return !previous || previous.date !== zonedParts(date).date ? shortDate.format(date) : clock.format(date);
  if (interval === "month") {
    return !previous || previous.year !== zonedParts(date).year ? monthShortYear.format(date) : monthShort.format(date);
  }
  return (thisYear(bucket.start) ? shortDate : shortDateYear).format(date);
}

function tooltipLabel(bucket: Span, interval: Interval) {
  const date = new Date(bucket.start);
  const day = (thisYear(bucket.start) ? longDate : longDateYear).format(date);
  if (interval === "hour") return t("{date}, {time}", { date: day, time: clock.format(date) });
  if (interval === "day") return day;
  if (interval === "week") return t("Week of {date}", { date: (thisYear(bucket.start) ? shortDate : shortDateYear).format(date) });
  return monthYear.format(date);
}

function platform(id: AnalyticsPlatformId) {
  return ANALYTICS_PLATFORMS.find((item) => item.id === id)!;
}

function tween(target: () => number, duration = 650) {
  const [value, setValue] = createSignal(target());
  let frame = 0;
  createEffect(
    on(target, (next) => {
      cancelAnimationFrame(frame);
      const from = value();
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        setValue(from + (next - from) * (1 - (1 - progress) ** 3));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { defer: true }),
  );
  onCleanup(() => cancelAnimationFrame(frame));
  return value;
}

const SECTION_LABELS: Record<AnalyticsSection, string> = {
  overview: msg("Overview"),
  posts: msg("Posts"),
  platforms: msg("Platforms"),
  times: msg("Best times"),
};

const TIMES_DAYS = 182;

export function DashboardAnalyticsView(props: { section: AnalyticsSection; onSection(view: DashboardView): void }) {
  const auth = useAuth();
  const [opened, setOpened] = createSignal<AnalyticsPost | null>(null);
  createEffect(on(() => props.section, () => setOpened(null), { defer: true }));

  createEffect(() => loadSocialConnections(auth.user()?.id));
  createEffect(() => syncAnalytics(auth.user()?.id, socialConnections()));

  const range = analyticsRange;
  const metric = analyticsMetric;
  const span = createMemo(() => resolveRange(range()));
  // Networks send whole days, so nothing is shown hour by hour.
  const intervals = createMemo(() => {
    const list = INTERVALS.filter((item) => item.id !== "hour" && intervalsFor(span()).includes(item.id));
    return list.length ? list : INTERVALS.filter((item) => item.id === "day");
  });
  const interval = createMemo(() => {
    const choice = analyticsInterval();
    if (choice && intervals().some((item) => item.id === choice)) return choice;
    const fallback = defaultInterval(span());
    return fallback === "hour" ? "day" : fallback;
  });
  const sources = createMemo(() => analyticsSources(socialConnections(), { sample: auth.isGuest() }));
  const report = createMemo(() => analyticsReport(span(), interval(), sources()));
  const shown = createMemo(() => {
    const list = sources().filter((source) => !analyticsHidden().has(source.key));
    return list.length ? list : sources();
  });
  const shownKeys = createMemo(() => new Set(shown().map((source) => source.key)));
  const active = createMemo(() => ANALYTICS_PLATFORMS.filter((item) => shown().some((source) => source.platform === item.id)));
  const shownOf = (id: AnalyticsPlatformId) => shown().filter((source) => source.platform === id);

  const sumOf = (rows: Record<string, Totals>, list: readonly AnalyticsSource[]) => totals(list.map((source) => rows[source.key] ?? ZERO_TOTALS));
  const daily = createMemo(() =>
    report().buckets.map((_, index) => totals(shown().map((source) => report().series[source.key]?.[index] ?? ZERO_TOTALS))),
  );
  const current = createMemo(() => sumOf(report().totals, shown()));
  const previous = createMemo(() => sumOf(report().previous, shown()));
  const perPlatform = createMemo(() =>
    active()
      .map((item) => ({
        platform: item,
        totals: sumOf(report().totals, shownOf(item.id)),
        previous: sumOf(report().previous, shownOf(item.id)),
        daily: report().buckets.map((_, index) => totals(shownOf(item.id).map((source) => report().series[source.key]?.[index] ?? ZERO_TOTALS))),
        accounts: shownOf(item.id)
          .filter((source) => source.account)
          .map((source) => ({ source, totals: report().totals[source.key] ?? ZERO_TOTALS, previous: report().previous[source.key] ?? ZERO_TOTALS }))
          .sort((a, b) => b.totals.views - a.totals.views),
      }))
      .sort((a, b) => b.totals.views - a.totals.views),
  );

  const layers = createMemo(() =>
    active()
      .map((item) => {
        const list = shownOf(item.id);
        return {
          platform: item,
          values: report().buckets.map((_, index) => list.reduce((sum, source) => sum + (report().series[source.key]?.[index]?.[metric()] ?? 0), 0)),
          total: sumOf(report().totals, list)[metric()],
        };
      })
      .sort((a, b) => b.total - a.total),
  );

  const posts = createMemo(() => report().posts.filter((post) => shownKeys().has(post.source)));
  const loading = createMemo(() => sources().some((source) => syncState(source.key) === "loading"));
  const failures = createMemo(() =>
    sources().flatMap((source) => {
      const state = syncState(source.key);
      return state && state !== "loading" ? [{ source, message: state }] : [];
    }),
  );
  const timesSection = () => props.section === "times";
  const ranged = () => !opened() && sources().length > 0 && !timesSection();
  const timesPosts = createMemo(() => {
    if (!sources().length) return [];
    const now = Date.now();
    return analyticsReport({ start: now - TIMES_DAYS * DAY_MS, end: now }, "month", shown()).posts;
  });
  const compared = () => compareLabel(range());

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <DashboardPageHeader
        crumbs={
          opened()
            ? [
                { label: t(SECTION_LABELS[props.section]), icon: "analytics", onClick: () => setOpened(null) },
                { label: opened()!.title },
              ]
            : undefined
        }
      >
        <Show when={loading() && !opened()}>
          <span role="status" class="text-xs text-(--plane-text-placeholder)">
            {t("Loading your numbers…")}
          </span>
        </Show>
        <Show when={ranged() && intervals().length > 1 && props.section !== "posts"}>
          <Segmented
            label={t("Interval")}
            options={intervals().map((item) => ({ ...item, label: t(item.label) }))}
            value={interval()}
            onChange={setAnalyticsInterval}
            class="shrink-0"
          />
        </Show>
        <Show when={ranged()}>
          <AnalyticsRangePicker value={range()} onChange={setAnalyticsRange} />
        </Show>
      </DashboardPageHeader>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show when={opened()}>
          {(post) => <PostAnalytics post={post()} peers={posts()} onOpen={setOpened} />}
        </Show>
        <Show when={!opened()}>
          <div class="@container flex w-full flex-col gap-4 px-6 pt-6 pb-16">

            <For each={failures()}>
              {(failure) => (
                <div class="flex items-center gap-2.5 rounded-lg border border-(--plane-border-subtle) bg-(--plane-layer-1) py-1.5 pr-1.5 pl-3 text-xs">
                  <Icon name="alert-warning" class="size-4 shrink-0 text-(--plane-text-tertiary)" />
                  <p class="min-w-0 flex-1 truncate text-muted-foreground" title={t(failure.message)}>
                    <span class="text-foreground">
                      {platform(failure.source.platform).name}
                      {failure.source.handle ? ` ${accountLabel(failure.source)}` : ""}
                    </span>
                    {" "}
                    {t(failure.message)}
                  </p>
                  <button
                    type="button"
                    class="h-6 shrink-0 rounded-md px-2 text-xs font-medium text-foreground hover:bg-(--plane-layer-transparent-hover) focus-ring"
                    onClick={() => props.onSection("connections")}
                  >
                    {t("Open Connections")}
                  </button>
                </div>
              )}
            </For>

            <Show when={sources().length > 0 && props.section === "overview"}>
              <KpiStrip
                cells={[
                  ...ANALYTICS_METRICS.map((item) => ({
                    id: item.id,
                    label: t(item.label),
                    value: current()[item.id],
                    format: compactNumber,
                    delta: change(current()[item.id], previous()[item.id]),
                    spark: daily().map((row) => row[item.id]),
                  })),
                  {
                    id: "engagement",
                    label: t("Engagement"),
                    value: engagement(current()),
                    format: (value: number) => percent(value, 2),
                    delta: change(engagement(current()), engagement(previous())),
                    spark: daily().map(engagement),
                    title: t("Likes and comments for every view"),
                  },
                ]}
                selected={metric()}
                onSelect={(id) => setAnalyticsMetric(id as AnalyticsMetric)}
                compared={compared()}
                live={report().live}
              />

              <section class={`${card} flex flex-col`}>
                <div class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3.5">
                  <h2 class="text-sm font-medium text-foreground">{t(ANALYTICS_METRICS.find((item) => item.id === metric())!.label)}</h2>
                  <span class="flex-1" />
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <For each={layers()}>
                      {(layer) => (
                        <span
                          class="flex items-center gap-1.5 text-xs text-muted-foreground"
                          title={layer.platform.id === "tiktok" ? t("TikTok counts each video on the day it went out") : undefined}
                        >
                          <span class="size-2 rounded-full" style={{ background: layer.platform.color }} />
                          {layer.platform.name}
                          <span class="tabular-nums text-foreground">{compactNumber(layer.total)}</span>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
                <TrendChart
                  buckets={report().buckets}
                  live={report().live}
                  layers={layers()}
                  empty={t(EMPTY_RANGE[metric()])}
                  axisLabel={(bucket, before) => axisLabel(bucket, interval(), before)}
                  tooltipLabel={(bucket, last) =>
                    last && report().live ? t("{date}, so far", { date: tooltipLabel(bucket, interval()) }) : tooltipLabel(bucket, interval())
                  }
                />
              </section>

              <div class="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <PostsTable posts={posts()} onOpen={setOpened} limit={5} title={t("Top posts")} onSeeAll={() => props.onSection("analytics-posts")} />
                <BestTimesSummary posts={timesPosts()} onOpen={() => props.onSection("analytics-times")} />
              </div>
            </Show>

            <Show when={sources().length > 0 && props.section === "posts"}>
              <PostsTable posts={posts()} onOpen={setOpened} />
            </Show>

            <Show when={sources().length > 0 && props.section === "platforms"}>
              <div class="grid grid-cols-1 gap-4 @3xl:grid-cols-[repeat(auto-fit,minmax(22rem,1fr))]">
                <For each={perPlatform()}>
                  {(row) => (
                    <PlatformCard
                      row={row}
                      share={perPlatform().length > 1 && current().views ? row.totals.views / current().views : undefined}
                      compared={compared()}
                      live={report().live}
                    />
                  )}
                </For>
              </div>
            </Show>

            <Show when={sources().length > 0 && timesSection()}>
              <BestTimes posts={timesPosts()} />
            </Show>

            <Show when={!sources().length}>
              <div class="flex flex-col items-center gap-4 pt-6 text-center">
                <AnalyticsArt />
                <div class="flex flex-col gap-1">
                  <h2 class="text-sm font-medium text-foreground">{t("No numbers yet")}</h2>
                  <p class="max-w-md text-xs text-muted-foreground">
                    {t(
                      "Connect YouTube, TikTok, Instagram, Facebook or Threads to see its views, likes and comments here. Other networks show up once plan.video can read their numbers.",
                    )}
                  </p>
                </div>
                <Button class="px-3" onClick={() => props.onSection("connections")}>
                  {t("Open Connections")}
                </Button>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

const ZERO_TOTALS: Totals = { views: 0, likes: 0, comments: 0 };

function Delta(props: { value: number | undefined }) {
  const up = () => (props.value ?? 0) >= 0;
  return (
    <Show when={props.value !== undefined}>
      <span class="flex items-center gap-0.5 text-xs leading-4 tabular-nums" classList={{ "text-meter-green": up(), "text-meter-red": !up() }}>
        <Icon name="arrow-top" class={up() ? "size-4" : "size-4 rotate-180"} />
        {percent(Math.abs(props.value!))}
      </span>
    </Show>
  );
}

type KpiCell = {
  id: string;
  label: string;
  value: number;
  format(value: number): string;
  delta: number | undefined;
  spark: readonly number[];
  title?: string;
};

const KPI_EDGES = [
  "border-r border-b @3xl:border-b-0",
  "border-b @3xl:border-r @3xl:border-b-0",
  "border-r",
  "",
];

function KpiStrip(props: {
  cells: readonly KpiCell[];
  selected?: string;
  onSelect?(id: string): void;
  compared?: string;
  live?: boolean;
}) {
  const traced = () => props.cells.some((cell) => cell.spark.some((value) => value));
  return (
    <section class={`${card} grid grid-cols-2 overflow-hidden @3xl:grid-cols-4`}>
      <For each={props.cells}>
        {(cell, index) => {
          const shown = tween(() => cell.value);
          const selectable = () => !!props.onSelect && cell.id !== "engagement";
          const selected = () => selectable() && props.selected === cell.id;
          const body = (
            <>
              <Show when={selected()}>
                <span class="absolute inset-x-0 top-0 h-0.5 bg-primary" />
              </Show>
              <span class="flex w-full items-center gap-2">
                <span class={`truncate text-xs ${selected() ? "text-foreground" : "text-muted-foreground"}`} title={cell.title}>
                  {cell.label}
                </span>
                <span class="flex-1" />
                <span title={props.compared}>
                  <Delta value={cell.delta} />
                </span>
              </span>
              <span class="text-2xl leading-8 font-medium tracking-tight tabular-nums text-foreground">{cell.format(shown())}</span>
              <Show when={traced()}>
                <Sparkline values={cell.spark} color={selected() ? "var(--primary)" : "var(--plane-chart-muted)"} live={props.live} />
              </Show>
            </>
          );
          const edge = `relative flex min-w-0 flex-col gap-1 border-border-strong px-4 pt-3 pb-3 text-left ${KPI_EDGES[index()] ?? ""}`;
          return (
            <Show when={selectable()} fallback={<div class={edge}>{body}</div>}>
              <button
                type="button"
                aria-pressed={selected()}
                class={`${edge} transition-colors hover:bg-(--plane-layer-transparent-hover) focus-ring`}
                onClick={() => props.onSelect?.(cell.id)}
              >
                {body}
              </button>
            </Show>
          );
        }}
      </For>
    </section>
  );
}

function Sparkline(props: {
  values: readonly number[];
  color: string;
  /** The last value is today's, still coming in: left off rather than drawn as a fall. */
  live?: boolean;
}) {
  const id = `spark-${Math.random().toString(36).slice(2)}`;
  const valuesShown = () => (props.live && props.values.length > 2 ? props.values.slice(0, -1) : props.values);
  const path = createMemo(() => {
    const values = valuesShown();
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = values.map((value, index) => [
      (index / Math.max(1, values.length - 1)) * 100,
      28 - ((value - min) / span) * 24,
    ] as const);
    const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
    return { line, area: `${line} L100 32 L0 32 Z` };
  });

  const blank = () => valuesShown().every((value) => !value);
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      class="mt-1 h-8 w-full overflow-visible"
      classList={{ invisible: blank() }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color={props.color} stop-opacity="0.16" />
          <stop offset="100%" stop-color={props.color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={path().area} fill={`url(#${id})`} />
      <path
        d={path().line}
        fill="none"
        stroke={props.color}
        stroke-width="1.5"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
        class="transition-[stroke] duration-300"
      />
    </svg>
  );
}

type Layer = { platform: AnalyticsPlatform; values: readonly number[]; total: number };

const CHART_HEIGHT = 260;
const PAD = { top: 18, right: 16, bottom: 30, left: 52 };

/** Monotone cubic interpolation (Fritsch–Carlson): never overshoots a point. */
function tangents(xs: readonly number[], ys: readonly number[]) {
  const n = ys.length;
  const slopes = Array.from({ length: n - 1 }, (_, i) => (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  const m = ys.map((_, i) => (i === 0 ? slopes[0]! : i === n - 1 ? slopes[n - 2]! : slopes[i - 1]! * slopes[i]! <= 0 ? 0 : (slopes[i - 1]! + slopes[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slopes[i]!;
    const b = m[i + 1]! / slopes[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * slopes[i]!;
      m[i + 1] = tau * b * slopes[i]!;
    }
  }
  return m;
}

function curve(xs: readonly number[], ys: readonly number[], reverse: boolean) {
  const m = tangents(xs, ys);
  const f = (value: number) => value.toFixed(1);
  const parts: string[] = [];
  const n = xs.length;
  if (!reverse) {
    parts.push(`M${f(xs[0]!)} ${f(ys[0]!)}`);
    for (let i = 0; i < n - 1; i++) {
      const dx = (xs[i + 1]! - xs[i]!) / 3;
      parts.push(`C${f(xs[i]! + dx)} ${f(ys[i]! + m[i]! * dx)} ${f(xs[i + 1]! - dx)} ${f(ys[i + 1]! - m[i + 1]! * dx)} ${f(xs[i + 1]!)} ${f(ys[i + 1]!)}`);
    }
  } else {
    parts.push(`L${f(xs[n - 1]!)} ${f(ys[n - 1]!)}`);
    for (let i = n - 1; i > 0; i--) {
      const dx = (xs[i]! - xs[i - 1]!) / 3;
      parts.push(`C${f(xs[i]! - dx)} ${f(ys[i]! - m[i]! * dx)} ${f(xs[i - 1]! + dx)} ${f(ys[i - 1]! + m[i - 1]! * dx)} ${f(xs[i - 1]!)} ${f(ys[i - 1]!)}`);
    }
  }
  return parts.join(" ");
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const fraction = raw / power;
  const nice = [1, 2, 2.5, 5, 10].find((step) => step >= fraction) ?? 10;
  return nice * power;
}

function TrendChart(props: {
  buckets: readonly Span[];
  live: boolean;
  layers: readonly Layer[];
  empty?: string;
  axisLabel(bucket: Span, before: Span | undefined): string;
  tooltipLabel(bucket: Span, last: boolean): string;
}) {
  let plot: SVGGElement | undefined;
  const [width, setWidth] = createSignal(0);
  const [hover, setHover] = createSignal<number | null>(null);
  const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
  onCleanup(() => observer.disconnect());

  const n = () => Math.max(2, props.buckets.length);
  const bucketAt = (index: number) => Math.min(index, props.buckets.length - 1);
  const innerWidth = () => Math.max(1, width() - PAD.left - PAD.right);
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (index / (n() - 1)) * innerWidth();
  /** The last bucket is still filling: dashed on its own so a half day doesn't read as a fall. */
  const fading = () => props.live && props.buckets.length > 1;
  const clip = `analytics-${Math.random().toString(36).slice(2)}`;

  const stacks = createMemo(() => {
    let base = Array.from({ length: n() }, () => 0);
    return props.layers.map((layer) => {
      const top = base.map((value, index) => value + layer.values[bucketAt(index)]!);
      const result = { id: layer.platform.id, layer, bottom: base, top };
      base = top;
      return result;
    });
  });

  const blank = () => props.layers.every((layer) => layer.values.every((value) => !value));
  const scale = createMemo(() => {
    const peak = Math.max(1, ...(stacks().at(-1)?.top ?? [1]));
    const step = Math.max(1, niceStep(peak / 4));
    return { step, max: step * Math.ceil(peak / step) };
  });
  const y = (value: number) => PAD.top + innerHeight * (1 - value / scale().max);
  const ticks = createMemo(() => Array.from({ length: Math.round(scale().max / scale().step) + 1 }, (_, i) => i * scale().step));

  const shapes = createMemo(() => {
    const xs = Array.from({ length: n() }, (_, index) => x(index));
    return new Map(
      stacks().map((stack) => {
        const top = stack.top.map(y);
        const bottom = stack.bottom.map(y);
        const line = curve(xs, top, false);
        return [stack.id, { line, area: `${line} ${curve(xs, bottom, true)} Z`, top, color: stack.layer.platform.color }];
      }),
    );
  });

  const labels = createMemo(() => {
    const count = props.buckets.length;
    if (count <= 1) return [0];
    const wanted = Math.min(count, Math.max(2, Math.floor(innerWidth() / 90)));
    const step = Math.max(1, Math.round((count - 1) / (wanted - 1)));
    const indexes: number[] = [];
    for (let i = count - 1; i >= 0; i -= step) indexes.unshift(i);
    return indexes;
  });

  createEffect(
    on(
      () => `${props.buckets[0]?.start}:${props.buckets.length}`,
      () => {
        plot?.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], {
          duration: 900,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
      },
    ),
  );

  const move = (event: PointerEvent) => {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const position = (event.clientX - rect.left - PAD.left) / innerWidth();
    setHover(Math.max(0, Math.min(n() - 1, Math.round(position * (n() - 1)))));
  };

  const tooltip = createMemo(() => {
    const index = hover();
    if (index === null) return null;
    const rows = stacks()
      .map((stack) => ({ platform: stack.layer.platform, value: stack.layer.values[bucketAt(index)]! }))
      .sort((a, b) => b.value - a.value);
    return { index, rows, total: rows.reduce((sum, row) => sum + row.value, 0) };
  });

  const morph = (d: string) => `d: path("${d}"); transition: d 500ms cubic-bezier(0.22, 1, 0.36, 1);`;

  return (
    <Show
      when={!(blank() && props.empty)}
      fallback={<p class="px-4 pt-10 pb-12 text-center text-xs text-muted-foreground">{props.empty}</p>}
    >
      <div ref={(element) => observer.observe(element)} class="relative w-full select-none" style={{ height: `${CHART_HEIGHT}px` }}>
        <Show when={width() > 0}>
          <svg
            width={width()}
            height={CHART_HEIGHT}
            class="block overflow-visible"
            onPointerMove={move}
            onPointerLeave={() => setHover(null)}
            aria-label={t("Chart over time, stacked by platform")}
            role="img"
          >
            <defs>
              <For each={ANALYTICS_PLATFORMS}>
                {(item) => (
                  <linearGradient id={`analytics-fill-${item.id}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color={item.color} stop-opacity="0.2" />
                    <stop offset="100%" stop-color={item.color} stop-opacity="0.03" />
                  </linearGradient>
                )}
              </For>
              <clipPath id={`${clip}-done`}>
                <rect x="0" y="0" width={fading() ? x(n() - 2) : width()} height={CHART_HEIGHT} />
              </clipPath>
              <clipPath id={`${clip}-live`}>
                <rect x={x(n() - 2)} y="0" width={Math.max(0, width() - x(n() - 2))} height={CHART_HEIGHT} />
              </clipPath>
            </defs>

            <For each={ticks()}>
              {(tick) => (
                <g>
                  <line
                    x1={PAD.left}
                    x2={width() - PAD.right}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke="var(--plane-border-subtle)"
                    stroke-dasharray={tick === 0 ? undefined : "2 4"}
                  />
                  <text x={PAD.left - 10} y={y(tick)} dy="0.32em" text-anchor="end" class="fill-muted-foreground text-xxs tabular-nums">
                    {compactNumber(tick)}
                  </text>
                </g>
              )}
            </For>

            <g ref={plot}>
              <g clip-path={`url(#${clip}-done)`}>
                <For each={stacks().map((stack) => stack.id)}>
                  {(id) => {
                    const shape = () => shapes().get(id)!;
                    return (
                      <g>
                        <path d={shape().area} style={morph(shape().area)} fill={`url(#analytics-fill-${id})`} />
                        <path
                          d={shape().line}
                          style={morph(shape().line)}
                          fill="none"
                          stroke={shape().color}
                          stroke-width="1.5"
                          stroke-linejoin="round"
                        />
                      </g>
                    );
                  }}
                </For>
              </g>
              <Show when={fading()}>
                <g clip-path={`url(#${clip}-live)`} opacity="0.7">
                  <For each={stacks().map((stack) => stack.id)}>
                    {(id) => {
                      const shape = () => shapes().get(id)!;
                      return (
                        <path
                          d={shape().line}
                          style={morph(shape().line)}
                          fill="none"
                          stroke={shape().color}
                          stroke-width="1.5"
                          stroke-dasharray="3 3"
                          stroke-linejoin="round"
                        />
                      );
                    }}
                  </For>
                </g>
              </Show>
            </g>

            <For each={labels()}>
              {(index, position) => (
                <text
                  x={x(index)}
                  y={CHART_HEIGHT - 10}
                  text-anchor={index === 0 ? "start" : index === props.buckets.length - 1 ? "end" : "middle"}
                  class="fill-muted-foreground text-xxs"
                >
                  {props.axisLabel(props.buckets[index]!, position() ? props.buckets[labels()[position() - 1]!] : undefined)}
                </text>
              )}
            </For>

            <Show when={hover() !== null}>
              <line
                x1={x(hover()!)}
                x2={x(hover()!)}
                y1={PAD.top}
                y2={CHART_HEIGHT - PAD.bottom}
                stroke="var(--plane-border-strong-1)"
              />
              <For each={stacks().map((stack) => stack.id)}>
                {(id) => (
                  <circle
                    cx={x(hover()!)}
                    cy={shapes().get(id)!.top[hover()!]}
                    r="3.5"
                    fill={shapes().get(id)!.color}
                    stroke="var(--card)"
                    stroke-width="2"
                  />
                )}
              </For>
            </Show>
          </svg>
        </Show>

        <Show when={tooltip()}>
          {(tip) => {
            const left = () => x(tip().index);
            const flip = () => left() > width() - 200;
            return (
              <div
                class="pointer-events-none absolute top-3 z-10 w-44 rounded-xl border border-(--plane-border-strong) bg-popover/95 p-2.5 shadow-lg backdrop-blur-sm"
                style={{ left: `${flip() ? left() - 188 : left() + 12}px` }}
              >
                <p class="pb-1.5 text-xs text-muted-foreground">
                  {props.tooltipLabel(props.buckets[bucketAt(tip().index)]!, bucketAt(tip().index) === props.buckets.length - 1)}
                </p>
                <div class="flex flex-col gap-1">
                  <For each={tip().rows}>
                    {(row) => (
                      <div class="flex items-center gap-1.5 text-xs">
                        <span class="size-2 shrink-0 rounded-full" style={{ background: row.platform.color }} />
                        <span class="flex-1 text-muted-foreground">{row.platform.name}</span>
                        <span class="tabular-nums text-foreground">{fullNumber(row.value)}</span>
                      </div>
                    )}
                  </For>
                </div>
                <div class="mt-1.5 flex items-center border-t border-(--plane-border-subtle) pt-1.5 text-xs">
                  <span class="flex-1 text-muted-foreground">{t("Total")}</span>
                  <span class="font-medium tabular-nums text-foreground">{fullNumber(tip().total)}</span>
                </div>
              </div>
            );
          }}
        </Show>
      </div>
    </Show>
  );
}

type AccountRow = { source: AnalyticsSource; totals: Totals; previous: Totals };

function PostCover(props: { src: string | undefined }) {
  const [failed, setFailed] = createSignal(false);
  return (
    <Show when={props.src && !failed()}>
      <img
        src={props.src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        class="absolute inset-0 size-full object-cover"
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

function PostsTable(props: {
  posts: readonly AnalyticsPost[];
  onOpen(post: AnalyticsPost): void;
  limit?: number;
  title?: string;
  onSeeAll?(): void;
}) {
  const [sort, setSort] = createSignal<PostSort>("views");
  const score = (post: AnalyticsPost) => (sort() === "engagement" ? engagement(post) : post[sort() as AnalyticsMetric]);
  const sorted = createMemo(() => [...props.posts].sort((a, b) => score(b) - score(a)));
  const shown = () => (props.limit ? sorted().slice(0, props.limit) : sorted());
  const cell = (id: PostSort) => `w-20 shrink-0 text-right text-xs tabular-nums ${sort() === id ? "text-foreground" : "text-muted-foreground"}`;

  return (
    <section class={`${card} flex min-w-0 flex-col`}>
      <Show when={props.title}>
        <div class="flex items-center gap-3 px-4 pt-3.5 pb-3">
          <h2 class="min-w-0 flex-1 text-sm font-medium text-foreground">{props.title}</h2>
          <Show when={props.limit && props.onSeeAll && sorted().length > props.limit}>
            <button
              type="button"
              class="flex h-6 items-center gap-0.5 rounded-md pr-1 pl-2 text-xs text-muted-foreground hover:bg-(--plane-layer-transparent-hover) hover:text-foreground focus-ring"
              onClick={() => props.onSeeAll?.()}
            >
              {t("See all {count}", { count: sorted().length })}
              <Icon name="chevron-right" class="size-4" />
            </button>
          </Show>
        </div>
      </Show>
      <Show when={props.posts.length} fallback={<p class="py-12 text-center text-xs text-muted-foreground">{t("No posts in this range.")}</p>}>
        <div class="overflow-x-auto">
          <div class="flex min-w-[40rem] flex-col">
            <div class="flex items-center gap-3 border-b border-border-strong py-2 pr-4 pl-4 text-xs text-muted-foreground" classList={{ "border-t": !!props.title }}>
              <span class="flex-1">{t({ message: "Post", context: "noun" })}</span>
              <For each={POST_SORTS}>
                {(option) => (
                  <button
                    type="button"
                    aria-pressed={sort() === option.id}
                    class={`flex w-20 shrink-0 items-center justify-end gap-0.5 rounded-sm text-right hover:text-foreground focus-ring ${sort() === option.id ? "text-foreground" : ""}`}
                    onClick={() => setSort(option.id)}
                  >
                    <Show when={sort() === option.id}>
                      <Icon name="arrow-top" class="size-3.5 rotate-180" />
                    </Show>
                    {t(option.label)}
                  </button>
                )}
              </For>
            </div>
            <For each={shown()}>
              {(post) => {
                const item = platform(post.platform);
                return (
                  <button
                    type="button"
                    class="group flex w-full items-center gap-3 border-b border-border-strong py-2 pr-4 pl-4 text-left last:border-b-0 hover:bg-(--plane-layer-transparent-hover) focus-ring"
                    onClick={() => props.onOpen(post)}
                  >
                    <div class="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        class="relative grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-inset ring-(--plane-border-subtle)"
                        style={{
                          background: `radial-gradient(90% 120% at 30% 0%, color-mix(in srgb, ${item.color} 55%, transparent), color-mix(in srgb, ${item.color} 10%, #0b0b0b))`,
                        }}
                      >
                        <Icon name="play" class="size-4 text-white/80" />
                        <PostCover src={post.cover} />
                        {/* YouTube's icon may not sit on a picture, so it goes beside the title instead. */}
                        <Show when={post.platform !== "youtube"}>
                          <PlatformLogo id={post.platform} class="absolute bottom-1 left-1 size-3 rounded-sm" />
                        </Show>
                      </span>
                      <Show when={post.platform === "youtube"}>
                        <PlatformLogo id={post.platform} class="size-4" bare />
                      </Show>
                      <div class="flex min-w-0 flex-col">
                        <span class="truncate text-xs text-foreground">{post.title}</span>
                        <span class="truncate text-xs text-muted-foreground">
                          {post.handle ? `${accountLabel(post)}, ` : ""}
                          {ago(post.postedAt)}
                        </span>
                      </div>
                    </div>
                    <span class={cell("views")}>{compactNumber(post.views)}</span>
                    <span class={cell("likes")}>{compactNumber(post.likes)}</span>
                    <span class={cell("comments")}>{compactNumber(post.comments)}</span>
                    <span class={cell("engagement")}>{percent(engagement(post))}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}

function PlatformCard(props: {
  row: { platform: AnalyticsPlatform; totals: Totals; previous: Totals; daily: readonly Totals[]; accounts: readonly AccountRow[] };
  share: number | undefined;
  compared: string;
  live: boolean;
}) {
  const handles = () => props.row.accounts.map((account) => accountLabel(account.source)).join(", ");
  /** Only Instagram, Facebook and Threads report followers. */
  const followers = () => {
    const known = props.row.accounts.map((account) => followersOf(account.source.key)).filter((count): count is number => count !== null);
    return known.length ? known.reduce((sum, count) => sum + count, 0) : null;
  };
  const stat = "flex min-w-0 flex-col";
  return (
    <section class={`${card} flex min-w-0 flex-col gap-3 p-4`}>
      <div class="flex min-w-0 items-center gap-2">
        <PlatformLogo id={props.row.platform.id} class="size-5 rounded-md" bare />
        <h2 class="shrink-0 text-sm font-medium text-foreground">{props.row.platform.name}</h2>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{handles()}</span>
        <Show when={followers() !== null}>
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{t("{count} followers", { count: compactNumber(followers()!) })}</span>
        </Show>
      </div>
      <div class="flex items-end gap-2">
        <span class="text-2xl leading-none font-medium tabular-nums tracking-tight text-foreground">{compactNumber(props.row.totals.views)}</span>
        <span class="pb-0.5 text-xs text-muted-foreground">{t("views")}</span>
        <span class="flex-1" />
        <span title={props.compared}>
          <Delta value={change(props.row.totals.views, props.row.previous.views)} />
        </span>
      </div>
      <Sparkline values={props.row.daily.map((day) => day.views)} color={props.row.platform.color} live={props.live} />
      <div class="grid grid-cols-3 gap-3 border-t border-border-strong pt-3">
        <div class={stat}>
          <span class="text-xs text-muted-foreground">{t("Likes")}</span>
          <span class="text-sm tabular-nums text-foreground">{compactNumber(props.row.totals.likes)}</span>
        </div>
        <div class={stat}>
          <span class="text-xs text-muted-foreground">{t("Comments")}</span>
          <span class="text-sm tabular-nums text-foreground">{compactNumber(props.row.totals.comments)}</span>
        </div>
        <div class={stat}>
          <span class="text-xs text-muted-foreground">{t("Engagement")}</span>
          <span class="text-sm tabular-nums text-foreground">{percent(engagement(props.row.totals), 2)}</span>
        </div>
      </div>
      <Show when={props.row.accounts.length > 1}>
        <div class="flex flex-col gap-1.5 border-t border-border-strong pt-3">
          <For each={props.row.accounts}>
            {(account) => (
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate text-foreground">{accountLabel(account.source)}</span>
                <span class="tabular-nums text-muted-foreground">{t("{views} views", { views: compactNumber(account.totals.views) })}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.share !== undefined}>
        <div class="flex items-center gap-2">
          <span class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-(--plane-fill-subtle)">
            <span class="block h-full rounded-full" style={{ width: `${Math.round(props.share! * 100)}%`, background: props.row.platform.color }} />
          </span>
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{t("{percent} of views", { percent: percent(props.share!, 0) })}</span>
        </div>
      </Show>
    </section>
  );
}

function postLink(post: AnalyticsPost) {
  if (post.url) return post.url;
  if (!post.networkId) return undefined;
  if (post.platform === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(post.networkId)}`;
  if (post.platform === "tiktok" && post.handle) return `https://www.tiktok.com/@${encodeURIComponent(post.handle)}/video/${encodeURIComponent(post.networkId)}`;
  return undefined;
}

const postedDate = zonedFormat({ weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }, "en");

const POST_BY_POST: Record<AnalyticsMetric, string> = {
  views: msg("Views, post by post"),
  likes: msg("Likes, post by post"),
  comments: msg("Comments, post by post"),
};

const MOST_BARS = 24;

function PostAnalytics(props: { post: AnalyticsPost; peers: readonly AnalyticsPost[]; onOpen(post: AnalyticsPost): void }) {
  const auth = useAuth();
  const [metric, setMetric] = createSignal<AnalyticsMetric>("views");
  const [days, setDays] = createSignal<ReadonlyMap<number, Totals>>(new Map());
  const [state, setState] = createSignal<"loading" | "ready" | string>("loading");
  /** TikTok reports a video's totals and nothing per day. */
  const counted = () => props.post.platform === "youtube";
  createEffect(
    on(
      () => props.post,
      (post) => {
        setDays(new Map());
        if (!counted()) return;
        if (!post.networkId) {
          setDays(samplePostDays(post));
          setState("ready");
          return;
        }
        setState("loading");
        loadPostDays(auth.user()?.id, post).then(
          (loaded) => {
            if (props.post !== post) return;
            setDays(loaded);
            setState("ready");
          },
          (error: unknown) => {
            if (props.post === post) setState(error instanceof Error ? error.message : msg("Couldn't load this post's days."));
          },
        );
      },
    ),
  );
  const timeline = createMemo(() => postTimeline(days(), props.post.postedAt));
  const item = () => platform(props.post.platform);
  const link = () => postLink(props.post);
  const siblings = createMemo(() => props.peers.filter((post) => post.source === props.post.source).sort((a, b) => a.postedAt - b.postedAt));
  const typical = createMemo(() => {
    const list = props.peers.filter((post) => post.id !== props.post.id && post.platform === props.post.platform);
    if (!list.length) return undefined;
    const row = totals(list);
    const count = list.length;
    return { views: row.views / count, likes: row.likes / count, comments: row.comments / count };
  });
  const spark = (id: AnalyticsMetric) => {
    const values = counted() ? timeline().series.map((row) => row[id]) : siblings().map((post) => post[id]);
    return values.length < 2 ? [values[0] ?? 0, values[0] ?? 0] : values;
  };
  const layers = createMemo(() => [
    {
      platform: item(),
      values: timeline().series.map((row) => row[metric()]),
      total: totals(timeline().series)[metric()],
    },
  ]);
  const note = () => {
    const current = state();
    if (current === "loading") return t("Loading its days from {network}", { network: item().name });
    return t(current);
  };
  const compared = () => (
    <PostsCompared post={props.post} posts={siblings()} metric={metric()} network={item().name} onOpen={props.onOpen} />
  );

  return (
    <div class="@container flex w-full flex-col gap-4 px-6 pt-6 pb-16">
      <div class="flex min-w-0 items-center gap-2">
        <PlatformLogo id={props.post.platform} class="size-5 rounded-md" bare />
        <h1 class="min-w-0 truncate text-[22px] leading-7 font-medium tracking-[-0.02em] text-foreground">{props.post.title}</h1>
        <span class="shrink-0 pt-1 text-xs text-muted-foreground">
          {props.post.handle ? `${accountLabel(props.post)}, ` : ""}
          {ago(props.post.postedAt)}
        </span>
        <span class="flex-1" />
        <Show when={link()}>
          {(href) => (
            <a
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-(--plane-layer-transparent-hover) hover:text-foreground focus-ring"
            >
              {t("Open on {network}", { network: item().name })}
              <Icon name="external-link" class="size-3.5" />
            </a>
          )}
        </Show>
      </div>

      <KpiStrip
        cells={[
          ...ANALYTICS_METRICS.map((entry) => ({
            id: entry.id,
            label: t(entry.label),
            value: props.post[entry.id],
            format: compactNumber,
            delta: typical() ? change(props.post[entry.id], typical()![entry.id]) : undefined,
            spark: spark(entry.id),
          })),
          {
            id: "engagement",
            label: t("Engagement"),
            value: engagement(props.post),
            format: (value: number) => (props.post.views ? percent(value, 2) : "—"),
            delta: typical() && props.post.views ? change(engagement(props.post), engagement(typical()!)) : undefined,
            spark: counted() ? timeline().series.map(engagement) : siblings().map(engagement),
            title: t("Likes and comments for every view"),
          },
        ]}
        selected={metric()}
        onSelect={(id) => setMetric(id as AnalyticsMetric)}
        compared={t("Compared with your other {network} posts in this range", { network: item().name })}
        live={counted() && timeline().live}
      />

      <div class="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Show when={counted()} fallback={compared()}>
          <section class={`${card} flex min-w-0 flex-col`}>
            <div class="flex items-center gap-3 px-4 pt-3.5">
              <h2 class="text-sm font-medium text-foreground">{t(SINCE_POSTED[metric()])}</h2>
              <Show when={state() !== "ready"}>
                <span class="text-xs text-muted-foreground">{note()}</span>
              </Show>
            </div>
            <TrendChart
              empty={state() === "ready" ? t("Nothing counted yet") : undefined}
              buckets={timeline().buckets}
              live={timeline().live}
              layers={layers()}
              axisLabel={(bucket, before) => axisLabel(bucket, timeline().interval, before)}
              tooltipLabel={(bucket, last) =>
                last && timeline().live ? t("{date}, so far", { date: tooltipLabel(bucket, timeline().interval) }) : tooltipLabel(bucket, timeline().interval)
              }
            />
          </section>
        </Show>
        <PostCard post={props.post} />
      </div>

      <Show when={counted()}>{compared()}</Show>
    </div>
  );
}

function PostCard(props: { post: AnalyticsPost }) {
  const item = () => platform(props.post.platform);
  return (
    <section class={`${card} flex min-w-0 flex-col overflow-hidden`}>
      <div
        class="relative grid min-h-56 flex-1 place-items-center overflow-hidden border-b border-border-strong"
        style={{
          background: `radial-gradient(90% 120% at 30% 0%, color-mix(in srgb, ${item().color} 45%, transparent), color-mix(in srgb, ${item().color} 8%, #0b0b0b))`,
        }}
      >
        <Icon name="play" class="size-6 text-white/70" />
        <PostCover src={props.post.cover} />
      </div>
      <div class="flex flex-col gap-3 px-4 pt-3 pb-3.5">
        <p class="line-clamp-3 text-sm text-foreground">{props.post.title}</p>
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
          <dt class="text-muted-foreground">{t("Account")}</dt>
          <dd class="flex min-w-0 items-center gap-1.5 text-foreground">
            <PlatformLogo id={props.post.platform} class="size-3.5 shrink-0 rounded-sm" bare />
            <span class="truncate">{accountLabel(props.post) || item().name}</span>
          </dd>
          <dt class="text-muted-foreground">{t("Posted")}</dt>
          <dd class="truncate text-foreground tabular-nums">{postedDate.format(props.post.postedAt)}</dd>
        </dl>
      </div>
    </section>
  );
}

function PostsCompared(props: {
  post: AnalyticsPost;
  posts: readonly AnalyticsPost[];
  metric: AnalyticsMetric;
  network: string;
  onOpen(post: AnalyticsPost): void;
}) {
  const value = (post: AnalyticsPost) => post[props.metric];
  const shown = createMemo(() => {
    const all = props.posts;
    if (all.length <= MOST_BARS) return all;
    const at = Math.max(0, all.findIndex((post) => post.id === props.post.id));
    const start = Math.max(0, Math.min(all.length - MOST_BARS, at - Math.floor(MOST_BARS / 2)));
    return all.slice(start, start + MOST_BARS);
  });
  const others = () => props.posts.filter((post) => post.id !== props.post.id);
  const average = () => (others().length ? others().reduce((sum, post) => sum + value(post), 0) / others().length : 0);
  const top = () => Math.max(1, ...shown().map(value), average());
  const rank = () => 1 + others().filter((post) => value(post) > value(props.post)).length;
  const ratio = () => (average() ? value(props.post) / average() : undefined);
  const height = (amount: number) => `${(amount / top()) * 100}%`;

  return (
    <section class={`${card} flex min-w-0 flex-col`}>
      <div class="flex items-center gap-3 px-4 pt-3.5">
        <h2 class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t(POST_BY_POST[props.metric])}</h2>
        <Show when={others().length}>
          <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
            {t("#{rank} of {count}", { rank: rank(), count: props.posts.length })}
            <Show when={ratio() !== undefined}>
              {" · "}
              {t("{ratio}× your average", { ratio: ratio()!.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) })}
            </Show>
          </span>
        </Show>
      </div>
      <Show
        when={others().length}
        fallback={
          <p class="grid flex-1 place-items-center px-4 py-16 text-center text-xs text-muted-foreground">
            {t("Nothing to set it against yet: it's the only {network} post on this account in this range.", { network: props.network })}
          </p>
        }
      >
        <div class="flex flex-1 flex-col px-4 pt-4 pb-3">
          <div class="relative flex min-h-52 flex-1 items-end gap-1.5">
            <div class="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/50" style={{ bottom: height(average()) }} />
            <For each={shown()}>
              {(post) => {
                const open = () => post.id === props.post.id;
                return (
                  <button
                    type="button"
                    aria-current={open() ? "true" : undefined}
                    aria-label={`${post.title}: ${fullNumber(value(post))}`}
                    title={`${post.title}\n${fullNumber(value(post))}`}
                    class="group relative flex min-w-1 flex-1 items-end justify-center self-stretch rounded-sm focus-ring"
                    onClick={() => !open() && props.onOpen(post)}
                  >
                    <span
                      class="block min-h-0.5 w-full max-w-12 rounded-t-sm transition-[height,background-color] duration-300"
                      classList={{ "bg-primary": open(), "bg-(--plane-chart-muted) group-hover:bg-muted-foreground": !open() }}
                      style={{ height: height(value(post)) }}
                    />
                  </button>
                );
              }}
            </For>
          </div>
          <div class="mt-2 flex gap-1.5 text-[11px] text-muted-foreground tabular-nums">
            <For each={shown()}>
              {(post, index) => (
                <span class="min-w-1 flex-1 truncate text-center">
                  {index() === 0 || index() === shown().length - 1 || post.id === props.post.id ? shortDate.format(post.postedAt) : ""}
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");
const hourLabel = (hour: number) => `${pad(hour)}:00`;
/** The posting queue counts weekdays from Sunday, like `Date`; Best times counts from Monday. */
const queueWeekday = (day: number) => (day + 1) % 7;

function BestTimesSummary(props: { posts: readonly AnalyticsPost[]; onOpen(): void }) {
  const times = createMemo(() => postingTimes(props.posts));
  const enough = () => times().posts >= ENOUGH_POSTS;
  const top = () => times().slots.slice(0, 5);
  const best = () => Math.max(1, ...top().map((slot) => slot.medianViews));

  return (
    <section class={`${card} flex min-w-0 flex-col`}>
      <div class="flex items-center gap-3 px-4 pt-3.5 pb-3">
        <h2 class="min-w-0 flex-1 text-sm font-medium text-foreground">{t("Best times")}</h2>
        <button
          type="button"
          class="flex h-6 items-center gap-0.5 rounded-md pr-1 pl-2 text-xs text-muted-foreground hover:bg-(--plane-layer-transparent-hover) hover:text-foreground focus-ring"
          onClick={() => props.onOpen()}
        >
          {t("More")}
          <Icon name="chevron-right" class="size-4" />
        </button>
      </div>
      <Show
        when={enough()}
        fallback={
          <p class="border-t border-border-strong px-4 py-6 text-xs text-muted-foreground">
            {times().posts
              ? t(
                  "With {count, plural, one {# post} other {# posts}} so far, there's not enough to compare. A few more and your best times show here.",
                  { count: times().posts },
                )
              : t("Once you've posted a few times, your best days and hours show here.")}
          </p>
        }
      >
        <div class="flex flex-col border-t border-border-strong">
          <For each={top()}>
            {(slot) => (
              <div class="flex items-center gap-3 border-b border-border-strong px-4 py-2.5 last:border-b-0">
                <span class="w-24 shrink-0 text-xs text-foreground">
                  {t(WEEKDAY_SHORT[slot.day])} {hourLabel(slot.hour)}
                </span>
                <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-(--plane-fill-subtle)">
                  <span class="block h-full rounded-full bg-primary" style={{ width: `${Math.round((slot.medianViews / best()) * 100)}%` }} />
                </span>
                <span class="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground" title={t("The middle post's views")}>
                  {compactNumber(slot.medianViews)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function WeekGrid(props: { slots: readonly (SlotStats & { day: number; hour: number })[] }) {
  const [hover, setHover] = createSignal<{ day: number; hour: number } | null>(null);
  const cells = createMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => null as (SlotStats & { day: number; hour: number }) | null));
    for (const slot of props.slots) grid[slot.day]![slot.hour] = slot;
    return grid;
  });
  const max = () => Math.max(1, ...props.slots.map((slot) => slot.medianViews));
  const best = () => props.slots[0];
  const readout = (): JSX.Element => {
    const at = hover();
    const slot = at ? cells()[at.day]![at.hour] : null;
    if (at && !slot) return t("{day} {time}: no posts then", { day: t(WEEKDAY_SHORT[at.day]), time: hourLabel(at.hour) });
    const shown = slot ?? best();
    if (!shown) return t("No posts yet");
    const figures = (text: string) => <span class="text-foreground">{text}</span>;
    return slot
      ? rich("{day} {time}: <figures>{views} typical views from {count, plural, one {# post} other {# posts}}</figures>", {
          day: t(WEEKDAY_SHORT[shown.day]),
          time: hourLabel(shown.hour),
          views: compactNumber(shown.medianViews),
          count: shown.posts,
          figures,
        })
      : rich("Best: <figures>{day} around {time}, {views} typical views from {count, plural, one {# post} other {# posts}}</figures>", {
          day: t(WEEKDAY_NAMES[shown.day]),
          time: hourLabel(shown.hour),
          views: compactNumber(shown.medianViews),
          count: shown.posts,
          figures,
        });
  };

  return (
    <section class={`${card} flex min-w-0 flex-col gap-3 p-4`}>
      <h2 class="text-sm font-medium text-foreground">{t("Best time to post")}</h2>
      <div
        class="grid grid-cols-[1.75rem_repeat(24,minmax(0,1fr))] grid-rows-[repeat(7,1.75rem)_auto] gap-[3px]"
        onPointerLeave={() => setHover(null)}
      >
        <For each={cells()}>
          {(row, day) => (
            <>
              <span class="flex items-center text-[11px] leading-none text-muted-foreground">{t(WEEKDAY_SHORT[day()])}</span>
              <For each={row}>
                {(slot, hour) => {
                  const hovered = () => hover()?.day === day() && hover()?.hour === hour();
                  const strength = () => (slot ? slot.medianViews / max() : 0);
                  return (
                    <span
                      class="rounded-sm transition-transform"
                      classList={{ "scale-125 ring-1 ring-(--plane-text-secondary)": hovered() }}
                      style={{
                        background: slot
                          ? `color-mix(in srgb, var(--primary) ${Math.round(18 + strength() ** 0.8 * 82)}%, var(--plane-fill-faint))`
                          : "var(--plane-fill-faint)",
                      }}
                      onPointerEnter={() => setHover({ day: day(), hour: hour() })}
                    />
                  );
                }}
              </For>
            </>
          )}
        </For>
        <span />
        <For each={[0, 6, 12, 18]}>
          {(value) => <span class="col-span-6 pt-1 text-[11px] leading-none text-muted-foreground">{hourLabel(value)}</span>}
        </For>
      </div>
      <div class="flex items-center gap-3 border-t border-border-strong pt-3">
        <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{readout()}</p>
        <span class="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          {t("Fewer views")}
          <span
            class="h-1.5 w-14 rounded-full"
            style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--primary) 18%, var(--plane-fill-faint)), var(--primary))" }}
          />
          {t("More")}
        </span>
      </div>
    </section>
  );
}

function BestTimes(props: { posts: readonly AnalyticsPost[] }) {
  const auth = useAuth();
  createEffect(() => loadQueueSlots(auth.ownerId()));
  const times = createMemo(() => postingTimes(props.posts));
  const enough = () => times().posts >= ENOUGH_POSTS;
  const bestDay = () => [...times().weekdays].filter((slot) => slot.posts).sort((a, b) => b.medianViews - a.medianViews)[0];
  const bestHour = () => [...times().hours].filter((slot) => slot.posts).sort((a, b) => b.medianViews - a.medianViews)[0];
  const slots = () => times().slots.slice(0, 5);

  const queued = (slot: { day: number; hour: number }) =>
    queueSlots().some((entry) => entry.weekday === queueWeekday(slot.day) && entry.time === hourLabel(slot.hour));
  const add = (slot: { day: number; hour: number }) => {
    const userId = auth.ownerId();
    if (!userId) return;
    if (addQueueSlots(userId, [queueWeekday(slot.day)], hourLabel(slot.hour))) toast.success(t("Added to your posting queue"));
    else toast.error(t("Your posting queue is full"));
  };

  return (
    <Show
      when={times().posts}
      fallback={
        <div class={`${card} px-4 py-12 text-center text-xs text-muted-foreground`}>
          {t("No posts in the last six months yet. Once you've posted a few times, this shows which days and hours do best.")}
        </div>
      }
    >
      <KpiStrip
        cells={[
          {
            id: "day",
            label: t("Best day"),
            value: 0,
            format: () => (enough() && bestDay() ? t(WEEKDAY_NAMES[bestDay()!.day]!) : t("Not yet")),
            delta: undefined,
            spark: [],
          },
          {
            id: "hour",
            label: t("Best hour"),
            value: 0,
            format: () => (enough() && bestHour() ? hourLabel(bestHour()!.hour) : t("Not yet")),
            delta: undefined,
            spark: [],
          },
          {
            id: "median",
            label: t("Typical views then"),
            value: enough() ? (bestDay()?.medianViews ?? 0) : 0,
            format: (value) => (enough() ? compactNumber(value) : "–"),
            delta: undefined,
            spark: [],
            title: t("The middle post's views on your best day: half did better, half did worse"),
          },
          {
            id: "posts",
            label: t("Posts read"),
            value: times().posts,
            format: (value) => fullNumber(Math.round(value)),
            delta: undefined,
            spark: [],
            title: t("Your posts from the last six months, in your time zone"),
          },
        ]}
      />

      <WeekGrid slots={times().slots} />

      <section class={`${card} flex min-w-0 flex-col`}>
        <div class="px-4 pt-3.5 pb-3">
          <h2 class="text-sm font-medium text-foreground">{t("Your best slots")}</h2>
        </div>
        <div class="flex flex-col border-t border-border-strong">
          <For each={slots()}>
            {(slot) => (
              <div class="flex items-center gap-3 border-b border-border-strong px-4 py-2 last:border-b-0">
                <span class="w-36 shrink-0 text-xs text-foreground">
                  {t("{day} at {time}", { day: t(WEEKDAY_NAMES[slot.day]), time: hourLabel(slot.hour) })}
                </span>
                <span class="min-w-0 flex-1 text-xs tabular-nums text-muted-foreground">
                  {t("{views} views, {count, plural, one {# post} other {# posts}}", { views: compactNumber(slot.medianViews), count: slot.posts })}
                </span>
                <Show
                  when={!queued(slot)}
                  fallback={
                    <span class="flex h-7 shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground">
                      <Icon name="confirm-check" class="size-4" />
                      {t("In your queue")}
                    </span>
                  }
                >
                  <button
                    type="button"
                    disabled={!auth.ownerId()}
                    class="h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-(--plane-layer-transparent-hover) hover:text-foreground disabled:opacity-50 focus-ring"
                    onClick={() => add(slot)}
                  >
                    {t("Add to queue")}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

