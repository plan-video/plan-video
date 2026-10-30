/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Small drawings for empty pages, in the homepage hero's language: cards and
// clips in the timeline's colours, the brand blue for what matters. Colours
// come from the `--art-*` tokens, so they follow the dashboard's theme.

import { For, type JSX } from "solid-js";

import { cx } from "@/lib/cva";

const CARD = "fill-(--art-card) stroke-(--art-card-edge)";
const LINE = "fill-(--art-line)";
const LINE_SOFT = "fill-(--art-line-soft)";
const ACCENT = "fill-(--plane-accent-primary)";

/** Decoration beside text that already says it all, so screen readers skip it. */
function Art(props: { class?: string; children: JSX.Element }) {
  return (
    <svg viewBox="0 0 240 132" fill="none" aria-hidden="true" class={cx("h-auto w-[240px] max-w-full shrink-0", props.class)}>
      {props.children}
    </svg>
  );
}

/** A play triangle centred on (x, y). */
function Play(props: { x: number; y: number; size?: number; class: string }) {
  const size = () => props.size ?? 7;
  return <path class={props.class} d={`M${props.x - size() * 0.45} ${props.y - size() * 0.6}L${props.x + size() * 0.65} ${props.y}L${props.x - size() * 0.45} ${props.y + size() * 0.6}Z`} />;
}

/** Templates: a post set up once, with a copy behind it. */
export function TemplatesArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <g opacity="0.55">
        <rect x="76.5" y="8.5" width="128" height="94" rx="10" class={CARD} />
        <rect x="88" y="20" width="30" height="40" rx="5" class="fill-(--art-text)" />
        <rect x="126" y="24" width="52" height="5" rx="2.5" class={LINE} />
        <rect x="126" y="35" width="62" height="4" rx="2" class={LINE_SOFT} />
      </g>
      <rect x="40.5" y="28.5" width="128" height="94" rx="10" class={CARD} />
      <rect x="52" y="40" width="30" height="40" rx="5" class="fill-(--art-video)" />
      <Play x={67} y={60} class="fill-(--art-video-ink)" />
      <rect x="90" y="44" width="58" height="6" rx="3" class={LINE} />
      <rect x="90" y="56" width="66" height="4" rx="2" class={LINE_SOFT} />
      <rect x="90" y="64" width="46" height="4" rx="2" class={LINE_SOFT} />
      <rect x="52" y="92" width="10" height="10" rx="3" class="fill-(--art-video-ink)" />
      <rect x="66" y="92" width="10" height="10" rx="3" class="fill-(--art-audio-ink)" />
      <rect x="80" y="92" width="10" height="10" rx="3" class={ACCENT} />
      <rect x="114" y="90" width="42" height="14" rx="7" class={ACCENT} fill-opacity="0.16" />
      <circle cx="123" cy="97" r="3.25" class="stroke-(--plane-accent-primary)" stroke-width="1.4" />
      <rect x="130" y="95.5" width="19" height="3" rx="1.5" class={ACCENT} />
    </Art>
  );
}

/** A `#` of strokes, its box starting at (x, y). */
function Hash(props: { x: number; y: number }) {
  return (
    <path
      class="stroke-(--plane-accent-primary)"
      stroke-width="1.3"
      stroke-linecap="round"
      d={`M${props.x + 2} ${props.y}l-1 6M${props.x + 5} ${props.y}l-1 6M${props.x} ${props.y + 2}h6M${props.x - 0.5} ${props.y + 4}h6`}
    />
  );
}

/** Vault: a caption with its hashtags, and a snippet kept beside it. */
export function VaultArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <rect x="30.5" y="16.5" width="156" height="88" rx="10" class={CARD} />
      <rect x="44" y="30" width="96" height="5" rx="2.5" class={LINE} />
      <rect x="44" y="41" width="122" height="5" rx="2.5" class={LINE_SOFT} />
      <rect x="44" y="52" width="84" height="5" rx="2.5" class={LINE_SOFT} />
      <For each={[{ x: 44, w: 38 }, { x: 86, w: 46 }]}>
        {(chip) => (
          <>
            <rect x={chip.x} y="68" width={chip.w} height="16" rx="8" class={ACCENT} fill-opacity="0.16" />
            <Hash x={chip.x + 7} y={73} />
            <rect x={chip.x + 16} y="74.5" width={chip.w - 23} height="3" rx="1.5" class={ACCENT} fill-opacity="0.7" />
          </>
        )}
      </For>
      <rect x="148.5" y="74.5" width="70" height="44" rx="9" class={CARD} />
      <rect x="158" y="85" width="4" height="22" rx="2" class="fill-(--art-audio-ink)" />
      <rect x="168" y="87" width="40" height="4" rx="2" class={LINE} />
      <rect x="168" y="97" width="28" height="4" rx="2" class={LINE_SOFT} />
    </Art>
  );
}

