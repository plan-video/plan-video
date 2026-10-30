// Bluesky only. Before acting, the network is asked whether the account already reposted or replied,
// so nothing is done twice.

import { PublishError } from "./errors.mjs";
import { postNow, reply, repost } from "./networks/bluesky.mjs";

const KINDS = ["auto-repost", "auto-plug"];

export const plugs = {
  platforms: ["bluesky"],

  /** Only plugs set before the post went out. */
  forAccount(settings, connectionId, platform, sentAt) {
    if (platform !== "bluesky" || !Array.isArray(settings)) return [];
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

  /** Returns the kinds done, including ones the post can no longer take. */
  async run(row, wanted, session) {
    if (!row.publish_id) return KINDS;
    const target = await postNow(row.publish_id);
    if (!target) return KINDS;
    const done = [];
    for (const plug of wanted) {
      const likes = typeof plug.likes === "number" && plug.likes > 0 ? Math.floor(plug.likes) : 1;
      if (target.likes < likes) continue;
      if (plug.kind === "auto-repost") await repost(session, target);
      else await reply(session, target, plug.message);
      done.push(plug.kind);
    }
    return done;
  },
};

export { PublishError };
