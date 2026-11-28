/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Switch } from "solid-js";

import { YouTubeIcon } from "@/components/brand/youtube-icon";
import { cx } from "@/lib/cva";

import type { StreamSource } from "@/lib/stream-clips";

export const SOURCE_NAMES: Record<StreamSource, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

/** Where to watch a broadcast on its own platform. */
export function sourceUrl(id: string, source: StreamSource | undefined): string {
  if (source === "kick") return `https://kick.com/video/${id.replace(/^kick:/, "")}`;
  if (source === "youtube") return `https://www.youtube.com/watch?v=${id.replace(/^yt:/, "")}`;
  return `https://www.twitch.tv/videos/${id}`;
}

/** Simple Icons' Twitch glyph (CC0). */
function TwitchLogo(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={props.class} aria-hidden="true">
      <path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

/** Kick's blocky K in its green. */
function KickLogo(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={props.class} aria-hidden="true">
      <path fill="#53FC18" d="M3 2h6v6h3V5h3V2h6v6h-3v3h-3v2h3v3h3v6h-6v-3h-3v-3H9v6H3z" />
    </svg>
  );
}

/** The platform's mark, 20 px high as YouTube's rules ask for its own. */
export function SourceLogo(props: { source: StreamSource | undefined; class?: string }) {
  return (
    <Switch fallback={<TwitchLogo class={cx("size-5 shrink-0", props.class)} />}>
      <Match when={props.source === "kick"}>
        <KickLogo class={cx("size-5 shrink-0", props.class)} />
      </Match>
      <Match when={props.source === "youtube"}>
        <YouTubeIcon class={props.class} />
      </Match>
    </Switch>
  );
}