const PEAKS = [0.35, 0.6, 0.9, 0.55, 0.8, 1, 0.65, 0.4, 0.75, 0.5, 0.3];

/** Media: a picture, a sound and a video, fanned out evenly either side. */
export function MediaArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <g transform="rotate(-7 51 66)">
        <rect x="22" y="30" width="58" height="72" rx="8" class="fill-(--art-text)" />
        <circle cx="38" cy="48" r="6" class="fill-(--art-text-ink)" fill-opacity="0.75" />
        <path d="M22 92 L42 70 L54 82 L64 72 L80 88 V94 A8 8 0 0 1 72 102 H30 A8 8 0 0 1 22 94Z" class="fill-(--art-text-ink)" fill-opacity="0.45" />
      </g>
      <g transform="rotate(7 190 66)">
        <rect x="161" y="30" width="58" height="72" rx="8" class="fill-(--art-audio)" />
        <For each={PEAKS}>
          {(peak, index) => (
            <rect x={168.8 + index() * 4} y={66 - peak * 17} width="2.4" height={peak * 34} rx="1.2" class="fill-(--art-audio-ink)" />
          )}
        </For>
      </g>
      <rect x="90.5" y="12.5" width="60" height="106" rx="9" class="fill-(--art-video) stroke-(--art-card-edge)" />
      <circle cx="120.5" cy="62" r="13" class="fill-(--art-video-ink)" fill-opacity="0.22" />
      <Play x={121.5} y={62} size={9} class="fill-(--art-video-ink)" />
      <rect x="98" y="104" width="22" height="7" rx="3.5" class="fill-(--art-video-ink)" fill-opacity="0.35" />
    </Art>
  );
}

/** Projects: a video being edited, with its clips, sound and words on a timeline and the playhead over them. */
export function ProjectsArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <rect x="40.5" y="8.5" width="160" height="116" rx="10" class={CARD} />
      <rect x="52" y="20" width="62" height="44" rx="5" class="fill-(--art-video)" />
      <Play x={83} y={42} class="fill-(--art-video-ink)" />
      <rect x="122" y="24" width="52" height="5" rx="2.5" class={LINE} />
      <rect x="122" y="35" width="66" height="4" rx="2" class={LINE_SOFT} />
      <rect x="122" y="44" width="40" height="4" rx="2" class={LINE_SOFT} />
      <rect x="52" y="76" width="54" height="10" rx="3" class="fill-(--art-video)" />
      <rect x="109" y="76" width="44" height="10" rx="3" class="fill-(--art-video)" />
      <rect x="52" y="90" width="101" height="10" rx="3" class="fill-(--art-audio)" />
      <For each={PEAKS}>
        {(peak, index) => <rect x={56 + index() * 8.6} y={95 - peak * 3.5} width="2.4" height={peak * 7} rx="1.2" class="fill-(--art-audio-ink)" />}
      </For>
      <rect x="70" y="104" width="46" height="10" rx="3" class="fill-(--art-text)" />
      <rect x="128" y="70" width="2" height="48" rx="1" class={ACCENT} />
      <circle cx="129" cy="70" r="3" class={ACCENT} />
    </Art>
  );
}

/** A folder: two projects tucked inside, a selected one dragged in on the pointer. */
export function FolderArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <path d="M48.5 34.5a8 8 0 0 1 8-8h30l9 9h88a8 8 0 0 1 8 8v73a8 8 0 0 1-8 8h-127a8 8 0 0 1-8-8Z" class={CARD} />
      <g transform="rotate(-6 92 66)">
        <rect x="66" y="46" width="52" height="40" rx="5" class="fill-(--art-video)" />
        <Play x={92} y={62} class="fill-(--art-video-ink)" />
      </g>
      <g transform="rotate(5 140 64)">
        <rect x="114" y="44" width="52" height="40" rx="5" class="fill-(--art-text)" />
        <rect x="122" y="52" width="22" height="4" rx="2" class="fill-(--art-text-ink)" fill-opacity="0.6" />
      </g>
      <rect x="40.5" y="70.5" width="160" height="54" rx="8" class={CARD} />
      <rect x="54" y="106" width="44" height="5" rx="2.5" class={LINE} />
      <g transform="rotate(8 178 30)">
        <rect x="156.5" y="12.5" width="44" height="33" rx="5" class="fill-(--art-video) stroke-(--plane-accent-primary)" stroke-width="1.5" />
        <Play x={178.5} y={29} size={6} class="fill-(--art-video-ink)" />
      </g>
      <path d="M193 40l0 15.5 3.9-3.7 2.7 6 2.6-1.2-2.7-5.9 5.4-.3Z" class={ACCENT} stroke="var(--art-card)" stroke-width="1.2" stroke-linejoin="round" />
    </Art>
  );
}

