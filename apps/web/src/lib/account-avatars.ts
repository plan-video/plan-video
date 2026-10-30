/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Accounts connected before pictures were saved get theirs on first view.
// A YouTube channel's name and picture are read again once a day, since
// YouTube's rules let plan.video keep them only while they're kept fresh.

import { updateAccountAvatar, updateYouTubeChannel, type SocialConnection } from "@/lib/social-connections";
import { loadBlueskyAvatar } from "@/lib/bluesky";
import { loadLinkedInAvatar } from "@/lib/linkedin";
import { isMetaNetwork, loadMetaProfile } from "@/lib/meta";
import { loadTikTokAvatar } from "@/lib/tiktok";
import { loadYouTubeAvatar, loadYouTubeChannel } from "@/lib/youtube";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Accounts already asked this visit, so a failure isn't retried on every render. */
const asked = new Set<string>();

async function avatarFor(account: SocialConnection): Promise<string | null> {
  if (account.tiktok) return loadTikTokAvatar(account.id);
  if (account.youtube) return loadYouTubeAvatar(account.id);
  if (account.bluesky) return loadBlueskyAvatar(account.bluesky.did);
  if (account.linkedin) return loadLinkedInAvatar(account.id);
  if (isMetaNetwork(account.platform) && account[account.platform]) return (await loadMetaProfile(account.platform, account.id)).avatarUrl ?? null;
  return null;
}

/** Fetches the picture for each logged-in account that has never had one looked up, and YouTube's again each day. */
export function fillMissingAvatars(userId: string, accounts: readonly SocialConnection[]) {
  for (const account of accounts) {
    if (account.youtube && !asked.has(account.id) && Date.now() - (account.youtube.checkedAt ?? 0) > DAY_MS) {
      asked.add(account.id);
      void loadYouTubeChannel(account.id)
        .then((channel) => {
          if (channel) updateYouTubeChannel(userId, account.id, channel);
        })
        .catch(() => {});
      continue;
    }
    if (account.avatarUrl !== undefined || asked.has(account.id) || !(account.tiktok || account.youtube || account.bluesky || account.linkedin || account.instagram || account.facebook || account.threads)) continue;
    asked.add(account.id);
    void avatarFor(account)
      .then((url) => {
        if (url !== null) updateAccountAvatar(userId, account.id, url);
      })
      .catch(() => {});
  }
}
