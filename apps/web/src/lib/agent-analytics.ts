/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { analyticsAccounts, analyticsAnswer, type AnalyticsArgs } from "@/lib/analytics-answer";
import { analyticsSynced, syncState } from "@/lib/analytics-sync";
import { socialConnections } from "@/lib/social-connections";

export async function readAnalytics(args: AnalyticsArgs, userId: string) {
  const accounts = analyticsAccounts(args, socialConnections());
  await analyticsSynced(userId, accounts);
  return analyticsAnswer(args, accounts, syncState);
}