/** Plugs: a post that took off, and the plug posted under it. */
export function PlugsArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <rect x="26.5" y="10.5" width="114" height="92" rx="10" class={CARD} />
      <rect x="38" y="22" width="90" height="38" rx="6" class="fill-(--art-video)" />
      <Play x={84} y={41} class="fill-(--art-video-ink)" />
      <rect x="38" y="68" width="64" height="5" rx="2.5" class={LINE} />
      <rect x="38" y="82" width="44" height="13" rx="6.5" class={ACCENT} fill-opacity="0.16" />
      <path
        d="M47.5 92.2l-3.4-3.3a2.1 2.1 0 0 1 3-3l.4.4.4-.4a2.1 2.1 0 0 1 3 3z"
        class={ACCENT}
      />
      <rect x="55" y="87" width="20" height="3" rx="1.5" class={ACCENT} fill-opacity="0.7" />
      <rect x="112.5" y="76.5" width="96" height="42" rx="10" class="fill-(--art-card) stroke-(--plane-accent-primary)" />
      <circle cx="128" cy="97.5" r="7" class={ACCENT} />
      <rect x="141" y="90" width="52" height="4" rx="2" class={LINE} />
      <rect x="141" y="100" width="36" height="4" rx="2" class={LINE_SOFT} />
    </Art>
  );
}

const WEEK = 7;

/** The calendar: a week with a few posts on it. */
export function PostsArt(props: { class?: string }) {
  const column = 200 / WEEK;
  const chips: { day: number; top: number; height: number; tone: "video" | "audio" | "text" | "accent" }[] = [
    { day: 0, top: 40, height: 20, tone: "video" },
    { day: 1, top: 70, height: 24, tone: "audio" },
    { day: 2, top: 46, height: 18, tone: "text" },
    { day: 3, top: 76, height: 22, tone: "accent" },
    { day: 4, top: 52, height: 24, tone: "video" },
    { day: 5, top: 84, height: 18, tone: "text" },
  ];
  const fill = (tone: string) =>
    tone === "accent" ? "fill-(--plane-accent-primary)" : tone === "video" ? "fill-(--art-video)" : tone === "audio" ? "fill-(--art-audio)" : "fill-(--art-text)";
  const ink = (tone: string) =>
    tone === "accent" ? "fill-(--plane-accent-primary)" : tone === "video" ? "fill-(--art-video-ink)" : tone === "audio" ? "fill-(--art-audio-ink)" : "fill-(--art-text-ink)";

  return (
    <Art class={props.class}>
      <rect x="20.5" y="12.5" width="200" height="108" rx="10" class={CARD} />
      <For each={Array.from({ length: WEEK }, (_, day) => day)}>
        {(day) => (
          <>
            <rect x={20 + day * column + column / 2 - 6} y="20" width="12" height="4" rx="2" class={LINE} />
            {day > 0 ? <rect x={20 + day * column} y="31" width="0.8" height="89" class={LINE_SOFT} /> : null}
          </>
        )}
      </For>
      <rect x="21" y="31" width="199" height="0.8" class={LINE_SOFT} />
      <For each={chips}>
        {(chip) => (
          <>
            <rect
              x={20 + chip.day * column + 3}
              y={chip.top}
              width={column - 6}
              height={chip.height}
              rx="4"
              class={fill(chip.tone)}
              fill-opacity={chip.tone === "accent" ? 0.16 : 1}
              stroke={chip.tone === "accent" ? "var(--plane-accent-primary)" : undefined}
            />
            <rect x={20 + chip.day * column + 7} y={chip.top + 5} width={column - 16} height="3" rx="1.5" class={ink(chip.tone)} fill-opacity="0.8" />
          </>
        )}
      </For>
    </Art>
  );
}

/** Inbox: every notice read, with a check on top. */
export function InboxArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <rect x="44.5" y="18.5" width="148" height="98" rx="10" class={CARD} />
      <g opacity="0.6">
        <For each={[34, 62, 90]}>
          {(top, index) => (
            <>
              <circle cx="63" cy={top + 6} r="7" class="fill-(--art-text)" />
              <rect x="78" y={top} width={index() === 1 ? 62 : 80} height="5" rx="2.5" class={LINE} />
              <rect x="78" y={top + 10} width={index() === 2 ? 38 : 52} height="4" rx="2" class={LINE_SOFT} />
              {index() < 2 ? <rect x="54" y={top + 21} width="128" height="0.8" class={LINE_SOFT} /> : null}
            </>
          )}
        </For>
      </g>
      <circle cx="188" cy="24" r="15" class="fill-(--art-audio-ink) stroke-(--plane-surface-1)" stroke-width="3" />
      <path d="M181.5 24.5l4.5 4.5 8.5-9" stroke="white" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    </Art>
  );
}

