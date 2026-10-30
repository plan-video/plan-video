/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A connected account as lists show it: its profile picture with the
// platform's logo in the corner, or the logo alone while it has no picture.
// A YouTube channel always shows YouTube's icon alone, bare and 20 high: its
// brand rules allow neither a smaller icon nor one in a corner over a picture.

import { Match, Show, Switch } from "solid-js";

import { tileViewBox } from "@/components/brand/tile-box";
import { YouTubeBare, YouTubeSlot, YouTubeWhiteTile } from "@/components/brand/youtube-icon";
import { AvatarPhoto } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { socialPlatform, type PlatformId } from "@/lib/social";
import type { SocialConnection } from "@/lib/social-connections";

/** The networks' marks at 62% of their tile, in a box the tile's size (see brand/tile-box). */
const MARK_BOX = tileViewBox("0 0 24 24", 0.62);

/** The platform's logo tile, drawn here rather than taken from the controls, which list accounts with this. */
function Logo(props: { platform: string; class: string }) {
  const platform = () => socialPlatform(props.platform as PlatformId);
  return (
    <span class={cx("grid place-items-center overflow-hidden", props.class)} style={{ background: platform()?.background }}>
      <svg viewBox={MARK_BOX} class="size-full" fill="white" aria-hidden="true">
        <path d={platform()?.logo} />
      </svg>
    </span>
  );
}

/**
 * Whether some of these names are the same, as a brand's accounts on several
 * networks often are. A list like that leads with each account's network
 * (`logoOnly`), since the pictures and names alone can't tell them apart.
 */
export function namesRepeat(names: readonly string[]) {
  const seen = new Set<string>();
  return names.some((name) => {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

export function AccountAvatar(props: {
  account: Pick<SocialConnection, "platform" | "avatarUrl">;
  /** The network's logo alone, even when the account has a picture. */
  logoOnly?: boolean;
  /** YouTube's icon small on its white tile, the size of the other logos, rather than 20 high (analytics' account list and the posts list, the user's choice). */
  compact?: boolean;
  /** YouTube's icon alone, red with no tile, as wide as the other logos (the Schedule sidebar's account list, the user's choice). */
  bare?: boolean;
  class?: string;
}) {
  const logo = (class_: string) => <Logo platform={props.account.platform} class={class_} />;
  // Branches in the markup, not early returns, so a row whose account changes redraws as the new network.
  return (
    <Show
      when={props.account.platform === "youtube"}
      fallback={
        <span class={cx("relative inline-block size-4 shrink-0", props.class)}>
          <Show when={!props.logoOnly && props.account.avatarUrl} fallback={logo("size-full rounded-[25%]")}>
            <AvatarPhoto url={props.account.avatarUrl || null} class="size-full rounded-full object-cover" fallback={logo("size-full rounded-[25%]")} />
            <span class="absolute -right-[12%] -bottom-[12%] size-[55%] rounded-[30%] ring-[1.5px] ring-(--plane-surface-1)">
              {logo("size-full rounded-[30%]")}
            </span>
          </Show>
        </span>
      }
    >
      <Switch fallback={<YouTubeSlot class={cx("size-4", props.class)} />}>
        <Match when={props.bare}>
          <YouTubeBare class={cx("size-4", props.class)} />
        </Match>
        <Match when={props.compact}>
          <span class={cx("relative inline-block size-4 shrink-0", props.class)}>
            <YouTubeWhiteTile fill class="size-full rounded-[25%]" />
          </span>
        </Match>
      </Switch>
    </Show>
  );
}
