// Bluesky is asked whether the account already reposted or replied, so nothing is done twice there.
// X bills every read and post, so a reply is kept as done before it goes out and is never sent twice.

import { postNow, reply, repost } from "./networks/bluesky.mjs";

const KINDS = ["auto-repost", "auto-plug"];

const bluesky = { find: (row) => postNow(row.publish_id), repost, reply };

/** `x` is the X network, when it's set up. */
export function createPlugs({ x } = {}) {
  const steps = { bluesky, ...(x?.plug ? { x: x.plug } : {}) };

  return {
    platforms: Object.keys(steps),

    /** Only plugs set before the post went out. */
    forAccount(settings, connectionId, platform, sentAt) {
      if (!Object.hasOwn(steps, platform) || !Array.isArray(settings)) return [];
      return settings.filter(
        (plug) =>
          plug &&
          plug.accountId === connectionId &&
          KINDS.includes(plug.kind) &&
          plug.activated !== false &&
          !(Date.parse(plug.createdAt) > sentAt) &&
          (plug.kind !== "auto-plug" || (typeof plug.message === "string" && plug.message.trim())),
      );
    },

    /** Calls `done` with each kind as it's done, and with all of them once the post can't take any. */
    async run(row, wanted, session, { done, undo }) {
      const network = steps[row.platform];
      await network.ready?.(row);
      const target = row.publish_id ? await network.find(row, session) : null;
      if (!target) return done(...KINDS);
      for (const plug of wanted) {
        const likes = typeof plug.likes === "number" && plug.likes > 0 ? Math.floor(plug.likes) : 1;
        if (target.likes < likes) continue;
        if (plug.kind === "auto-repost") {
          await network.repost(session, target, row);
          await done(plug.kind);
          continue;
        }
        // Kept before it's sent: a reply made but not kept would go out again at the next check.
        await done(plug.kind);
        await network.reply(session, target, plug.message, row).catch(async (error) => {
          await undo(plug.kind);
          throw error;
        });
      }
    },
  };
}
