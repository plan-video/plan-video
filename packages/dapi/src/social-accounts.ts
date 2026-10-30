/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** An account the agent is allowed to see. Never a token. */
export type ConnectedAccount = {
  id: string;
  platform: string;
  handle: string;
};

export type AccountChoice =
  | { ok: true; choices: Record<string, string[]>; accounts: ConnectedAccount[] }
  | { ok: false; message: string };

/**
 * Picks which connected account a post uses on each platform.
 * Several accounts and no id is a refusal: the caller has to ask, not guess.
 */
export function chooseAccounts(
  platforms: readonly string[],
  requested: readonly string[] | undefined,
  connected: readonly ConnectedAccount[],
  nameOf: (platform: string) => string = (platform) => platform,
): AccountChoice {
  const unique = [...new Set(platforms)];
  if (unique.length === 0) return { ok: false, message: "Pick at least one platform." };

  const byId = new Map(connected.map((account) => [account.id, account]));
  const label = (account: ConnectedAccount) => `${account.handle} (${account.id})`;

  if (requested && requested.length > 0) {
    const wanted = [...new Set(requested)];
    const missing = wanted.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return { ok: false, message: `No connected account with id ${missing.join(", ")}. Call social_accounts and use an id from there.` };
    }
    const chosen = wanted.map((id) => byId.get(id)!);
    const extra = chosen.filter((account) => !unique.includes(account.platform));
    if (extra.length > 0) {
      const names = extra.map((account) => account.handle).join(", ");
      return { ok: false, message: `${names} ${extra.length === 1 ? "is" : "are"} not on a platform in this post.` };
    }
    const choices: Record<string, string[]> = {};
    const accounts: ConnectedAccount[] = [];
    for (const platform of unique) {
      const ids = chosen.filter((account) => account.platform === platform);
      if (ids.length === 0) {
        const options = connected.filter((account) => account.platform === platform);
        if (options.length === 0) return { ok: false, message: `Connect ${nameOf(platform)} in Connections first.` };
        return {
          ok: false,
          message: `Pick an account for ${nameOf(platform)}. Connected: ${options.map(label).join(", ")}.`,
        };
      }
      choices[platform] = ids.map((account) => account.id);
      accounts.push(...ids);
    }
    return { ok: true, choices, accounts };
  }

  const choices: Record<string, string[]> = {};
  const accounts: ConnectedAccount[] = [];
  for (const platform of unique) {
    const options = connected.filter((account) => account.platform === platform);
    if (options.length === 0) return { ok: false, message: `Connect ${nameOf(platform)} in Connections first.` };
    if (options.length > 1) {
      return {
        ok: false,
        message: `${nameOf(platform)} has more than one account. Pass the id to use: ${options.map(label).join(", ")}.`,
      };
    }
    const only = options[0]!;
    choices[platform] = [only.id];
    accounts.push(only);
  }
  return { ok: true, choices, accounts };
}