/** Trash: an empty bin, a project lifting back out of it. */
export function TrashArt(props: { class?: string }) {
  return (
    <Art class={props.class}>
      <rect x="40.5" y="12.5" width="160" height="108" rx="12" class="stroke-(--art-line)" stroke-dasharray="5 5" />
      <path d="M112 44v-3a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3" class="stroke-(--art-text-ink)" stroke-width="2" opacity="0.6" />
      <rect x="98" y="44" width="44" height="6" rx="3" class="fill-(--art-text-ink)" opacity="0.6" />
      <path d="M103 54h34l-3 37a5 5 0 0 1-5 4.6h-18a5 5 0 0 1-5-4.6z" class="fill-(--art-text)" />
      <For each={[112.5, 119, 125.5]}>{(x) => <rect x={x} y="62" width="2.2" height="24" rx="1.1" class="fill-(--art-text-ink)" opacity="0.45" />}</For>
      <g transform="rotate(14 158 34)">
        <rect x="138.5" y="20.5" width="42" height="30" rx="5" class="fill-(--art-video) stroke-(--art-card-edge)" />
        <Play x={160} y={35.5} size={6} class="fill-(--art-video-ink)" />
      </g>
    </Art>
  );
}

/** A smooth path through the points, flat at each one so it never overshoots. */
function wave(points: readonly (readonly [number, number])[]) {
  return points
    .map(([x, y], index) => {
      if (!index) return `M${x} ${y}`;
      const [fromX, fromY] = points[index - 1]!;
      const dx = (x - fromX) / 2;
      return `C${fromX + dx} ${fromY} ${x - dx} ${y} ${x} ${y}`;
    })
    .join(" ");
}

const CHART = { left: 44, right: 196, base: 106 };
// Two platforms stacked, each rising with a dip or two, as heights above the baseline.
const LOWER = [10, 15, 12, 19, 17, 25, 23, 31];
const UPPER = [8, 10, 9, 13, 12, 16, 15, 20];

/** Analytics: a stat with its change, and the views of two platforms stacked on the way up. */
export function AnalyticsArt(props: { class?: string }) {
  const { left, right, base } = CHART;
  const xAt = (index: number) => left + (index / (LOWER.length - 1)) * (right - left);
  const lower = LOWER.map((height, index) => [xAt(index), base - height] as const);
  const upper = UPPER.map((height, index) => [xAt(index), base - LOWER[index]! - height] as const);
  const lowerArea = `${wave(lower)} L${right} ${base} L${left} ${base} Z`;
  const upperArea = `${wave(upper)} ${wave([...lower].reverse()).replace("M", "L")} Z`;
  const [endX, endY] = upper[upper.length - 1]!;

  return (
    <Art class={props.class}>
      <rect x="30.5" y="14.5" width="180" height="104" rx="10" class={CARD} />
      <rect x="44" y="28" width="30" height="4" rx="2" class={LINE_SOFT} />
      <rect x="44" y="37" width="46" height="9" rx="3" class={LINE} />
      <rect x="96" y="37" width="28" height="9" rx="4.5" class={ACCENT} fill-opacity="0.16" />
      <path d="M101 43l2.5-3 2.5 3" class="stroke-(--plane-accent-primary)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="109" y="40" width="11" height="3" rx="1.5" class={ACCENT} fill-opacity="0.7" />
      <circle cx="142" cy="30" r="2.5" class="fill-(--art-video-ink)" />
      <rect x="148" y="28.5" width="14" height="3" rx="1.5" class={LINE_SOFT} />
      <circle cx="170" cy="30" r="2.5" class="fill-(--art-audio-ink)" />
      <rect x="176" y="28.5" width="20" height="3" rx="1.5" class={LINE_SOFT} />
      <For each={[62, 78]}>{(y) => <rect x={left} y={y} width={right - left} height="0.8" class={LINE_SOFT} />}</For>
      <path d={lowerArea} class="fill-(--art-audio)" />
      <path d={upperArea} class="fill-(--art-video)" />
      <path d={wave(lower)} class="stroke-(--art-audio-ink)" stroke-width="1.2" stroke-linecap="round" />
      <path d={wave(upper)} class="stroke-(--plane-accent-primary)" stroke-width="1.5" stroke-linecap="round" />
      <rect x={left} y={base} width={right - left} height="0.8" class={LINE_SOFT} />
      <circle cx={endX} cy={endY} r="3" class="fill-(--plane-accent-primary) stroke-(--art-card)" stroke-width="2" />
    </Art>
  );
}
