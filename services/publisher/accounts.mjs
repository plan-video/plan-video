// Plans' account counts follow apps/web/src/lib/plans.ts, plus extras paid for (user_data.extra_accounts).
// Only a login for a new account counts; accounts already connected stay after a plan gets smaller.

import { levelOf } from "./plans.mjs";

export const ACCOUNTS_BY_LEVEL = { 1: 3, 2: 15, 3: 40, 4: 100 };

export function accountLimit(level, extra = 0) {
  return ACCOUNTS_BY_LEVEL[levelOf(level)] + Math.max(0, Math.trunc(Number(extra)) || 0);
}

const turns = new Map();

/**
 * One person's connects go one at a time, so two at once can't both take the last place. A limit that
 * can't be read lets the login in, unless `strict`. Returns the limit it was turned away at, or null.
 */
export function connectWithin({ vault, limits, userId, connectionId, strict = false }, keep) {
  const run = async () => {
    if (limits) {
      const kept = await vault.list(userId);
      if (!kept.some((login) => login.connectionId === connectionId)) {
        const most = await limits.limitFor(userId);
        if (most === undefined ? strict : kept.length >= most) return most ?? 0;
      }
    }
    await keep();
    return null;
  };
  const turn = (turns.get(userId) ?? Promise.resolve()).then(run, run);
  const settled = turn.catch(() => undefined);
  turns.set(userId, settled);
  void settled.then(() => turns.get(userId) === settled && turns.delete(userId));
  return turn;
}

/** Reads a person's limit. Undefined when it can't be read, so a database hiccup doesn't block connecting. */
export function createAccountLimits(db) {
  return {
    async limitFor(userId) {
      const row = await db
        .selectOne("user_data", { id: userId }, "access_level,extra_accounts")
        // Without the extra_accounts column: the plan alone.
        .catch(() => db.selectOne("user_data", { id: userId }, "access_level"))
        .catch(() => undefined);
      if (row === undefined) return undefined;
      return accountLimit(row?.access_level ?? 1, row?.extra_accounts ?? 0);
    },
  };
}
