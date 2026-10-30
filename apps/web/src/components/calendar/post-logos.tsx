/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";

import { YouTubeWhiteTile } from "@/components/brand/youtube-icon";
import { PlatformLogo } from "@/components/publish/controls";
import { SOCIAL_PLATFORMS, type PlatformId } from "@/lib/social";
import { cn } from "./utils";

const KNOWN = new Set<string>(SOCIAL_PLATFORMS.map((platform) => platform.id));

export function PostLogos(props: { platforms: readonly string[]; max?: number; class?: string; size?: "sm" | "md" }) {
  const ids = () => props.platforms.filter((id): id is PlatformId => KNOWN.has(id));
  const shown = () => ids().slice(0, props.max ?? ids().length);
  const extra = () => ids().length - shown().length;

  return (
    <Show when={ids().length > 0}>
      <span class={cn("flex shrink-0 items-center gap-[3px]", props.class)}>
        <For each={shown()}>
          {(id) => {
            const tile = props.size === "sm" ? "size-3.5 rounded-sm" : "size-4 rounded-sm";
            // A chip can't hold YouTube's icon 20 high, so here it stays small, on its white tile (see brand/youtube-icon).
            return id === "youtube" ? <YouTubeWhiteTile fill class={tile} /> : <PlatformLogo id={id} class={tile} />;
          }}
        </For>
        <Show when={extra() > 0}>
          <span class="text-xxs font-medium leading-none text-muted-foreground tabular-nums">+{extra()}</span>
        </Show>
      </span>
    </Show>
  );
}
