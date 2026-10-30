/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Starts keeping this person's work in step with their account: the
// account's lists (lib/account-sync.ts), the workspaces shared with them and
// their lists (lib/team.ts, lib/team-sync.ts), and every workspace's posts
// (lib/post-sync.ts). The dashboard starts it, and so does a tab answering an
// AI agent, so what an agent makes reaches the account from any page.

import { beginAccountSync } from "@/lib/account-sync";
import { beginPostSync } from "@/lib/post-sync";
import { beginTeam } from "@/lib/team";
import { beginTeamSync } from "@/lib/team-sync";

/** Each part does nothing when it's already running for this person. Undefined stops them, as on sign-out or in the demo. */
export function beginSyncing(userId: string | undefined) {
  beginAccountSync(userId);
  beginTeam(userId);
  beginTeamSync(userId);
  beginPostSync(userId);
}
