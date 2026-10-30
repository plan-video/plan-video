/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beginAccountSync } from "@/lib/account-sync";
import { beginPostSync } from "@/lib/post-sync";
import { beginTeam } from "@/lib/team";
import { beginTeamSync } from "@/lib/team-sync";

/** Does nothing for a part already running for this person; undefined stops them all. */
export function beginSyncing(userId: string | undefined) {
  beginAccountSync(userId);
  beginTeam(userId);
  beginTeamSync(userId);
  beginPostSync(userId);
}
