// Built by scripts/build-posting.mjs from apps/web/src/dapi/server/posts.ts. Don't edit: run `npm run posting`.

// packages/dapi/src/tool.ts
function defineTool(tool) {
  return tool;
}

// packages/dapi/src/tools/posts.ts
import { z } from "zod";
var PlatformId = z.enum(["tiktok", "instagram", "youtube", "x", "facebook", "linkedin", "threads", "bluesky", "pinterest"]);
var PostStatus = z.enum(["draft", "scheduled", "posted"]);
var Repeat = z.object({
  every: z.int().min(1).max(99).optional().describe("How many of unit between posts. Omit for weekday, which is Monday to Friday."),
  unit: z.enum(["day", "week", "month", "weekday"]),
  until: z.string().optional().describe("Last day, YYYY-MM-DD, inclusive."),
  times: z.int().min(1).max(99).optional().describe("Stop after this many posts, including the first.")
});
var YouTubeSettings = z.object({
  title: z.string().optional().describe("YouTube title. Defaults to the first line of the caption."),
  privacy: z.enum(["public", "unlisted", "private"]).optional().describe("Who can watch. Defaults to public."),
  madeForKids: z.boolean().optional().describe("Whether the video is made for kids."),
  tags: z.array(z.string()).optional().describe("Tags, without a leading #. 30 characters each, 500 altogether.")
});
var TikTokPrivacy = z.enum(["public", "friends", "followers", "private"]);
var TikTokSettings = z.object({
  privacy: TikTokPrivacy.optional().describe(
    "Who can watch, as the user picked it from the choices tiktok_creator lists. There is no default: ask. Required to schedule a TikTok post to the profile, together with promotion."
  ),
  comments: z.boolean().optional().describe("Allow comments. Off unless the user turns it on."),
  duet: z.boolean().optional().describe("Allow Duet, for a video. Off unless the user turns it on."),
  stitch: z.boolean().optional().describe("Allow Stitch, for a video. Off unless the user turns it on."),
  promotion: z.enum(["none", "your_brand", "branded_content", "both"]).optional().describe(
    "Whether the post promotes something, as the user answered: none; your_brand, when it promotes themselves or their own business (labelled Promotional content); branded_content, when it promotes another brand or a third party (labelled Paid partnership, and it can't be private); or both. Required with privacy."
  ),
  agreed: z.boolean().optional().describe(
    "True once the user has accepted TikTok's terms for this post: show them consent from tiktok_creator word for word with its links (brandedConsent for branded content) and wait for their yes. Required to schedule a post to the TikTok profile."
  ),
  inbox: z.boolean().optional().describe("Send the video to the TikTok inbox instead of posting it to the profile. The person finishes it in TikTok.")
});
var ThreadReply = z.object({
  text: z.string().min(1).describe("The words. X takes 280 characters, Bluesky 300, and a LinkedIn comment 1,250."),
  delayMinutes: z.int().min(0).max(1440).optional().describe("Minutes after the post, or the follow-up before it, that this one goes out: 0, 1, 5, 15, 30, 60, 180, 360, 720 or 1440. Others are rounded to the nearest. Default 0.")
});
var Thread = z.array(ThreadReply).max(10).describe(
  "Follow-ups posted under the post once it's out, each its delay after the one before: replies under it on X and Bluesky, comments on it on LinkedIn. Other platforms get the post alone. Up to 10."
);
var PostAccount = z.object({
  platform: PlatformId,
  accountId: z.string().describe("Empty when the post names a platform but no account."),
  handle: z.string().describe("Account name. Empty when that account is no longer connected."),
  publishes: z.boolean().describe("True when plan.video can send to this platform.")
});
var PostDelivery = z.object({
  platform: PlatformId,
  state: z.enum(["sending", "sent", "failed"]),
  error: z.string().optional().describe("What the platform said, when the send failed.")
});
var PostApproval = z.object({
  state: z.enum(["pending", "changes", "approved"]).describe("pending: waiting to be approved. changes: sent back with a note. approved: it goes out at its time."),
  by: z.string().optional().describe("Who asked, or who decided."),
  note: z.string().optional().describe("What to change, when changes were asked for.")
}).nullable().describe("Null when nobody asked for approval. A post waiting for approval or sent back is a draft and doesn't go out.");
var ScheduledPost = z.object({
  id: z.string(),
  status: PostStatus,
  approval: PostApproval,
  title: z.string(),
  caption: z.string(),
  day: z.string().describe("YYYY-MM-DD in the dashboard time zone."),
  time: z.string().nullable().describe("HH:MM, or null when a draft has a day and no time."),
  timeZone: z.string(),
  platforms: z.array(PostAccount),
  repeat: z.string().nullable().describe("How it repeats, or null."),
  link: z.string().nullable(),
  thread: z.array(z.object({ text: z.string(), delayMinutes: z.int() })).describe("Follow-ups posted under it once it's out. Empty when it has none."),
  warnings: z.array(z.string()),
  deliveries: z.array(PostDelivery)
});
var postFields = {
  caption: z.string().describe("The caption stored for every platform on the post. One caption: a short platform needs a shorter caption, or leave it off."),
  platforms: z.array(PlatformId).min(1).describe("Where it goes. Ids from social_schema, such as tiktok or x."),
  accounts: z.array(z.string().min(1)).min(1).optional().describe("Connection ids from social_accounts. Required when a platform has more than one account."),
  day: z.string().optional().describe("YYYY-MM-DD in the dashboard time zone, which social_accounts reports."),
  time: z.string().optional().describe("HH:MM in that time zone, 24-hour. 9:00 and 09:00 both work."),
  draft: z.boolean().optional().describe("Save it without scheduling a send. A day and time can still be stored."),
  media: z.union([z.string(), z.array(z.string()).min(1).max(35)]).optional().describe("One video, or up to 35 pictures as a list for a carousel: absolute paths or project library paths. Remote URLs are refused."),
  link: z.string().optional().describe("A destination link stored on the post."),
  youtube: YouTubeSettings.optional(),
  tiktok: TikTokSettings.optional(),
  repeat: Repeat.optional().describe("Repeat from the first day, for as long as the post stays scheduled."),
  thread: Thread.optional()
};
var socialAccounts = defineTool({
  name: "social_accounts",
  title: "Social accounts",
  description: "List the social accounts connected in plan.video. Call this before scheduling and use the returned ids. Tokens are never returned. When a platform has more than one account, schedule_post has to be given an id from here.",
  input: z.object({}),
  output: z.object({
    timeZone: z.string().describe("The dashboard time zone. Day and time arguments are read in this zone."),
    accounts: z.array(z.object({
      id: z.string(),
      platform: PlatformId,
      handle: z.string(),
      publishes: z.boolean().describe("True when plan.video can send to this platform."),
      ready: z.boolean().describe("A login is stored for a platform plan.video sends to, so posts to it can go out. False for a name saved without that login, and for a platform plan.video doesn't send to yet."),
      scheduledRoom: z.number().int().nullable().describe("How many more scheduled posts this account can have waiting, on the Free plan's limit. Null when the plan has no limit.")
    }))
  })
});
var socialSchema = defineTool({
  name: "social_schema",
  title: "Platform rules",
  description: "Posting rules for each platform: caption limit, what it accepts, and whether plan.video can publish it. Call this before writing a caption for a short platform such as X or Bluesky. One caption is shared by every platform on a post.",
  input: z.object({
    platform: PlatformId.optional().describe("One platform. Omit for every platform.")
  }),
  output: z.object({
    caption: z.string(),
    platforms: z.array(z.object({
      id: PlatformId,
      name: z.string(),
      captionLimit: z.int(),
      maxVideoSeconds: z.int(),
      maxImages: z.int(),
      hashtagLimit: z.int().nullable(),
      kinds: z.array(z.string()),
      publishes: z.boolean(),
      media: z.enum(["required", "optional"]),
      notes: z.string()
    }))
  })
});
var tiktokCreator = defineTool({
  name: "tiktok_creator",
  title: "TikTok account check",
  description: "Ask TikTok what a connected TikTok account can post right now: the name it posts as, who can watch, whether comments, Duet and Stitch can be on, and the longest video. TikTok requires this before anything goes to a profile, and it can change, so call it each time before you schedule or publish to the TikTok profile. Then tell the user which account the post goes out as, and ask them who can watch (one of privacy; there is no default), whether to allow comments, Duet and Stitch (not those the account has off), and whether the post promotes something. Last, show them consent word for word with its links, or brandedConsent for branded content, and pass agreed true only once they accept. Not needed for tiktok.inbox, where they finish the post in TikTok.",
  input: z.object({
    account: z.string().min(1).optional().describe("A TikTok connection id from social_accounts. Required when there's more than one.")
  }),
  output: z.object({
    accountId: z.string(),
    nickname: z.string().describe("The name the post goes out as. Tell the user."),
    username: z.string(),
    privacy: z.array(TikTokPrivacy).describe("Who this account may show a post to. Offer these and nothing else."),
    comments: z.boolean().describe("False when the account has comments off in TikTok: they stay off."),
    duet: z.boolean().describe("False when the account has Duet off in TikTok: it stays off."),
    stitch: z.boolean().describe("False when the account has Stitch off in TikTok: it stays off."),
    maxVideoSeconds: z.number().describe("The longest video this account can post."),
    consent: z.string().describe("Show the user this before the post is scheduled or published, word for word with its link."),
    brandedConsent: z.string().describe("Show this instead when the post is branded content.")
  })
});
var schedulePost = defineTool({
  name: "schedule_post",
  title: "Schedule post",
  description: "Save a post on the plan.video calendar. A scheduled post goes out on its own at its day and time, from plan.video's servers, even with the app closed, once it has synced to the account, so the app has to stay open until then. A draft stays until the user schedules it. Pass platforms and a caption, then either a future day and time or draft true. Call social_accounts first, and pass account ids when a platform has more than one account. Attach one local video, or pictures for a carousel, with media. A platform whose publishes is false in social_schema is only kept on the calendar.",
  input: z.object(postFields),
  output: ScheduledPost
});
var copyPost = defineTool({
  name: "copy_post",
  title: "Copy post",
  description: "Make a new post from an existing one, posted or not: the same caption, platforms, accounts, video or pictures, link and platform settings, on a new day and time or as a draft. Pass caption, platforms or accounts to change them on the copy. The original stays as it is. This does not publish. Use it to post something again.",
  input: z.object({
    id: z.string().min(1).describe("The post to copy, from list_posts."),
    day: postFields.day,
    time: postFields.time,
    draft: postFields.draft,
    caption: postFields.caption.optional().describe("A new caption for the copy. Omit to keep the original's."),
    platforms: postFields.platforms.optional().describe("Where the copy goes. Omit to keep the original's platforms."),
    accounts: postFields.accounts,
    thread: Thread.optional().describe("Follow-ups for the copy, in place of the original's. Omit to keep the original's, or pass [] for none."),
    tiktok: TikTokSettings.optional().describe(
      "Changes to the copy's TikTok settings. To schedule a copy to the TikTok profile, pass agreed true once the user accepted TikTok's terms, as tiktok_creator describes."
    )
  }),
  output: ScheduledPost
});
var listPosts = defineTool({
  name: "list_posts",
  title: "List posts",
  description: "List posts on the calendar, oldest first, or one post when id is set. Includes status, time, accounts, and whether a send succeeded or failed. Does not include tokens.",
  input: z.object({
    id: z.string().optional().describe("One post. Other filters are ignored."),
    status: PostStatus.optional(),
    platform: PlatformId.optional(),
    from: z.string().optional().describe("First day, YYYY-MM-DD, inclusive."),
    to: z.string().optional().describe("Last day, YYYY-MM-DD, inclusive."),
    limit: z.int().min(1).max(100).optional().describe("How many to return (default 50).")
  }),
  output: z.object({
    timeZone: z.string(),
    total: z.int().describe("How many matched before the limit."),
    posts: z.array(ScheduledPost)
  })
});
var updatePost = defineTool({
  name: "update_post",
  title: "Update post",
  description: "Change a draft or a scheduled post. Omitted fields stay as they are. Posted posts stay as they went out. This does not publish. Pass draft true to take a scheduled post back to a draft, or a day and time to schedule a draft.",
  input: z.object({
    id: z.string().min(1),
    ...postFields,
    caption: postFields.caption.optional().describe("The caption stored for every platform on the post. Omit to leave it. One caption: a short platform needs a shorter caption, or leave that platform off."),
    platforms: postFields.platforms.optional().describe("Where it goes. Ids from social_schema, such as tiktok or x. Omit to leave the platforms as they are."),
    repeat: Repeat.nullable().optional().describe("A new repeat, or null to stop repeating."),
    thread: Thread.optional().describe("Follow-ups in place of the post's own. Omit to leave them, or pass [] for none.")
  }),
  output: ScheduledPost
});
var askForApproval = defineTool({
  name: "ask_for_approval",
  title: "Ask for approval",
  description: "Ask for a post to be approved before it goes out, by a client or by the workspace's owner or an admin. It stays on the calendar at its time but off the schedule until it's approved; approving schedules it. Returns the link to send to whoever approves: they approve or ask for changes there without an account. Give the user the link. Comes with paid plans.",
  input: z.object({
    id: z.string().min(1).describe("A draft or scheduled post, from list_posts.")
  }),
  output: ScheduledPost.extend({
    approvalLink: z.string().describe("Send this to whoever approves the post.")
  })
});
var deletePost = defineTool({
  name: "delete_post",
  title: "Delete post",
  description: "Delete a draft or a scheduled post from the calendar. Posted posts cannot be deleted, because the platform already has them.",
  input: z.object({
    id: z.string().min(1)
  }),
  output: z.object({
    id: z.string(),
    deleted: z.literal(true)
  })
});
var publishPost = defineTool({
  name: "publish_post",
  title: "Publish post",
  description: "Send a saved post now. Every platform on the post has to be one plan.video sends to, with publishes true in social_schema, which also says what media each needs. This cannot be undone. Do not call it unless the user asked to publish now. plan.video has to stay open until this answers. Call it again to retry a failed send. A post to the TikTok profile needs tiktok_creator first and agreed true.",
  input: z.object({
    id: z.string().min(1),
    agreed: z.boolean().optional().describe(
      "For a post to the TikTok profile: true once the user has accepted TikTok's terms for it just now. Show them consent from tiktok_creator word for word with its links (brandedConsent for branded content) and wait for their yes. Required for those posts."
    )
  }),
  output: ScheduledPost
});

// packages/dapi/src/catalog.ts
var catalog = [
  socialAccounts,
  socialSchema,
  tiktokCreator,
  schedulePost,
  copyPost,
  listPosts,
  updatePost,
  askForApproval,
  deletePost,
  publishPost
];
var byName = new Map(catalog.map((tool) => [tool.name, tool]));
function toolByName(name) {
  return byName.get(name);
}

// packages/dapi/src/errors.ts
var DapiError = class extends Error {
  code;
  constructor(code, message, options) {
    super(message, options);
    this.name = "DapiError";
    this.code = code;
  }
};
function isDapiError(value) {
  return value instanceof DapiError;
}

// packages/dapi/src/social-accounts.ts
function chooseAccounts(platforms, requested, connected2, nameOf = (platform) => platform) {
  const unique = [...new Set(platforms)];
  if (unique.length === 0) return { ok: false, message: "Pick at least one platform." };
  const byId = new Map(connected2.map((account) => [account.id, account]));
  const label = (account) => `${account.handle} (${account.id})`;
  if (requested && requested.length > 0) {
    const wanted = [...new Set(requested)];
    const missing = wanted.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return { ok: false, message: `No connected account with id ${missing.join(", ")}. Call social_accounts and use an id from there.` };
    }
    const chosen = wanted.map((id) => byId.get(id));
    const extra = chosen.filter((account) => !unique.includes(account.platform));
    if (extra.length > 0) {
      const names = extra.map((account) => account.handle).join(", ");
      return { ok: false, message: `${names} ${extra.length === 1 ? "is" : "are"} not on a platform in this post.` };
    }
    const choices2 = {};
    const accounts2 = [];
    for (const platform of unique) {
      const ids = chosen.filter((account) => account.platform === platform);
      if (ids.length === 0) {
        const options = connected2.filter((account) => account.platform === platform);
        if (options.length === 0) return { ok: false, message: `Connect ${nameOf(platform)} in Connections first.` };
        return {
          ok: false,
          message: `Pick an account for ${nameOf(platform)}. Connected: ${options.map(label).join(", ")}.`
        };
      }
      choices2[platform] = ids.map((account) => account.id);
      accounts2.push(...ids);
    }
    return { ok: true, choices: choices2, accounts: accounts2 };
  }
  const choices = {};
  const accounts = [];
  for (const platform of unique) {
    const options = connected2.filter((account) => account.platform === platform);
    if (options.length === 0) return { ok: false, message: `Connect ${nameOf(platform)} in Connections first.` };
    if (options.length > 1) {
      return {
        ok: false,
        message: `${nameOf(platform)} has more than one account. Pass the id to use: ${options.map(label).join(", ")}.`
      };
    }
    const only = options[0];
    choices[platform] = [only.id];
    accounts.push(only);
  }
  return { ok: true, choices, accounts };
}

// packages/dapi/src/tiktok.ts
var TIKTOK_MUSIC_USAGE = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
var TIKTOK_BRANDED_POLICY = "https://www.tiktok.com/legal/page/global/bc-policy/en";
function tiktokConsent(branded) {
  return branded ? `By posting, you agree to TikTok's Branded Content Policy (${TIKTOK_BRANDED_POLICY}) and Music Usage Confirmation (${TIKTOK_MUSIC_USAGE}).` : `By posting, you agree to TikTok's Music Usage Confirmation (${TIKTOK_MUSIC_USAGE}).`;
}
function promotionFlags(promotion) {
  return {
    yourBrand: promotion === "your_brand" || promotion === "both",
    brandedContent: promotion === "branded_content" || promotion === "both"
  };
}
var PROMOTION_QUESTION = "TikTok needs to know whether the post promotes something. Ask the user, then pass tiktok.promotion: none; your_brand, when it promotes themselves or their own business (labelled Promotional content); branded_content, when it promotes another brand or a third party (labelled Paid partnership, and it can't be private); or both.";
function checkTikTokCreator(choices, creator, videoSeconds) {
  const errors = [];
  const warnings = [];
  const name = creator.nickname || "This TikTok account";
  if (!creator.privacy.includes(choices.privacy)) {
    errors.push(`${name} can't show a post to ${choices.privacy}. Ask the user to pick one of: ${creator.privacy.join(", ")}.`);
  }
  if (choices.brandedContent && choices.privacy === "private") {
    errors.push("Branded content can't be private on TikTok. Ask the user for another privacy, or to take branded content off.");
  }
  if (videoSeconds !== null && videoSeconds > creator.maxVideoSeconds) {
    errors.push(`${name} can post videos up to ${creator.maxVideoSeconds} seconds. This one is ${Math.ceil(videoSeconds)}.`);
  }
  const next = { ...choices };
  const off = [];
  if (next.comments && creator.commentDisabled) {
    next.comments = false;
    off.push("Comments");
  }
  if (next.duet && creator.duetDisabled) {
    next.duet = false;
    if (videoSeconds !== null) off.push("Duet");
  }
  if (next.stitch && creator.stitchDisabled) {
    next.stitch = false;
    if (videoSeconds !== null) off.push("Stitch");
  }
  const list = off.length > 1 ? `${off.slice(0, -1).join(", ")} and ${off[off.length - 1]}` : off[0];
  if (off.length) warnings.push(`${list} ${off.length === 1 ? "is" : "are"} turned off in ${name}'s TikTok settings, so ${off.length === 1 ? "it stays" : "they stay"} off on this post.`);
  return { choices: next, errors, warnings };
}

// packages/dapi/src/tools/analytics.ts
import { z as z2 } from "zod";
var Numbers = z2.object({
  views: z2.int(),
  likes: z2.int(),
  comments: z2.int()
});
var PostedWhen = z2.object({
  posts: z2.int().describe("Posts that went out then."),
  medianViews: z2.int().describe("The middle post's views: a post that took off doesn't sway it."),
  averageViews: z2.int(),
  engagement: z2.number().describe("Likes and comments per view, over those posts.")
});
var analytics = defineTool({
  name: "analytics",
  title: "Analytics",
  description: "Read the person's numbers from the Analytics page: views, likes and comments for each connected account that reports them (TikTok, YouTube, Instagram, Facebook Pages, Threads and LinkedIn Pages), how posts did by the weekday and hour they went out, and their top posts. Call this before picking days or times from how their posts perform, or when they ask how they're doing. Days and hours are in the dashboard time zone. A post's numbers are its totals so far, so the newest posts have had less time.",
  input: z2.object({
    platform: z2.enum(["tiktok", "youtube", "instagram", "facebook", "threads", "linkedin"]).optional().describe("One network. Omit for every account that reports numbers."),
    account: z2.string().optional().describe("One account id, from social_accounts."),
    days: z2.int().min(7).max(730).optional().describe("How far back to look, counting today. Defaults to 90.")
  }),
  output: z2.object({
    timeZone: z2.string(),
    from: z2.string().describe("First day, YYYY-MM-DD."),
    to: z2.string().describe("Last day, YYYY-MM-DD."),
    accounts: z2.array(
      z2.object({
        platform: z2.string(),
        accountId: z2.string(),
        handle: z2.string(),
        state: z2.string().describe("ready, or why its numbers couldn't be read."),
        totals: Numbers,
        previous: Numbers.describe("The same number of days just before."),
        posts: z2.int()
      })
    ),
    noNumbers: z2.array(z2.string()).describe("Connected accounts whose network doesn't send plan.video its numbers."),
    byWeekday: z2.array(PostedWhen.extend({ weekday: z2.string() })).describe("Monday first; days with no posts are left out."),
    byHour: z2.array(PostedWhen.extend({ hour: z2.string().describe("HH:00, the hour the posts went out.") })),
    topPosts: z2.array(
      Numbers.extend({
        title: z2.string(),
        platform: z2.string(),
        handle: z2.string(),
        postedAt: z2.string().describe("YYYY-MM-DD HH:MM, weekday.")
      })
    ),
    note: z2.string().optional().describe("Why there is little or nothing to go on.")
  })
});

// packages/dapi/src/tools/library.ts
import { z as z3 } from "zod";
var listMedia = defineTool({
  name: "list_media",
  title: "Media library",
  description: "List the videos and pictures in the person's plan.video media library, newest first. Pass an item's media id to schedule_post or update_post as media. Only files in the library can be attached: when the one they want isn't there, ask them to add it in the dashboard's Media tab.",
  input: z3.object({
    kind: z3.enum(["video", "image"]).optional().describe("Only videos, or only pictures. Omit for both."),
    search: z3.string().optional().describe("Words the file name contains."),
    limit: z3.int().min(1).max(100).optional().describe("How many to return (default 30).")
  }),
  output: z3.object({
    total: z3.int().describe("How many matched before the limit."),
    media: z3.array(
      z3.object({
        id: z3.string().describe("The media id to pass as media, such as media:2f9c1e."),
        name: z3.string(),
        kind: z3.enum(["video", "image"]),
        seconds: z3.number().describe("Length of a video. 0 for a picture."),
        width: z3.int(),
        height: z3.int(),
        bytes: z3.int(),
        added: z3.string().describe("When it was added, as an ISO time."),
        uses: z3.int().describe("How many posts have used it.")
      })
    )
  })
});

// ../../../../plan.video/node_modules/solid-js/dist/server.js
var ERROR = /* @__PURE__ */ Symbol("error");
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function handleError(err, owner2 = Owner) {
  const fns = owner2 && owner2.context && owner2.context[ERROR];
  const error = castError(err);
  if (!fns) throw error;
  try {
    for (const f of fns) f(error);
  } catch (e) {
    handleError(e, owner2 && owner2.owner || null);
  }
}
var Owner = null;
function createOwner() {
  const o = {
    owner: Owner,
    context: Owner ? Owner.context : null,
    owned: null,
    cleanups: null
  };
  if (Owner) {
    if (!Owner.owned) Owner.owned = [o];
    else Owner.owned.push(o);
  }
  return o;
}
function createSignal(value, options) {
  return [() => value, (v) => {
    return value = typeof v === "function" ? v(value) : v;
  }];
}
function createMemo(fn, value) {
  Owner = createOwner();
  let v;
  try {
    v = fn(value);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner.owner;
  }
  return () => v;
}
function createContext(defaultValue) {
  const id = /* @__PURE__ */ Symbol("context");
  return {
    id,
    Provider: createProvider(id),
    defaultValue
  };
}
function children(fn) {
  const memo = createMemo(() => resolveChildren(fn()));
  memo.toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo;
}
function resolveChildren(children2) {
  if (typeof children2 === "function" && !children2.length) return resolveChildren(children2());
  if (Array.isArray(children2)) {
    const results = [];
    for (let i = 0; i < children2.length; i++) {
      const result = resolveChildren(children2[i]);
      if (Array.isArray(result)) {
        if (result.length < 32768) results.push.apply(results, result);
        else for (let j = 0; j < result.length; j++) results.push(result[j]);
      } else {
        results.push(result);
      }
    }
    return results;
  }
  return children2;
}
function createProvider(id) {
  return function provider(props) {
    return createMemo(() => {
      Owner.context = {
        ...Owner.context,
        [id]: props.value
      };
      return children(() => props.children);
    });
  };
}
var SuspenseContext = createContext();

// apps/web/src/lib/i18n.ts
var LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Espa\xF1ol" },
  { code: "fr", name: "Fran\xE7ais" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt-BR", name: "Portugu\xEAs (Brasil)" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "T\xFCrk\xE7e" },
  { code: "ja", name: "\u65E5\u672C\u8A9E" },
  { code: "ko", name: "\uD55C\uAD6D\uC5B4" },
  { code: "zh-CN", name: "\u7B80\u4F53\u4E2D\u6587" }
];
var isLanguage = (code) => LANGUAGES.some((entry) => entry.code === code);
var page = () => globalThis.document?.documentElement;
function startingLanguage() {
  const code = page()?.lang;
  return isLanguage(code) ? code : "en";
}
var [language, setLanguageSignal] = createSignal(startingLanguage());
var [catalog2, setCatalog] = createSignal(null);
var CONTEXT = "";
var keyOf = (source) => typeof source === "string" ? source : `${source.context}${CONTEXT}${source.message}`;
var english = 0;
function inEnglish(read) {
  english++;
  try {
    return read();
  } finally {
    english--;
  }
}
var current = () => english ? "en" : language();
function lookup(source) {
  const key = keyOf(source);
  const translated = english ? void 0 : catalog2()?.[key];
  if (translated) return translated;
  if (typeof source !== "string") return source.message;
  const cut = key.indexOf(CONTEXT);
  return cut === -1 ? key : key.slice(cut + 1);
}
function msg(source) {
  return keyOf(source);
}
function t(source, values) {
  const message = lookup(source);
  return values ? format(message, values, (text) => text) : message;
}
var pluralRules = /* @__PURE__ */ new Map();
function pluralRule(type, value) {
  const code = current();
  const key = `${code}:${type}`;
  let rules = pluralRules.get(key);
  if (!rules) pluralRules.set(key, rules = new Intl.PluralRules(code, { type }));
  return rules.select(value);
}
function closing(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return index;
  }
  return -1;
}
function branches(text) {
  const found = {};
  let index = 0;
  for (; ; ) {
    while (/\s/.test(text[index] ?? "")) index++;
    if (index >= text.length) return found;
    const start = index;
    while (index < text.length && !/[\s{]/.test(text[index])) index++;
    const key = text.slice(start, index);
    while (/\s/.test(text[index] ?? "")) index++;
    if (!key || text[index] !== "{") return void 0;
    const end = closing(text, index);
    if (end === -1) return void 0;
    found[key] = text.slice(index + 1, end);
    index = end + 1;
  }
}
function argument(inner, values, insert) {
  const [name, type, ...rest] = inner.split(",");
  const key = name.trim();
  if (!(key in values)) return void 0;
  const value = values[key];
  if (type === void 0) return insert(value == null ? "" : String(value));
  const options = branches(rest.join(","));
  if (!options) return void 0;
  switch (type.trim()) {
    case "plural":
    case "selectordinal": {
      const count = Number(value);
      const branch = options[`=${count}`] ?? options[pluralRule(type.trim() === "plural" ? "cardinal" : "ordinal", count)] ?? options.other;
      return branch === void 0 ? void 0 : format(branch, values, insert, insert(String(value)));
    }
    case "select": {
      const branch = options[String(value)] ?? options.other;
      return branch === void 0 ? void 0 : format(branch, values, insert);
    }
  }
  return void 0;
}
function format(message, values, insert, count) {
  let out = "";
  let index = 0;
  while (index < message.length) {
    const char = message[index];
    if (char === "#" && count !== void 0) {
      out += count;
      index++;
    } else if (char === "{") {
      const end = closing(message, index);
      if (end === -1) return out + message.slice(index);
      out += argument(message.slice(index + 1, end), values, insert) ?? message.slice(index, end + 1);
      index = end + 1;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}
function intlLocale(english2) {
  const code = current();
  return code === "en" ? english2 : code;
}
function localized(make, english2) {
  const made = /* @__PURE__ */ new Map();
  return () => {
    const code = language() && current();
    if (!made.has(code)) made.set(code, make(code === "en" ? english2 : code));
    return made.get(code);
  };
}

// apps/web/src/lib/account-sync-bus.ts
var pending = Promise.resolve();
var teamPending = Promise.resolve();
var postsPending = Promise.resolve();
var [notificationTick, setNotificationTick] = createSignal(0);

// apps/web/src/lib/time-zone.ts
var STORAGE_KEY = "plan.video.time-zone";
var deviceZone;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") deviceZone = void 0;
  });
}
function deviceTimeZone() {
  return deviceZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function isZone(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
var timeZoneKey = (userId) => userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
var owner = null;
function readSaved() {
  try {
    const saved = localStorage.getItem(timeZoneKey(owner));
    return saved && isZone(saved) ? saved : null;
  } catch {
    return null;
  }
}
var [chosenZone, setChosenZone] = createSignal(readSaved());
var fixedZone = null;
function timeZone() {
  return fixedZone ?? chosenZone() ?? deviceTimeZone();
}
function inTimeZone(zone, run) {
  const before = fixedZone;
  fixedZone = isZone(zone) ? zone : "UTC";
  try {
    return run();
  } finally {
    fixedZone = before;
  }
}
var partFormatters = /* @__PURE__ */ new Map();
function partFormatter(zone) {
  let formatter = partFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short"
    });
    partFormatters.set(zone, formatter);
  }
  return formatter;
}
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function zonedParts(moment, zone = timeZone()) {
  const parts = {};
  for (const part of partFormatter(zone).formatToParts(moment)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    date: Number(parts.day),
    hours: Number(parts.hour) % 24,
    minutes: Number(parts.minute),
    seconds: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday)
  };
}
function offsetAt(time, zone) {
  const parts = zonedParts(time, zone);
  const wall = Date.UTC(parts.year, parts.month, parts.date, parts.hours, parts.minutes, parts.seconds);
  return wall - Math.floor(time / 1e3) * 1e3;
}
function zonedTime(year, month, date = 1, hours = 0, minutes = 0, zone = timeZone()) {
  const wall = Date.UTC(year, month, date, hours, minutes);
  const first = wall - offsetAt(wall, zone);
  const second = wall - offsetAt(first, zone);
  return second + offsetAt(second, zone) === wall ? second : Math.max(first, second);
}
var pad = (value) => String(value).padStart(2, "0");
function dayKeyAt(moment, zone = timeZone()) {
  const parts = zonedParts(moment, zone);
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.date)}`;
}
function clockAt(moment, zone = timeZone()) {
  const parts = zonedParts(moment, zone);
  return `${pad(parts.hours)}:${pad(parts.minutes)}`;
}
function momentOf(day, time = "00:00", zone = timeZone()) {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  if (![year, month, date, hours, minutes].every(Number.isFinite)) return null;
  return new Date(zonedTime(year, month - 1, date, hours, minutes, zone));
}

// apps/web/src/components/calendar/utils.ts
var dayFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }), "en-GB");
var dayLongFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }), "en-GB");
var monthFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }), "en-GB");
var weekdayFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }), "en-GB");
function dateFromKey(value) {
  return /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
}
function dateKey(date) {
  return date.toISOString().slice(0, 10);
}
function isDateKey(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateFromKey(value);
  return !Number.isNaN(date.valueOf()) && dateKey(date) === value;
}
function shiftDay(value, direction) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + direction);
  return dateKey(date);
}
var WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function isWeekdayName(recurrence) {
  return WEEKDAY_NAMES.includes(recurrence);
}
function everyRecurrence(every, unit) {
  return `every:${every}:${unit}`;
}
function parseRecurrence(recurrence) {
  if (!recurrence) return null;
  if (recurrence === "weekday") return { unit: "weekday" };
  if (isWeekdayName(recurrence)) return { unit: "week", every: 1 };
  const match = /^every:(\d{1,2}):(day|week|month)$/.exec(recurrence);
  const every = Number(match?.[1]);
  return match && every >= 1 ? { unit: match[2], every } : null;
}
function daysBetween(from, to) {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 864e5);
}
var monthIndex = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
var monthLength = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
function matchesRecurrence(recurrence, day, first) {
  const date = dateFromKey(day);
  const weekday = date.getUTCDay();
  if (isWeekdayName(recurrence)) return recurrence === WEEKDAY_NAMES[weekday];
  const cadence = parseRecurrence(recurrence);
  if (!cadence || day < first) return false;
  if (cadence.unit === "weekday") return weekday >= 1 && weekday <= 5;
  if (cadence.unit === "day") return daysBetween(first, day) % cadence.every === 0;
  if (cadence.unit === "week") return daysBetween(first, day) % (7 * cadence.every) === 0;
  const start = dateFromKey(first);
  if ((monthIndex(date) - monthIndex(start)) % cadence.every !== 0) return false;
  return date.getUTCDate() === Math.min(start.getUTCDate(), monthLength(date));
}
var CADENCE_LABELS = {
  named: msg("Every {weekday}"),
  weekday: msg("Every weekday"),
  day: msg("{count, plural, =1 {Every day} other {Every # days}}"),
  week: msg("{count, plural, =1 {Every week} other {Every # weeks}}"),
  month: msg("{count, plural, =1 {Every month} other {Every # months}}"),
  weekOn: msg("{count, plural, =1 {Every {weekday}} other {Every # weeks on {weekday}}}"),
  monthOn: msg(
    "{count, plural, =1 {Every month on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}} other {Every # months on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}}}"
  )
};
var CADENCE_PHRASES = {
  named: msg("every {weekday}"),
  weekday: msg("every weekday"),
  day: msg("{count, plural, =1 {every day} other {every # days}}"),
  week: msg("{count, plural, =1 {every week} other {every # weeks}}"),
  month: msg("{count, plural, =1 {every month} other {every # months}}"),
  weekOn: msg("{count, plural, =1 {every {weekday}} other {every # weeks on {weekday}}}"),
  monthOn: msg(
    "{count, plural, =1 {every month on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}} other {every # months on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}}}"
  )
};
var RUN_SEARCH_DAYS = 3100;
function nthRunDay(recurrence, first, count) {
  let found = 0;
  for (let offset = 0; offset <= RUN_SEARCH_DAYS; offset++) {
    const day = shiftDay(first, offset);
    if (matchesRecurrence(recurrence, day, first) && ++found === count) return day;
  }
  return null;
}
function resolveRepeatEnd(end, recurrence, first) {
  const on = /^on:(\d{4}-\d{2}-\d{2})$/.exec(end ?? "")?.[1];
  if (on) return on;
  const after = Number(/^after:(\d{1,2})$/.exec(end ?? "")?.[1]);
  return after >= 1 ? nthRunDay(recurrence, first, after) : null;
}
var HOUR_HEIGHT = 64;
var MIN_CHIP_HEIGHT = 42;
var START_HOUR = 6;
var HOURS = Array.from({ length: 24 }, (_, index) => (START_HOUR + index) % 24);
var START_MINUTES = START_HOUR * 60;
var END_MINUTES = (24 + START_HOUR) * 60;
var GRID_HEIGHT = HOURS.length * HOUR_HEIGHT;
var MIDNIGHT_LINE = (24 * 60 - START_MINUTES) / 60 * HOUR_HEIGHT;
var DEFAULT_SCROLL_TOP = (8 * 60 - START_MINUTES) / 60 * HOUR_HEIGHT;
var DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 24 * 60];
var MIN_PACK_DURATION = Math.ceil((MIN_CHIP_HEIGHT + 3) / HOUR_HEIGHT * 60);
var CALENDAR_COLOR_PRESETS = [
  "rose",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "magenta",
  "pink"
];
var PRESETS = new Set(CALENDAR_COLOR_PRESETS);
var STATUS_OPTIONS = [
  { label: msg("Draft"), value: "draft" },
  { label: msg("Scheduled"), value: "scheduled" },
  { label: msg("Posted"), value: "posted" }
];
var STATUS_FILTERS = [
  { label: msg("All"), value: "all" },
  ...STATUS_OPTIONS
];
var PLATFORMS = [
  { id: "x", name: "Twitter/X", short: "X" },
  { id: "instagram", name: "Instagram", short: "IG" },
  { id: "tiktok", name: "TikTok", short: "TT" },
  { id: "youtube", name: "YouTube", short: "YT" },
  { id: "linkedin", name: "LinkedIn", short: "in" },
  { id: "facebook", name: "Facebook", short: "FB" },
  { id: "threads", name: "Threads", short: "TH" },
  { id: "bluesky", name: "Bluesky", short: "BS" },
  { id: "pinterest", name: "Pinterest", short: "PI" }
];
var PLATFORM_IDS = new Set(PLATFORMS.map((platform) => platform.id));
function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// apps/web/src/lib/plans.ts
var FREE_SCHEDULED_PER_ACCOUNT = 10;
var [scheduledLimit, setScheduledLimit] = createSignal();
var [accountsLimit, setAccountsLimit] = createSignal();
var YEARLY_SAVING = msg("(-20% off)");
var PLANS = [
  {
    id: "free",
    name: msg("Free"),
    text: msg("For trying it out."),
    price: { monthly: 0, yearly: 0 },
    accounts: 3,
    captionHours: 0.25,
    features: [
      msg("3 social accounts"),
      msg("5 GB storage"),
      msg("10 scheduled posts per account"),
      msg("Every network but X"),
      msg("Posts, carousels, stories and videos"),
      msg("Built-in video editor, 1080p export"),
      msg("Multiple accounts per network")
    ]
  },
  {
    id: "creator",
    name: msg("Creator"),
    text: msg("For creators who post every day."),
    price: { monthly: 19, yearly: 15 },
    accounts: 15,
    captionHours: 10,
    builds: msg("Free"),
    features: [
      msg("15 social accounts"),
      msg("50 GB storage"),
      msg("Unlimited posts per month"),
      msg("All networks, X included"),
      msg("Bulk and CSV scheduling"),
      msg("4K video export"),
      msg("Templates and saved captions"),
      msg("Client preview links"),
      msg("Client connect links")
    ]
  },
  {
    id: "pro",
    name: msg("Pro"),
    text: msg("For running several brands."),
    price: { monthly: 39, yearly: 31 },
    accounts: 40,
    captionHours: 20,
    builds: msg("Creator"),
    features: [msg("40 social accounts"), msg("150 GB storage"), msg("Unlimited posts per month"), msg("Unlimited team members")],
    popular: true
  },
  {
    id: "agency",
    name: msg("Agency"),
    text: msg("For agencies and clients."),
    price: { monthly: 79, yearly: 63 },
    accounts: 100,
    captionHours: 40,
    builds: msg("Pro"),
    features: [msg("100 social accounts, then \u20AC1 each"), msg("250 GB storage"), msg("Unlimited posts per month"), msg("Unlimited team members")],
    extraAccounts: { included: 100, price: 1 }
  }
];

// apps/web/src/lib/social.ts
var POST_KINDS = [
  { id: "text", name: msg("Text"), plural: "text posts" },
  { id: "image", name: msg("Image"), plural: "image posts" },
  { id: "video", name: msg("Video"), plural: "video posts" },
  { id: "story", name: msg("Story"), plural: "stories" }
];
var STORY_MAX_SECONDS = 60;
var PUBLISHING_PLATFORMS = ["tiktok", "youtube", "bluesky", "linkedin", "x", "instagram", "facebook", "threads"];
var SOCIAL_PLATFORMS = [
  {
    id: "tiktok",
    name: "TikTok",
    background: "#000000",
    logo: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
    captionLimit: 4e3,
    maxVideoSeconds: 10 * 60,
    maxImages: 35,
    customCover: true,
    kinds: ["image", "video"],
    vertical: true
  },
  {
    id: "instagram",
    name: "Instagram",
    background: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)",
    logo: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
    captionLimit: 2200,
    maxVideoSeconds: 3 * 60,
    maxImages: 35,
    publishedImages: 10,
    imageAspect: { min: 4 / 5, max: 1.91 },
    customCover: true,
    kinds: ["image", "video", "story"],
    vertical: true,
    maxHashtags: 30
  },
  {
    id: "youtube",
    name: "YouTube",
    background: "#FF0000",
    logo: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    captionLimit: 5e3,
    title: { limit: 100, required: true, cutOff: 60 },
    maxVideoSeconds: 12 * 60 * 60,
    maxImages: 0,
    kinds: ["video"],
    vertical: false,
    maxHashtags: 60
  },
  {
    id: "x",
    name: "Twitter/X",
    background: "#000000",
    logo: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
    captionLimit: 280,
    maxVideoSeconds: 20 * 60,
    maxImages: 4,
    kinds: ["text", "image", "video"],
    vertical: false
  },
  {
    id: "facebook",
    name: "Facebook",
    background: "#0866FF",
    logo: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
    captionLimit: 63206,
    maxVideoSeconds: 240 * 60,
    maxImages: 10,
    kinds: ["text", "image", "video", "story"],
    vertical: false
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    background: "#0A66C2",
    logo: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
    captionLimit: 3e3,
    maxVideoSeconds: 15 * 60,
    maxImages: 20,
    kinds: ["text", "image", "video"],
    vertical: false
  },
  {
    id: "threads",
    name: "Threads",
    background: "#000000",
    logo: "M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z",
    captionLimit: 500,
    maxVideoSeconds: 5 * 60,
    maxImages: 20,
    kinds: ["text", "image", "video"],
    vertical: false
  },
  {
    id: "bluesky",
    name: "Bluesky",
    background: "#1185FE",
    logo: "M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026",
    captionLimit: 300,
    maxVideoSeconds: 3 * 60,
    maxImages: 4,
    kinds: ["text", "image", "video"],
    vertical: false
  },
  {
    id: "pinterest",
    name: "Pinterest",
    background: "#E60023",
    logo: "M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z",
    captionLimit: 500,
    title: { limit: 100, required: false },
    maxVideoSeconds: 15 * 60,
    maxImages: 5,
    customCover: true,
    kinds: ["image", "video"],
    vertical: false
  }
];
var PLATFORM_IDS2 = SOCIAL_PLATFORMS.map((platform) => platform.id);
function socialPlatform(id) {
  return SOCIAL_PLATFORMS.find((platform) => platform.id === id);
}
var NAME_LIST = localized((locale) => new Intl.ListFormat(locale, { type: "conjunction" }), "en-GB");
function listNames(ids) {
  const names = ids.map((id) => socialPlatform(id).name);
  if (names.length <= 1) return names.join("");
  if (names.length > 3) return NAME_LIST().format([...names.slice(0, 2), t("{count, plural, one {# more} other {# more}}", { count: names.length - 2 })]);
  return NAME_LIST().format(names);
}
function sortPlatforms(ids) {
  const picked = new Set(ids);
  return PLATFORM_IDS2.filter((id) => picked.has(id));
}
function captionLength(text) {
  return [...text].length;
}
var X_URL = new RegExp("(?<![\\p{L}\\p{N}@.])(?:https?:\\/\\/)?(?:[\\p{L}\\p{N}-]+\\.)+\\p{L}{2,}(?::\\d+)?(?:\\/\\S*)?", "gu");
var X_EMOJI = new RegExp("\\p{RI}\\p{RI}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})*)*", "gu");
var X_LIGHT = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247]
];
function xLength(text) {
  let length = 0;
  const rest = text.normalize("NFC").replace(X_URL, () => (length += 23, "\0")).replace(X_EMOJI, () => (length += 2, "\0"));
  for (const char of rest) {
    const code = char.codePointAt(0);
    if (code) length += X_LIGHT.some(([low, high]) => code >= low && code <= high) ? 1 : 2;
  }
  return length;
}
var captionLengthOn = (network, text) => network === "x" ? xLength(text) : captionLength(text);
function hashtagCount(text) {
  return text.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
function picturesOut(id) {
  const platform = socialPlatform(id);
  return Math.min(platform.maxImages, platform.publishedImages ?? platform.maxImages);
}
function settingsIssues(id, settings, add2) {
  if (id === "tiktok") {
    if (settings.tiktok.inbox) return;
    const { disclose, yourBrand, brandedContent, privacy } = settings.tiktok;
    if (!privacy) add2("error", t("Pick who can watch."));
    if (disclose && !yourBrand && !brandedContent) {
      add2("error", t("You need to indicate if your content promotes yourself, a third party, or both."));
    }
    if (disclose && brandedContent && privacy === "private") add2("error", t("Branded content visibility cannot be set to private."));
  }
  if (id === "youtube" && youtubeTagsLength(settings.youtube.tags) > YOUTUBE_TAGS_LIMIT) {
    add2("error", t("Tags are over the {limit} character limit.", { limit: YOUTUBE_TAGS_LIMIT }));
  }
  if (id === "youtube" && settings.youtube.tags.some((tag) => captionLength(tag) > 30)) {
    add2("error", t("A YouTube tag can be 30 characters."));
  }
  if (id === "instagram" && settings.instagram.collaborators.length > INSTAGRAM_MAX_COLLABORATORS) {
    add2("error", t("Takes up to {count, plural, one {# collaborator} other {# collaborators}}.", { count: INSTAGRAM_MAX_COLLABORATORS }));
  }
  if (id === "x" && settings.x.community.trim() && !xCommunityId(settings.x.community)) {
    add2("error", t("Paste the community's link, like x.com/i/communities/\u2026"));
  }
  if (id === "pinterest" && !settings.pinterest.board.trim()) add2("error", t("Pick a board."));
}
function checkPost(input) {
  const issues = [];
  for (const id of input.platforms) {
    const platform = socialPlatform(id);
    const media = input.media(id);
    const add2 = (level, message, crop) => issues.push({ platform: id, level, message, crop });
    if (!platform.kinds.includes(input.kind)) {
      if (input.kind === "text") add2("error", platform.kinds.includes("image") ? t("Add a video or pictures.") : t("Add a video."));
      else add2("error", t("Doesn't take {kind, select, image {image posts} video {video posts} story {stories} other {text posts}}.", { kind: input.kind }));
      continue;
    }
    if (input.settings && input.kind !== "story") settingsIssues(id, input.settings, add2);
    if (input.kind === "story") {
      if (!media) add2("error", t("Needs a picture or a video."));
      else if (media.kind === "images" && media.count > 1) add2("error", t("A story takes one picture."));
      else if (media.kind === "video" && media.duration > STORY_MAX_SECONDS) {
        add2("error", t("Story videos can be up to {duration}.", { duration: formatDuration(STORY_MAX_SECONDS) }));
      }
      if (media && media.width > 0 && !isAspect(media.width, media.height, 9 / 16)) add2("warning", t("Not 9:16, so it shows with bars."));
      continue;
    }
    const caption = input.caption(id);
    const length = captionLengthOn(id, caption);
    if (length > platform.captionLimit) {
      add2(
        "error",
        t("Caption is {over} over the {limit} limit.", {
          over: (length - platform.captionLimit).toLocaleString(intlLocale()),
          limit: platform.captionLimit.toLocaleString(intlLocale())
        })
      );
    }
    if (platform.maxHashtags && hashtagCount(caption) > platform.maxHashtags) {
      add2("error", t("Takes up to {count, plural, one {# hashtag} other {# hashtags}}.", { count: platform.maxHashtags }));
    }
    if (platform.title) {
      const title = input.title(id).trim();
      if (platform.title.required && !title) add2("error", t("Needs a title."));
      const length2 = captionLength(title);
      if (length2 > platform.title.limit) add2("error", t("Title is over the {limit} limit.", { limit: platform.title.limit }));
      else if (platform.title.cutOff && length2 > platform.title.cutOff) {
        add2("warning", t("Titles over {count, plural, one {# character} other {# characters}} get cut off in search.", { count: platform.title.cutOff }));
      }
    }
    if (input.kind === "text") {
      if (!caption.trim()) add2("error", t("Needs some text."));
      continue;
    }
    if (!media) {
      add2("error", input.kind === "image" ? t("Needs a picture.") : t("Needs a video."));
      continue;
    }
    if (media.kind === "images") {
      const out = picturesOut(id);
      if (media.count > out) {
        const skipped = media.count - out;
        add2(
          "warning",
          t("Takes the first {count, plural, one {# picture} other {# pictures}} and skips the other {skipped, plural, =1 {one} other {#}}.", { count: out, skipped })
        );
      }
      if (platform.imageAspect && media.count > 0) {
        const aspect = media.width / media.height;
        if (aspect < platform.imageAspect.min || aspect > platform.imageAspect.max) add2("warning", t("The first picture is cropped to fit."), true);
        if (media.count > 1 && media.mixedShapes) add2("warning", t("Pictures are cropped to the first one's shape."));
      }
    } else if (media.duration > platform.maxVideoSeconds) {
      add2("error", t("Videos can be up to {duration}.", { duration: formatDuration(platform.maxVideoSeconds) }));
    }
    const cropped = media.kind === "images" && platform.imageAspect;
    if (platform.vertical && !cropped && media.width > 0 && media.height > 0 && media.width / media.height > 0.8) {
      add2("warning", t("Not vertical, so it plays with bars."));
    }
  }
  return issues;
}
function isAspect(width, height, ratio) {
  return width > 0 && height > 0 && Math.abs(width / height / ratio - 1) < 0.02;
}
function youtubeFormat(media) {
  return media?.kind === "video" && isAspect(media.width, media.height, 9 / 16) && media.duration <= 180 ? "short" : "video";
}
function youtubePostSettings(settings, description = "", extra) {
  return {
    title: [...(extra?.title ?? settings.youtube.title).trim()].slice(0, 100).join(""),
    description: [...description].slice(0, 5e3).join(""),
    privacy: settings.youtube.privacy,
    madeForKids: settings.youtube.madeForKids,
    // A copy: the form's tags are a live store array, which the browser can't save.
    tags: [...settings.youtube.tags],
    ...extra?.short ? { short: true } : {}
  };
}
function defaultPlatformSettings() {
  return {
    tiktok: { privacy: null, comments: false, duet: false, stitch: false, disclose: false, yourBrand: false, brandedContent: false, inbox: false },
    instagram: { shareToFeed: true, collaborators: [] },
    youtube: { title: "", privacy: "public", madeForKids: false, tags: [] },
    x: { replies: "everyone", community: "" },
    pinterest: { title: "", link: "", board: "" }
  };
}
var INSTAGRAM_MAX_COLLABORATORS = 3;
var YOUTUBE_TAGS_LIMIT = 500;
function youtubeTag(raw) {
  const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ");
  return tag || null;
}
function youtubeTagsLength(tags) {
  return tags.reduce((sum2, tag, index) => sum2 + captionLength(tag) + (tag.includes(" ") ? 2 : 0) + (index ? 1 : 0), 0);
}
function xCommunityId(raw) {
  const text = raw.trim();
  if (/^\d{5,19}$/.test(text)) return text;
  return text.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x)\.com\/i\/communities\/(\d{5,19})\/?(?:[?#]\S*)?$/i)?.[1] ?? null;
}

// apps/web/src/lib/thread.ts
var THREAD_PLATFORMS = ["x", "linkedin", "bluesky"];
var REPLY_MEDIA_PLATFORMS = ["x", "bluesky"];
var REPLY_LIMITS = { x: 280, bluesky: 300, linkedin: 1250 };
var replyLimit = (id) => REPLY_LIMITS[id] ?? socialPlatform(id).captionLimit;
var REPLY_DELAYS = [
  { minutes: 0, label: msg("Right away") },
  { minutes: 1, label: msg("1 minute") },
  { minutes: 5, label: msg("5 minutes") },
  { minutes: 15, label: msg("15 minutes") },
  { minutes: 30, label: msg("30 minutes") },
  { minutes: 60, label: msg("1 hour") },
  { minutes: 180, label: msg("3 hours") },
  { minutes: 360, label: msg("6 hours") },
  { minutes: 720, label: msg("12 hours") },
  { minutes: 1440, label: msg("1 day") }
];
var threadPlatforms = (platforms) => THREAD_PLATFORMS.filter((id) => platforms.includes(id));
function threadIssues(thread, platforms, media = () => null) {
  const issues = [];
  thread.forEach((reply, index) => {
    const number = index + 1;
    const text = reply.text.trim();
    const carries = media(index);
    for (const id of threadPlatforms(platforms)) {
      const add2 = (level, message) => issues.push({ platform: id, level, message });
      const limit = replyLimit(id);
      const length = captionLengthOn(id, text);
      if (length > limit) add2("error", t("Follow-up {number} is over the {limit} character limit.", { number, limit: limit.toLocaleString(intlLocale()) }));
      if (!carries) continue;
      if (!REPLY_MEDIA_PLATFORMS.includes(id)) {
        if (!length) add2("warning", t("Follow-up {number} has no words, so {network} skips it.", { number, network: socialPlatform(id).name }));
        continue;
      }
      const most = socialPlatform(id).maxVideoSeconds;
      if (carries.kind === "video" && carries.duration > most) {
        add2("error", t("Follow-up {number}'s video is over {network}'s {duration}.", { number, network: socialPlatform(id).name, duration: formatDuration(most) }));
      }
    }
  });
  return issues;
}

// apps/web/src/lib/post-sync-core.ts
var TOO_MANY_POSTS = msg("This account has reached its limit of 100,000 posts. Delete some old posts to make room for new ones.");
var OVERLAP_MS = 2 * 6e4;
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).filter((key) => record[key] !== void 0).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// apps/web/src/lib/post-rules.ts
function postTitle(caption, fallback) {
  const line = caption.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  const title = line || fallback;
  return [...title].length > 80 ? `${[...title].slice(0, 79).join("")}\u2026` : title;
}
function latestSchedule(from = /* @__PURE__ */ new Date(), zone = timeZone()) {
  const parts = zonedParts(from, zone);
  return new Date(zonedTime(parts.year, parts.month + 2, parts.date, parts.hours, parts.minutes, zone));
}
function scheduleProblem(at, zone = timeZone(), now = Date.now()) {
  if (!at) return msg("Pick a date and a time.");
  if (at.getTime() <= now) return msg("Pick a time in the future.");
  if (at > latestSchedule(new Date(now), zone)) return msg("Posts can be scheduled up to 2 months ahead.");
  return null;
}
var CAPTION_NOTE = "One caption is stored for every platform on a post. If it is over a platform's limit, shorten it or leave that platform off.";
var PUBLISHES = new Set(PUBLISHING_PLATFORMS);
var NEEDS_FILE = /* @__PURE__ */ new Set(["tiktok", "youtube", "instagram"]);
function threadOf(input, platforms) {
  if (input === void 0) return void 0;
  const thread = input.filter((reply) => reply.text.trim()).map((reply) => {
    const wanted = reply.delayMinutes ?? 0;
    const nearest = REPLY_DELAYS.reduce((best, option) => Math.abs(option.minutes - wanted) < Math.abs(best - wanted) ? option.minutes : best, 0);
    return { id: newId(), text: reply.text.trim(), delay: nearest };
  });
  const problem = inEnglish(() => threadIssues(thread, platforms)[0]);
  if (problem) throw new DapiError("invalid-input", `${socialPlatform(problem.platform).name}: ${problem.message}`);
  return thread;
}
function definedOnly(value) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item !== void 0));
}
function isPlatform(id) {
  return PLATFORM_IDS2.includes(id);
}
function clock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) throw new DapiError("invalid-input", "Time is HH:MM, 24-hour, such as 09:00.");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
function refuseSoon(platforms, existing = []) {
  const soon = platforms.filter((id) => !PUBLISHES.has(id) && !existing.includes(id)).map((id) => socialPlatform(id).name);
  if (soon.length) throw new DapiError("unsupported", `${soon.join(", ")} ${soon.length === 1 ? "is" : "are"} coming soon, so plan.video can't post there yet. Leave ${soon.length === 1 ? "it" : "them"} off the post.`);
}
function repeatOf(repeat, day) {
  if (!repeat) return { repeat: "", repeatEnd: "" };
  if (repeat.until && repeat.times) throw new DapiError("invalid-input", "A repeat ends on a day or after a number of posts, not both.");
  if (repeat.until && !isDateKey(repeat.until)) throw new DapiError("invalid-input", "The repeat end needs a day as YYYY-MM-DD.");
  const recurrence = repeat.unit === "weekday" ? "weekday" : everyRecurrence(repeat.every ?? 0, repeat.unit);
  if (!parseRecurrence(recurrence)) throw new DapiError("invalid-input", "Say how often it repeats, for example every 1 week.");
  const repeatEnd = repeat.until ? `on:${repeat.until}` : repeat.times ? `after:${repeat.times}` : "";
  const end = resolveRepeatEnd(repeatEnd || void 0, recurrence, day);
  if (end && end < day) throw new DapiError("invalid-input", "Pick an end on or after the first post.");
  return { repeat: recurrence, repeatEnd };
}
function cleanTags(tags) {
  const cleaned = tags.map((tag) => youtubeTag(tag)).filter((tag) => !!tag);
  if (cleaned.some((tag) => captionLength(tag) > 30)) throw new DapiError("invalid-input", "A YouTube tag can be 30 characters.");
  if (youtubeTagsLength(cleaned) > YOUTUBE_TAGS_LIMIT) {
    throw new DapiError("invalid-input", `YouTube tags are over the ${YOUTUBE_TAGS_LIMIT} character limit.`);
  }
  return cleaned;
}
function youtubeOf(input, existing, platforms, caption, media, fallbackTitle = existing?.title) {
  if (!platforms.includes("youtube")) return void 0;
  const settings = defaultPlatformSettings();
  settings.youtube.privacy = input?.privacy ?? existing?.privacy ?? "public";
  settings.youtube.madeForKids = input?.madeForKids ?? existing?.madeForKids ?? false;
  settings.youtube.tags = input?.tags ? cleanTags(input.tags) : existing?.tags ?? [];
  const title = input?.title?.trim() || fallbackTitle || postTitle(caption, "Untitled post");
  settings.youtube.title = title;
  const next = youtubePostSettings(settings, caption, { title, short: media ? youtubeFormat(media) === "short" : existing?.short === true });
  if (!(media ? youtubeFormat(media) === "short" : existing?.short === true)) delete next.short;
  return next;
}
function tiktokOf(input, existing) {
  const inbox = input?.inbox ?? existing?.inbox ?? false;
  if (inbox) {
    return {
      privacy: input?.privacy ?? existing?.privacy ?? "private",
      comments: false,
      duet: false,
      stitch: false,
      yourBrand: false,
      brandedContent: false,
      inbox: true
    };
  }
  const answered = existing && !existing.inbox ? existing : void 0;
  const privacy = input?.privacy ?? answered?.privacy;
  if (!privacy) return void 0;
  if (!answered && !input?.promotion) throw new DapiError("invalid-input", PROMOTION_QUESTION);
  const promotion = input?.promotion ? promotionFlags(input.promotion) : { yourBrand: answered?.yourBrand ?? false, brandedContent: answered?.brandedContent ?? false };
  if (promotion.brandedContent && privacy === "private") {
    throw new DapiError("invalid-input", "Branded content can't be private on TikTok. Ask the user for another privacy, or to take branded content off.");
  }
  return {
    privacy,
    comments: input?.comments ?? answered?.comments ?? false,
    duet: input?.duet ?? answered?.duet ?? false,
    stitch: input?.stitch ?? answered?.stitch ?? false,
    ...promotion
  };
}
function requireTikTok(platforms, tiktok, scheduling) {
  if (!scheduling || !platforms.includes("tiktok") || tiktok?.inbox || tiktok?.privacy) return;
  throw new DapiError(
    "invalid-input",
    "TikTok needs who can watch. Call tiktok_creator for the choices this account has, ask the user, and pass tiktok.privacy with tiktok.promotion. Or set tiktok.inbox so it goes to the TikTok app as a draft. Save with draft true if you don't know yet."
  );
}
var toProfile = (platforms, tiktok) => platforms.includes("tiktok") && !!tiktok && !tiktok.inbox;
function assertFits(input) {
  const issues = inEnglish(
    () => checkPost({
      kind: input.kind,
      platforms: input.platforms,
      caption: (id) => input.own?.[id] ?? input.caption,
      title: (id) => id === "youtube" || id === "pinterest" ? input.title : "",
      media: input.media
    })
  );
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    throw new DapiError("invalid-input", errors.map((issue) => `${socialPlatform(issue.platform).name}: ${issue.message}`).join(" "));
  }
  return issues.filter((issue) => issue.level === "warning").map((issue) => `${socialPlatform(issue.platform).name}: ${issue.message}`);
}
function platformNotes(platform) {
  const pictures = Math.min(platform.maxImages, platform.publishedImages ?? platform.maxImages);
  const parts = [
    PUBLISHES.has(platform.id) ? platform.id === "youtube" ? "plan.video can upload a video here." : platform.id === "tiktok" ? `plan.video can post here: a video, or up to ${pictures} pictures as a photo post.` : `plan.video can post here: the words, with the post's video or up to ${pictures} of its pictures.` : "Kept on the calendar. plan.video doesn't send to this platform yet."
  ];
  if (platform.title?.required) parts.push("A title is required.");
  if (!platform.kinds.includes("text")) parts.push("Needs a picture or a video.");
  if (platform.id === "tiktok") {
    parts.push(
      "Before scheduling or publishing to the profile, call tiktok_creator, ask the user who can watch and whether the post promotes something, and have them accept TikTok's terms. Or pass inbox true to finish it in TikTok."
    );
  }
  return parts.join(" ");
}
function socialSchemaView(platform) {
  return {
    caption: CAPTION_NOTE,
    platforms: SOCIAL_PLATFORMS.filter((item) => !platform || item.id === platform).map((item) => ({
      id: item.id,
      name: item.name,
      captionLimit: item.captionLimit,
      maxVideoSeconds: item.maxVideoSeconds,
      maxImages: item.maxImages,
      hashtagLimit: item.maxHashtags ?? null,
      kinds: [...item.kinds],
      publishes: PUBLISHES.has(item.id),
      media: item.kinds.includes("text") ? "optional" : "required",
      notes: platformNotes(item)
    }))
  };
}
function readChoices(value) {
  const next = {};
  if (!value || typeof value !== "object") return next;
  for (const [platform, ids] of Object.entries(value)) {
    const list = typeof ids === "string" ? [ids] : Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
    if (list.length) next[platform] = [...new Set(list)];
  }
  return next;
}
function pickAccounts(connections, platforms, requested) {
  const result = chooseAccounts(
    platforms,
    requested,
    connections.map(({ id, platform, handle }) => ({ id, platform, handle })),
    (id) => isPlatform(id) ? socialPlatform(id).name : id
  );
  if (!result.ok) throw new DapiError("invalid-input", result.message);
  return result.choices;
}
function keptAccountIds(connections, platform, ids) {
  return ids.filter((id) => connections.some((account) => account.id === id && account.platform === platform));
}
function mergeAccountChoices(connections, platforms, requested, existing) {
  if (requested && requested.length > 0) return pickAccounts(connections, platforms, requested);
  const previous = readChoices(existing);
  const missing = [];
  const keeping = [];
  const keptIds = [];
  const removed = {};
  for (const platform of platforms) {
    const named = previous[platform] ?? [];
    const kept2 = keptAccountIds(connections, platform, named);
    if (kept2.length > 0) {
      keeping.push(platform);
      keptIds.push(...kept2);
    } else if (named.length > 0) removed[platform] = named;
    else missing.push(platform);
  }
  const kept = keeping.length > 0 ? pickAccounts(connections, keeping, keptIds) : {};
  const added = missing.length > 0 ? pickAccounts(connections, missing, void 0) : {};
  return { ...kept, ...added, ...removed };
}
function removedAccountNotes(connections, platforms, choices) {
  return platforms.filter((platform) => (choices[platform]?.length ?? 0) > 0 && keptAccountIds(connections, platform, choices[platform] ?? []).length === 0).map((platform) => {
    const name = socialPlatform(platform).name;
    return `${name}: The account it named was removed, so it won't go out on ${name} until you pass accounts with a ${name} id from social_accounts.`;
  });
}
function postViewOf(post, scope, warnings = []) {
  const platforms = [];
  for (const id of post.platforms) {
    if (!isPlatform(id)) continue;
    const chosen = readChoices(post.accounts)[id] ?? [];
    const ids = chosen.length > 0 ? chosen : [""];
    for (const accountId of ids) {
      const found = scope.connections.find((account) => account.id === accountId);
      platforms.push({ platform: id, accountId, handle: found?.handle ?? "", publishes: PUBLISHES.has(id) });
    }
  }
  const deliveries = Object.entries(post.deliveries ?? {}).flatMap(([id, delivery]) => {
    if (!delivery || !isPlatform(id)) return [];
    return [{ platform: id, state: delivery.state, ...delivery.error ? { error: delivery.error } : {} }];
  });
  const approval = approvalOf(post);
  return {
    id: post.id,
    status: post.status,
    approval: approval ? { state: approval.state, ...approval.by ? { by: approval.by } : {}, ...approval.note ? { note: approval.note } : {} } : null,
    title: post.title,
    caption: post.description ?? "",
    day: post.day,
    time: post.allDay ? null : post.start,
    timeZone: post.timeZone || scope.timeZone,
    platforms,
    repeat: post.recurrence,
    link: post.link,
    thread: (post.thread ?? []).map((reply) => ({ text: reply.text, delayMinutes: reply.delay })),
    warnings,
    deliveries
  };
}
var AWAITING_APPROVAL = msg("This post is waiting for approval. Once it's approved it goes out at its time.");
function isApproval(value) {
  const state = value?.state;
  return state === "pending" || state === "changes" || state === "approved";
}
var awaitingApproval = (post) => isApproval(post.approval) && post.approval.state !== "approved";
var approvalOf = (post) => isApproval(post.approval) ? post.approval : void 0;
var contentOf = ({ status: _status, sendFrom: _sendFrom, deliveries: _deliveries, thumbnail: _thumbnail, timeZone: _zone, ...rest }) => stable(rest);
function approvalRules(saved, next, rules, at = (/* @__PURE__ */ new Date()).toISOString()) {
  if (next.status !== "scheduled") return next;
  if (rules.approver) return awaitingApproval(next) ? { ...next, approval: { state: "approved", via: "team", at } } : next;
  if (saved?.status === "scheduled" && contentOf(saved) === contentOf(next)) return next;
  if (!awaitingApproval(next) && !rules.membersNeedApproval) return next;
  const approval = awaitingApproval(next) ? next.approval : { state: "pending", at };
  return { ...next, status: "draft", approval, sendFrom: at };
}
var HELD_FOR_APPROVAL = "Posts in this workspace need approval first, so it waits as a draft until the owner or an admin approves it, then goes out at its time. Call ask_for_approval for the link to send them.";
function heldWarning(post, scheduling) {
  return scheduling && post.status === "draft" && awaitingApproval(post) ? [HELD_FOR_APPROVAL] : [];
}
var PRIVACY_FROM_API = {
  PUBLIC_TO_EVERYONE: "public",
  MUTUAL_FOLLOW_FRIENDS: "friends",
  FOLLOWER_OF_CREATOR: "followers",
  SELF_ONLY: "private"
};
function readTikTokCreator(data) {
  const listed = Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [];
  const privacy = listed.flatMap((item) => {
    const mapped = typeof item === "string" ? PRIVACY_FROM_API[item] : void 0;
    return mapped ? [mapped] : [];
  });
  if (!privacy.length) return null;
  const max = Number(data.max_video_post_duration_sec);
  return {
    nickname: typeof data.creator_nickname === "string" && data.creator_nickname ? data.creator_nickname : "TikTok",
    username: typeof data.creator_username === "string" ? data.creator_username : "",
    avatarUrl: typeof data.creator_avatar_url === "string" ? data.creator_avatar_url : "",
    privacy,
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoSeconds: Number.isFinite(max) && max > 0 ? max : 10 * 60
  };
}
function tiktokCreatorView(accountId, creator) {
  return {
    accountId,
    nickname: creator.nickname,
    username: creator.username,
    privacy: creator.privacy,
    comments: !creator.commentDisabled,
    duet: !creator.duetDisabled,
    stitch: !creator.stitchDisabled,
    maxVideoSeconds: creator.maxVideoSeconds,
    consent: tiktokConsent(false),
    brandedConsent: tiktokConsent(true)
  };
}

// apps/web/src/lib/social-analytics.ts
var ANALYTICS_PLATFORMS = [
  { id: "tiktok", name: "TikTok", color: "#2fd6e6" },
  { id: "youtube", name: "YouTube", color: "#ff4d4d" },
  { id: "instagram", name: "Instagram", color: "#d65cf0" },
  { id: "facebook", name: "Facebook", color: "#4a8cff" },
  { id: "threads", name: "Threads", color: "#b8bcc6" },
  { id: "linkedin", name: "LinkedIn", color: "#70b5f9" }
];
var ANALYTICS_METRICS = [
  { id: "views", label: msg("Views") },
  { id: "likes", label: msg("Likes") },
  { id: "comments", label: msg("Comments") }
];
var INTERVALS = [
  { id: "hour", label: msg("Hourly") },
  { id: "day", label: msg("Daily") },
  { id: "week", label: msg("Weekly") },
  { id: "month", label: msg("Monthly") }
];
var [synced, setSynced] = createSignal(/* @__PURE__ */ new Map());
function withSyncedNumbers(numbers2, run) {
  const before = synced();
  setSynced(numbers2);
  try {
    return run();
  } finally {
    setSynced(before);
  }
}
function postingDayNumbers(posts2) {
  const days = /* @__PURE__ */ new Map();
  for (const post of posts2) {
    const day = dayOfKey(dayKeyOf(post.postedAt));
    const before = days.get(day);
    days.set(day, {
      views: (before?.views ?? 0) + post.views,
      likes: (before?.likes ?? 0) + post.likes,
      comments: (before?.comments ?? 0) + post.comments
    });
  }
  return days;
}
function youtubeNumbers(found) {
  const days = /* @__PURE__ */ new Map();
  for (const row of found.days ?? []) days.set(dayOfKey(row.date), { views: row.views, likes: row.likes, comments: row.comments });
  return { days, posts: found.videos ?? [] };
}
function dayOfKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}
var HISTORY_DAYS = 730;
var PROFILES = {
  tiktok: { views: 14200, growth: 55e-4, likeRate: 0.071, commentRate: 41e-4, weekend: 1.18, postRate: 0.45, peak: 20.5 },
  youtube: { views: 5300, growth: 38e-4, likeRate: 0.042, commentRate: 32e-4, weekend: 1.26, postRate: 0.18, peak: 18.5 },
  instagram: { views: 7700, growth: 24e-4, likeRate: 0.057, commentRate: 25e-4, weekend: 1.08, postRate: 0.34, peak: 19.5 },
  facebook: { views: 2300, growth: -18e-4, likeRate: 0.025, commentRate: 19e-4, weekend: 0.92, postRate: 0.22, peak: 13 },
  threads: { views: 3100, growth: 42e-4, likeRate: 0.048, commentRate: 62e-4, weekend: 1.02, postRate: 0.5, peak: 21 },
  linkedin: { views: 1900, growth: 31e-4, likeRate: 0.022, commentRate: 28e-4, weekend: 0.55, postRate: 0.2, peak: 9 }
};
var TITLES = [
  msg("Founder Q&A"),
  msg("Studio tour"),
  msg("Weekly tip"),
  msg("Podcast clip"),
  msg("Case study"),
  msg("On set"),
  msg("Launch teaser"),
  msg("How it works"),
  msg("Walkthrough"),
  msg("BTS reel"),
  msg("Q&A clip"),
  msg("Sunday vlog"),
  msg("Launch recap"),
  msg("Two-minute edit"),
  msg("Before and after"),
  msg("Day in the studio"),
  msg("Five hooks that work"),
  msg("Client shoot"),
  msg("What we use to film"),
  msg("Captions, start to finish")
];
var COVERS = ["creator", "surf", "sunset", "vlogger", "wave", "ride", "golden", "shore"].map((name) => `/site/${name}.webp`);
var HOUR_MS = 36e5;
var DAY_MS = 864e5;
function dayNumber(date) {
  const parts = zonedParts(date);
  return Math.floor(Date.UTC(parts.year, parts.month, parts.date) / DAY_MS);
}
function dayKeyOf(time) {
  return new Date(dayNumber(new Date(time)) * DAY_MS).toISOString().slice(0, 10);
}
function startOf(time, interval) {
  const parts = zonedParts(time);
  if (interval === "hour") return Math.floor(time / 1e3) * 1e3 - (parts.minutes * 60 + parts.seconds) * 1e3;
  if (interval === "day") return zonedTime(parts.year, parts.month, parts.date);
  if (interval === "week") return zonedTime(parts.year, parts.month, parts.date - (parts.weekday + 6) % 7);
  return zonedTime(parts.year, parts.month, 1);
}
function advance(time, interval) {
  if (interval === "hour") return startOf(time + HOUR_MS, "hour");
  const parts = zonedParts(time);
  if (interval === "day") return zonedTime(parts.year, parts.month, parts.date + 1);
  if (interval === "week") return zonedTime(parts.year, parts.month, parts.date + 7);
  return zonedTime(parts.year, parts.month + 1, 1);
}
function bucketsFor(span, interval) {
  const list = [];
  for (let cursor = startOf(span.start, interval); cursor < span.end; cursor = advance(cursor, interval)) {
    list.push({ start: Math.max(cursor, span.start), end: Math.min(advance(cursor, interval), span.end) });
  }
  return list;
}
function noise(...parts) {
  let hash = 2166136261;
  for (const char of parts.join(":")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}
function burst(seed, day) {
  return noise(seed, day, "burst") < 0.07 ? 1.4 + noise(seed, day, "size") * 2.4 : 0;
}
function trend(profile, day, today) {
  return Math.exp(profile.growth * 180 * Math.tanh((day - today) / 180));
}
function bell(value, center, width) {
  return Math.exp(-((value - center) ** 2) / (2 * width * width));
}
var ZERO = { views: 0, likes: 0, comments: 0 };
var fromNetwork = (source) => !!source.account && !source.sample;
var dayCache = /* @__PURE__ */ new Map();
var hourCache = /* @__PURE__ */ new Map();
function dayStats(source, day, today) {
  if (fromNetwork(source)) return synced().get(source.key)?.days.get(day) ?? ZERO;
  if (day < today - HISTORY_DAYS || day > today) return ZERO;
  const key = `${source.key}:${day}:${today}`;
  const cached = dayCache.get(key);
  if (cached) return cached;
  const seed = source.key;
  const profile = PROFILES[source.platform];
  const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
  const lift = 1 + burst(seed, day) + 0.45 * burst(seed, day - 1) + 0.15 * burst(seed, day - 2);
  const views = profile.views * trend(profile, day, today) * lift * (weekday >= 5 ? profile.weekend : 1) * (0.84 + 0.32 * noise(seed, day, "views"));
  const stats = {
    views,
    likes: views * profile.likeRate * (0.85 + 0.3 * noise(seed, day, "likes")),
    comments: views * profile.commentRate * (0.7 + 0.6 * noise(seed, day, "comments"))
  };
  dayCache.set(key, stats);
  return stats;
}
function hourShares(source, day) {
  const key = `${source.key}:${day}`;
  const cached = hourCache.get(key);
  if (cached) return cached;
  const profile = PROFILES[source.platform];
  const weekend = (new Date(day * DAY_MS).getUTCDay() + 6) % 7 >= 5;
  const peak = profile.peak + (weekend ? 1 : 0);
  const raw = Array.from(
    { length: 24 },
    (_, hour) => (bell(hour, peak, 2.4) + 0.5 * bell(hour, 12.5, 1.3) + 0.2 * bell(hour, 8, 1.4) + 0.04) * (0.7 + 0.6 * noise(source.key, day, hour, "hour"))
  );
  const total = raw.reduce((sum2, value) => sum2 + value, 0);
  const shares = raw.map((value) => value / total);
  hourCache.set(key, shares);
  return shares;
}
function add(total, row, share = 1) {
  return {
    views: total.views + row.views * share,
    likes: total.likes + row.likes * share,
    comments: total.comments + row.comments * share
  };
}
function round(row) {
  return { views: Math.round(row.views), likes: Math.round(row.likes), comments: Math.round(row.comments) };
}
function spanTotals(source, span, today) {
  let total = ZERO;
  let cursor = span.start;
  while (cursor < span.end) {
    const date = new Date(cursor);
    const parts = zonedParts(date);
    const dayStart = zonedTime(parts.year, parts.month, parts.date);
    const dayEnd = zonedTime(parts.year, parts.month, parts.date + 1);
    const stop = Math.min(span.end, dayEnd);
    const day = dayNumber(date);
    const stats = dayStats(source, day, today);
    if (cursor === dayStart && stop === dayEnd) {
      total = add(total, stats);
    } else if (fromNetwork(source)) {
      if (cursor === dayStart) total = add(total, stats);
    } else if (stats.views) {
      const shares = hourShares(source, day);
      let share = 0;
      for (let hour = 0; hour < 24; hour++) {
        const from = zonedTime(parts.year, parts.month, parts.date, hour);
        const overlap = Math.min(stop, from + HOUR_MS) - Math.max(cursor, from);
        if (overlap > 0) share += shares[hour] * (overlap / HOUR_MS);
      }
      total = add(total, stats, share);
    }
    cursor = stop;
  }
  return total;
}
function sum(rows) {
  return rows.reduce((total, row) => ({
    views: total.views + row.views,
    likes: total.likes + row.likes,
    comments: total.comments + row.comments
  }), ZERO);
}
function posts(sources, span, today) {
  const list = [];
  const first = dayNumber(new Date(span.start));
  const last = dayNumber(new Date(span.end - 1));
  for (const source of sources) {
    const { platform, key: seed } = source;
    if (fromNetwork(source)) {
      for (const post of synced().get(seed)?.posts ?? []) {
        if (post.postedAt < span.start || post.postedAt >= span.end) continue;
        list.push({ ...post, id: `${seed}-${post.id}`, networkId: post.id, platform, source: seed, handle: source.handle });
      }
      continue;
    }
    const profile = PROFILES[platform];
    for (let day = Math.max(first, today - HISTORY_DAYS); day <= Math.min(last, today); day++) {
      if (noise(seed, day, "post") >= profile.postRate) continue;
      const [year, month, date] = new Date(day * DAY_MS).toISOString().slice(0, 10).split("-").map(Number);
      const postedAt2 = zonedTime(year, month - 1, date, 9 + Math.floor(noise(seed, day, "at") * 13), 0);
      if (postedAt2 < span.start || postedAt2 >= span.end) continue;
      const reach = 0.35 + 3.2 * noise(seed, day, "reach") ** 3 + burst(seed, day);
      const views = Math.round(profile.views * reach * trend(profile, day, today));
      list.push({
        id: `${seed}-${day}`,
        title: t(TITLES[Math.floor(noise(seed, day, "title") * TITLES.length)]),
        cover: COVERS[Math.floor(noise(seed, day, "cover") * COVERS.length)],
        platform,
        source: source.key,
        handle: source.handle,
        postedAt: postedAt2,
        views,
        likes: Math.round(views * profile.likeRate * (0.75 + 0.5 * noise(seed, day, "post-likes"))),
        comments: Math.round(views * profile.commentRate * (0.6 + 0.9 * noise(seed, day, "post-comments")))
      });
    }
  }
  return list;
}
function reportsNumbers(account) {
  const { platform } = account;
  if (platform === "linkedin") return !!account.linkedin?.organizationId;
  return (platform === "youtube" || platform === "tiktok" || platform === "instagram" || platform === "facebook" || platform === "threads") && !!account[platform];
}
function analyticsSources(accounts, { sample = false } = {}) {
  return ANALYTICS_PLATFORMS.flatMap(
    ({ id: platform }) => accounts.filter((account) => account.platform === platform && (sample || reportsNumbers(account))).map((account) => ({ key: `${platform}:${account.id}`, platform, account: account.id, handle: account.handle, ...sample ? { sample } : {} }))
  );
}
function analyticsReport(span, interval, sources, now = Date.now()) {
  const today = dayNumber(new Date(now));
  const clipped = { start: span.start, end: Math.max(span.start + 6e4, Math.min(span.end, now)) };
  const buckets = bucketsFor(clipped, interval);
  const length = clipped.end - clipped.start;
  const series = {};
  const previous = {};
  const whole2 = {};
  for (const source of sources) {
    series[source.key] = buckets.map((bucket) => round(spanTotals(source, bucket, today)));
    whole2[source.key] = round(spanTotals(source, clipped, today));
    previous[source.key] = round(spanTotals(source, { start: clipped.start - length, end: clipped.start }, today));
  }
  const last = buckets.at(-1);
  const live = !!last && span.end >= now - 6e4 && last.end < advance(startOf(last.start, interval), interval);
  const sample = sources.some((source) => !synced().has(source.key));
  return { sample, interval, buckets, live, series, totals: whole2, previous, posts: posts(sources, clipped, today) };
}
function totals(rows) {
  return sum(rows);
}
function engagement(row) {
  return row.views ? (row.likes + row.comments) / row.views : 0;
}
var compact = localized((locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), "en");
var whole = localized((locale) => new Intl.NumberFormat(locale), "en");

// apps/web/src/lib/posting-times.ts
var WEEKDAY_NAMES2 = [msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday"), msg("Sunday")];
var WEEKDAY_SHORT = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")];
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function slotStats(posts2) {
  if (!posts2.length) return { posts: 0, medianViews: 0, averageViews: 0, engagement: 0 };
  const sum2 = totals(posts2);
  return {
    posts: posts2.length,
    medianViews: Math.round(median(posts2.map((post) => post.views))),
    averageViews: Math.round(sum2.views / posts2.length),
    engagement: engagement(sum2)
  };
}
function postedAt(post) {
  const parts = zonedParts(post.postedAt);
  return { day: (parts.weekday + 6) % 7, hour: parts.hours };
}
function postingTimes(posts2) {
  const placed = posts2.map((post) => ({ post, ...postedAt(post) }));
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, ...slotStats(placed.filter((row) => row.day === day).map((row) => row.post)) }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, ...slotStats(placed.filter((row) => row.hour === hour).map((row) => row.post)) }));
  const byPair = /* @__PURE__ */ new Map();
  for (const row of placed) {
    const key = `${row.day}:${row.hour}`;
    byPair.set(key, [...byPair.get(key) ?? [], row.post]);
  }
  const slots = [...byPair.entries()].map(([key, list]) => {
    const [day, hour] = key.split(":").map(Number);
    return { day, hour, ...slotStats(list) };
  }).sort((a, b) => Number(b.posts > 1) - Number(a.posts > 1) || b.medianViews - a.medianViews || b.posts - a.posts);
  return { posts: posts2.length, weekdays, hours, slots };
}

// apps/web/src/lib/analytics-answer.ts
var WEEKDAYS2 = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var TOP_POSTS = 8;
var ENOUGH_POSTS = 10;
var pad2 = (value) => String(value).padStart(2, "0");
var platformName = (id) => PLATFORM_IDS2.includes(id) ? socialPlatform(id).name : id;
var shown = (slot) => ({
  posts: slot.posts,
  medianViews: slot.medianViews,
  averageViews: slot.averageViews,
  engagement: Math.round(slot.engagement * 1e4) / 1e4
});
var numbers = (row) => ({ views: row?.views ?? 0, likes: row?.likes ?? 0, comments: row?.comments ?? 0 });
function analyticsAccounts(args, accounts) {
  const picked = accounts.filter((account) => (!args.platform || account.platform === args.platform) && (!args.account || account.id === args.account));
  if (args.account && !picked.length) throw new DapiError("not-found", "No connected account has that id. Call social_accounts for the ids.");
  return picked;
}
function analyticsAnswer(args, accounts, stateOf, now = Date.now()) {
  const today = zonedParts(now);
  const days = args.days ?? 90;
  const span = { start: zonedTime(today.year, today.month, today.date - (days - 1)), end: now };
  const sources = analyticsSources(accounts);
  const report = analyticsReport(span, "month", sources, now);
  const posts2 = report.posts;
  const times = postingTimes(posts2);
  const stamp = (time) => {
    const parts = zonedParts(time);
    return `${dayKeyOf(time)} ${pad2(parts.hours)}:${pad2(parts.minutes)}, ${WEEKDAYS2[parts.weekday]}`;
  };
  let note;
  if (!sources.length) {
    note = "No connected account sends its numbers. plan.video reads TikTok, YouTube, Instagram, Facebook Pages, Threads and LinkedIn Pages: they can connect one in Connections.";
  } else if (posts2.length < ENOUGH_POSTS) {
    note = `Only ${posts2.length} ${posts2.length === 1 ? "post" : "posts"} went out in these days: too few to tell which days or hours do best. Look further back with days, or say so.`;
  }
  return {
    timeZone: timeZone(),
    from: dayKeyOf(span.start),
    to: dayKeyOf(now),
    accounts: sources.map((source) => ({
      platform: source.platform,
      accountId: source.account ?? "",
      handle: source.handle ?? "",
      state: stateOf(source.key) ?? "ready",
      totals: numbers(report.totals[source.key]),
      previous: numbers(report.previous[source.key]),
      posts: posts2.filter((post) => post.source === source.key).length
    })),
    noNumbers: accounts.filter((account) => !reportsNumbers(account)).map((account) => `${platformName(account.platform)} @${account.handle}`),
    // Monday first, as the calendar has it.
    byWeekday: times.weekdays.filter((slot) => slot.posts).map((slot) => ({ weekday: WEEKDAY_NAMES2[slot.day], ...shown(slot) })),
    byHour: times.hours.filter((slot) => slot.posts).map((slot) => ({ hour: `${pad2(slot.hour)}:00`, ...shown(slot) })),
    topPosts: [...posts2].sort((a, b) => b.views - a.views).slice(0, TOP_POSTS).map((post) => ({
      title: post.title,
      platform: post.platform,
      handle: post.handle ?? "",
      postedAt: stamp(post.postedAt),
      views: post.views,
      likes: post.likes,
      comments: post.comments
    })),
    ...note ? { note } : {}
  };
}

// apps/web/src/dapi/server/analytics.ts
var META = /* @__PURE__ */ new Set(["instagram", "facebook", "threads"]);
var FAILED = "Couldn't load its numbers. Try again later.";
var isoDay = (time) => new Date(time).toISOString().slice(0, 10);
var numbersAccount = (account) => ({
  id: account.id,
  handle: account.handle,
  platform: account.platform,
  ...account.ready ? { [account.platform]: account.platform === "linkedin" ? account.page ? { organizationId: "page" } : {} : {} } : {}
});
async function load(reads, scope, account, now) {
  const connectionId = account.id;
  if (!account.ready) return null;
  if (account.platform === "youtube") {
    return { youtube: await reads.network(scope, "youtube/analytics", { connectionId, startDate: isoDay(now - HISTORY_DAYS * DAY_MS), endDate: isoDay(now) }) };
  }
  if (account.platform === "tiktok") {
    if (!account.scope.split(/[,\s]+/).includes("video.list")) throw new Error("Disconnect TikTok in Connections and connect it again, so plan.video can read its numbers.");
    const found = await reads.network(scope, "tiktok/videos", { connectionId });
    return { posts: found.videos ?? [], perPost: false };
  }
  if (META.has(account.platform) || account.platform === "linkedin" && account.page) {
    const found = await reads.network(scope, `${account.platform}/analytics`, { connectionId });
    return { posts: (found.videos ?? []).filter((post) => post.postedAt > 0), followers: found.followers ?? null, perPost: true };
  }
  return null;
}
async function readAnalytics(reads, scope, args, now) {
  const accounts = analyticsAccounts(args, scope.connections.map(numbersAccount));
  const answers = /* @__PURE__ */ new Map();
  const states = /* @__PURE__ */ new Map();
  await Promise.all(
    accounts.map(async (account) => {
      const key = `${account.platform}:${account.id}`;
      try {
        const found = await load(reads, scope, scope.connections.find((item) => item.id === account.id), now);
        if (found) answers.set(key, found);
      } catch (error) {
        states.set(key, error instanceof Error && error.message ? error.message : FAILED);
      }
    })
  );
  return inTimeZone(scope.timeZone, () => {
    const numbers2 = /* @__PURE__ */ new Map();
    for (const [key, found] of answers) {
      numbers2.set(
        key,
        "youtube" in found ? youtubeNumbers(found.youtube) : { days: postingDayNumbers(found.posts), posts: found.posts, ...found.perPost ? { followers: found.followers ?? null } : {} }
      );
    }
    return withSyncedNumbers(numbers2, () => analyticsAnswer(args, accounts, (key) => states.get(key), now));
  });
}

// apps/web/src/dapi/server/posts.ts
var GOING_OUT_MS = 5 * 6e4;
var SCHEDULED_LIMIT = "On the Free plan, each account can have 10 scheduled posts waiting at a time. Upgrade for unlimited posts.";
var CONFLICT = "The post changed in plan.video while this was saved, so nothing was changed. Read it again with list_posts and try again.";
var SEND_WAIT_MS = 12e4;
var SEND_LOOK_MS = 3e3;
function createPostingTools(store, given = {}) {
  const options = {
    now: given.now ?? Date.now,
    sleep: given.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    site: (given.site ?? "https://plan.video").replace(/\/$/, "")
  };
  return {
    handles: (name) => Object.hasOwn(HANDLERS, name) || name === "social_schema",
    async run(name, input) {
      if (!Object.hasOwn(HANDLERS, name) && name !== "social_schema") return { text: `There is no tool named ${name}.`, error: true };
      const schema = name === listMedia.name ? listMedia.input : name === analytics.name ? analytics.input : toolByName(name).input;
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) {
        const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
        return { text: `The arguments don't fit ${name}: ${problems}`, error: true };
      }
      try {
        if (name === "social_schema") return { text: JSON.stringify(socialSchemaView(parsed.data.platform)), error: false };
        const session = { scope: await store.context(), store, now: options.now(), options };
        const output = await HANDLERS[name](session, parsed.data);
        return { text: JSON.stringify(output), error: false };
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError) {
          console.error(`[mcp] ${name} failed`, error);
          return { text: "plan.video couldn't do that. Try again in a minute.", error: true };
        }
        const message = error.message || String(error);
        return { text: isDapiError(error) ? `${error.code}: ${message}` : message, error: true };
      }
    }
  };
}
var HANDLERS = {
  social_accounts: socialAccounts2,
  list_media: listMedia2,
  list_posts: listPosts2,
  schedule_post: schedulePost2,
  copy_post: copyPost2,
  update_post: updatePost2,
  delete_post: deletePost2,
  publish_post: publishPost2,
  ask_for_approval: askForApproval2,
  tiktok_creator: tiktokCreator2,
  analytics: (session, args) => readAnalytics(session.store, session.scope, args, session.now)
};
var connected = (scope) => scope.connections.filter((account) => isPlatform(account.platform));
function accountsFor(scope, platform, choices) {
  const list = scope.connections.filter((account) => account.platform === platform);
  const chosen = readChoices(choices)[platform] ?? [];
  if (chosen.length) return list.filter((account) => chosen.includes(account.id));
  return list.length === 1 ? list : [];
}
var scheduledLimit2 = (scope) => scope.role === "owner" && scope.level <= 1 ? FREE_SCHEDULED_PER_ACCOUNT : void 0;
function waitingFrom(session, post) {
  if (post.status !== "scheduled" || post.paused) return [];
  const zone = post.timeZone || session.scope.timeZone;
  const over = post.recurrence ? isDateKey(post.recurrenceEnd) && post.recurrenceEnd < dayKeyAt(session.now, zone) : (momentOf(post.day, post.allDay ? "00:00" : post.start, zone)?.getTime() ?? 0) < session.now + GOING_OUT_MS;
  if (over) return [];
  return [...new Set(post.platforms.flatMap((platform) => accountsFor(session.scope, platform, post.accounts).map((account) => account.id)))];
}
async function waitingByAccount(session, except) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of await session.store.posts(session.scope, { status: "scheduled" })) {
    if (row.id === except) continue;
    for (const id of waitingFrom(session, row.data)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
async function refuseOverLimit(session, next, before) {
  const limit = scheduledLimit2(session.scope);
  if (limit === void 0) return;
  const had = before ? waitingFrom(session, before) : [];
  const added = waitingFrom(session, next).filter((id) => !had.includes(id));
  if (!added.length) return;
  const waiting = await waitingByAccount(session, next.id);
  if (added.some((id) => (waiting.get(id) ?? 0) >= limit)) throw new DapiError("invalid-input", SCHEDULED_LIMIT);
}
function deliveriesOf(row) {
  const out = {};
  for (const [platform, delivery] of Object.entries(row.deliveries ?? {})) {
    if (!delivery) continue;
    const state = delivery.state === "sent" || delivery.state === "failed" ? delivery.state : "sending";
    out[platform] = { state, ...delivery.error ? { error: delivery.error } : {}, attempts: 0, at: "" };
  }
  return out;
}
var viewOf = (session, row, warnings = []) => postViewOf({ ...row.data, deliveries: deliveriesOf(row) }, { connections: session.scope.connections, timeZone: session.scope.timeZone }, warnings);
async function postById(session, id) {
  const [row] = await session.store.posts(session.scope, { id });
  if (!row) throw new DapiError("not-found", "This post no longer exists.");
  return row;
}
function fromLibrary(scope, media) {
  const items = (typeof media === "string" ? [media] : media).map((reference) => {
    const trimmed = reference.trim();
    if (!trimmed.startsWith("media:")) throw new DapiError("invalid-input", "Pass a media id from list_media, such as media:2f9c1e. Paths and URLs aren't attached.");
    const item = scope.library.find((row) => row.id === trimmed.slice("media:".length));
    if (!item) throw new DapiError("not-found", "That file is no longer in the media library. Ask the user to add it in the dashboard's Media tab.");
    return item;
  });
  const first = items[0];
  const names = items.map(({ name, type, lastModified }) => ({ name, type, lastModified }));
  const from = items.map((item) => `media/${item.id}`);
  if (first.kind === "video") {
    if (items.length > 1) throw new DapiError("invalid-input", "A post takes one video, or up to 35 pictures. Attach the video on its own.");
    return { from, names, kind: "video", media: { kind: "video", duration: first.duration, width: first.width, height: first.height } };
  }
  if (items.some((item) => item.kind === "video")) throw new DapiError("invalid-input", "A post takes one video, or up to 35 pictures, not both.");
  const mixedShapes = first.width > 0 && items.some((item) => !isAspect(item.width, item.height, first.width / first.height));
  return { from, names, kind: "image", media: { kind: "images", count: items.length, width: first.width, height: first.height, mixedShapes } };
}
function onPost(post, ids) {
  if (!ids.length) return null;
  const details = ids.map((id) => post.media?.find((item) => item.id === id) ?? { id, name: "", type: "", lastModified: 0 });
  const names = details.map(({ name, type, lastModified }) => ({ name, type, lastModified }));
  const from = ids.map((id) => `posts/${id}`);
  if (details.some((item) => item.type.startsWith("video/"))) return { from, names, kind: "video", media: { kind: "video", duration: 0, width: 0, height: 0 } };
  return { from, names, kind: "image", media: { kind: "images", count: ids.length, width: 0, height: 0, mixedShapes: false } };
}
function savedMedia(post) {
  const own = {};
  for (const platform of Object.keys(post.ownFiles ?? {})) {
    const attached = onPost(post, post.ownFiles?.[platform] ?? []);
    if (attached) own[platform] = attached;
  }
  const shared = post.files ? onPost(post, post.files) : post.media?.some((item) => item.id === post.id) ? onPost(post, [post.id]) : null;
  return { shared, own };
}
var mediaOn = (shared, own) => (platform) => (own[platform] ?? shared)?.media ?? null;
var kindOf = (shared, own) => {
  const all = [shared, ...Object.values(own)].filter((item) => !!item);
  return all.some((item) => item.kind === "video") ? "video" : all.length ? "image" : "text";
};
var knownShape = (media) => media && media.width > 0 ? media : null;
async function copyOnto(session, postId, shared, own) {
  const ids = /* @__PURE__ */ new Map();
  const details = [];
  const at = new Date(session.now).toISOString();
  const idOf = (from, names) => {
    let id = ids.get(from);
    if (!id) {
      id = `${postId}_${newId().replace(/-/g, "").slice(0, 12)}`;
      ids.set(from, id);
      details.push({ id, name: names.name || "file", type: names.type, lastModified: names.lastModified, cloud: { key: `posts/${session.scope.owner}/${id}`, at } });
    }
    return id;
  };
  const listOf = (attached) => attached.from.map((from, index) => idOf(from, attached.names[index]));
  const files = shared ? listOf(shared) : [];
  const ownFiles = Object.fromEntries(Object.entries(own).flatMap(([platform, attached]) => attached ? [[platform, listOf(attached)]] : []));
  if (ids.size) await session.store.copyFiles(session.scope, [...ids].map(([from, to]) => ({ from, to })));
  return { files, ownFiles, media: details };
}
function withOwnCaptions(post, own) {
  const shared = (post.description ?? "").trim();
  const isOwn = (words) => !!words?.trim() && words.trim() !== shared;
  const captions = {};
  for (const platform of post.platforms) {
    const words = own[platform];
    if (platform !== "youtube" && isOwn(words)) captions[platform] = words;
  }
  const next = { ...post, captions };
  if (!Object.keys(captions).length) delete next.captions;
  if (next.youtube) next.youtube = { ...next.youtube, description: post.platforms.includes("youtube") && isOwn(own.youtube) ? own.youtube : "" };
  return next;
}
function ownCaptions(post) {
  const shared = (post.description ?? "").trim();
  const own = {};
  for (const platform of post.platforms) {
    const words = platform === "youtube" ? post.youtube?.description : post.captions?.[platform];
    if (words?.trim() && words.trim() !== shared) own[platform] = words;
  }
  return own;
}
async function written(session, post, base) {
  const saved = await session.store.save(session.scope, post, base);
  if ("conflict" in saved) throw new DapiError("busy", CONFLICT);
  return { id: post.id, version: saved.version, data: post, deliveries: {} };
}
async function creatorOf(session, account) {
  try {
    const answer = await session.store.network(session.scope, "tiktok/creator", { connectionId: account.id });
    const creator = readTikTokCreator(answer.data ?? {});
    if (!creator) throw new Error("TikTok didn't say who can watch this post. Try again in a minute.");
    return creator;
  } catch (cause) {
    throw new DapiError("unsupported", `TikTok (${account.handle}): ${cause.message}`, { cause });
  }
}
async function tiktokYes(session, choices, tiktok, media, agreed, field) {
  if (agreed !== true) {
    throw new DapiError(
      "invalid-input",
      `Posting to the TikTok profile needs the user's yes to TikTok's terms. Show them this, word for word: "${tiktokConsent(tiktok.brandedContent)}" Then pass ${field} true once they accept.`
    );
  }
  let settings = tiktok;
  const warnings = [];
  for (const account of accountsFor(session.scope, "tiktok", choices)) {
    if (!account.ready) continue;
    const checked = checkTikTokCreator(settings, await creatorOf(session, account), media?.kind === "video" ? media.duration : null);
    if (checked.errors.length) throw new DapiError("invalid-input", checked.errors.join(" "));
    settings = checked.choices;
    warnings.push(...checked.warnings);
  }
  return { tiktok: settings, warnings };
}
var withRules = (session, saved, next) => approvalRules(saved, next, { approver: session.scope.role !== "member", membersNeedApproval: session.scope.membersNeedApproval }, new Date(session.now).toISOString());
async function saveNew(session, args, shared, own, youtubeBefore) {
  const { scope } = session;
  const platforms = sortPlatforms(args.platforms);
  refuseSoon(platforms);
  const choices = pickAccounts(connected(scope), platforms, args.accounts);
  const zone = scope.timeZone;
  const day = args.day ?? dayKeyAt(session.now, zone);
  if (!isDateKey(day)) throw new DapiError("invalid-input", "Day is YYYY-MM-DD.");
  const scheduling = args.draft !== true;
  if (scheduling && (args.day === void 0 || args.time === void 0)) {
    throw new DapiError("invalid-input", "Pass a day and a time to schedule, or draft true to save it without a send time.");
  }
  const time = args.time ? clock(args.time) : null;
  const when = momentOf(day, time ?? "00:00", zone);
  if (!when) throw new DapiError("invalid-input", "Pick a date and a time.");
  if (scheduling) {
    const problem = inEnglish(() => scheduleProblem(when, zone, session.now));
    if (problem) throw new DapiError("invalid-input", problem);
  }
  const caption = args.caption;
  const title = postTitle(args.youtube?.title || caption, shared?.names[0]?.name.replace(/\.[^.]+$/, "") || "Untitled post");
  const media = mediaOn(shared, own);
  const youtube = youtubeOf(args.youtube, youtubeBefore, platforms, caption, knownShape(media("youtube")));
  let tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok) : void 0;
  requireTikTok(platforms, tiktok, scheduling);
  const warnings = assertFits({ kind: kindOf(shared, own), platforms, caption, title: youtube?.title || title, media });
  if (scheduling && toProfile(platforms, tiktok)) {
    const checked = await tiktokYes(session, choices, tiktok, media("tiktok"), args.tiktok?.agreed, "tiktok.agreed");
    tiktok = checked.tiktok;
    warnings.push(...checked.warnings);
  }
  const { repeat, repeatEnd } = repeatOf(args.repeat, day);
  const thread = threadOf(args.thread, platforms);
  const id = newId();
  const recurrence = repeat || null;
  const post = withRules(session, void 0, withOwnCaptions(
    {
      allDay: !scheduling && !time,
      calendarId: scope.calendarId,
      createdAt: new Date(session.now).toISOString(),
      day,
      description: caption.trim() || null,
      duration: !scheduling && !time ? 24 * 60 : 15,
      id,
      link: args.link?.trim() || null,
      platforms,
      accounts: choices,
      projectId: null,
      coverTime: null,
      ...tiktok ? { tiktok } : {},
      ...youtube ? { youtube } : {},
      ...thread?.length ? { thread } : {},
      recurrence,
      recurrenceExceptions: [],
      recurrenceEnd: recurrence ? resolveRepeatEnd(repeatEnd || void 0, recurrence, day) : null,
      sendFrom: new Date(session.now).toISOString(),
      start: time ?? "00:00",
      status: scheduling ? "scheduled" : "draft",
      timeZone: zone,
      title: title || "Untitled post"
    },
    { youtube: youtube?.description }
  ));
  await refuseOverLimit(session, post);
  if (shared || Object.keys(own).length) Object.assign(post, await copyOnto(session, id, shared, own));
  const row = await written(session, post, null);
  return viewOf(session, row, [...warnings, ...heldWarning(post, scheduling)]);
}
async function socialAccounts2(session) {
  const { scope } = session;
  const limit = scheduledLimit2(scope);
  const waiting = limit === void 0 ? /* @__PURE__ */ new Map() : await waitingByAccount(session);
  return {
    timeZone: scope.timeZone,
    accounts: connected(scope).map((account) => {
      const publishes = PUBLISHES.has(account.platform);
      const scheduledRoom = limit === void 0 ? null : Math.max(0, limit - (waiting.get(account.id) ?? 0));
      return { id: account.id, platform: account.platform, handle: account.handle, publishes, ready: publishes && account.ready, scheduledRoom };
    })
  };
}
async function listMedia2(session, args) {
  const words = (args.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matched = session.scope.library.filter((item) => (!args.kind || item.kind === args.kind) && words.every((word) => item.name.toLowerCase().includes(word))).sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
  return {
    total: matched.length,
    media: matched.slice(0, args.limit ?? 30).map((item) => ({
      id: `media:${item.id}`,
      name: item.name,
      kind: item.kind,
      seconds: Math.round(item.duration * 10) / 10,
      width: item.width,
      height: item.height,
      bytes: item.size,
      added: item.createdAt,
      uses: item.uses
    }))
  };
}
async function listPosts2(session, args) {
  const { scope } = session;
  if (args.id) return { timeZone: scope.timeZone, total: 1, posts: [viewOf(session, await postById(session, args.id))] };
  if (args.from && !isDateKey(args.from)) throw new DapiError("invalid-input", "from is YYYY-MM-DD.");
  if (args.to && !isDateKey(args.to)) throw new DapiError("invalid-input", "to is YYYY-MM-DD.");
  const rows = await session.store.posts(scope, { status: args.status, from: args.from, to: args.to });
  const matched = rows.filter((row) => !args.platform || row.data.platforms.includes(args.platform));
  const sorted = matched.sort((a, b) => a.data.day.localeCompare(b.data.day) || a.data.start.localeCompare(b.data.start));
  return { timeZone: scope.timeZone, total: sorted.length, posts: sorted.slice(0, args.limit ?? 50).map((row) => viewOf(session, row)) };
}
async function schedulePost2(session, args) {
  const { media, ...rest } = args;
  return saveNew(session, rest, media ? fromLibrary(session.scope, media) : null, {});
}
async function copyPost2(session, args) {
  const original = (await postById(session, args.id)).data;
  const platforms = sortPlatforms(args.platforms ?? original.platforms.filter(isPlatform));
  if (platforms.length === 0) throw new DapiError("invalid-input", "The original has no platform. Pass platforms for the copy.");
  const kept = Object.entries(readChoices(original.accounts)).flatMap(
    ([platform, ids]) => platforms.includes(platform) ? keptAccountIds(connected(session.scope), platform, ids ?? []) : []
  );
  const { shared, own } = savedMedia(original);
  const youtube = original.youtube;
  const tiktok = original.tiktok;
  const promotion = tiktok ? tiktok.yourBrand && tiktok.brandedContent ? "both" : tiktok.yourBrand ? "your_brand" : tiktok.brandedContent ? "branded_content" : "none" : void 0;
  return saveNew(
    session,
    {
      caption: args.caption ?? original.description ?? "",
      platforms,
      accounts: args.accounts ?? (kept.length > 0 ? kept : void 0),
      day: args.day,
      time: args.time,
      draft: args.draft,
      link: original.link || void 0,
      thread: args.thread ?? (original.thread ?? []).map((reply) => ({ text: reply.text, delayMinutes: reply.delay })),
      youtube: youtube ? { title: youtube.title, privacy: youtube.privacy, madeForKids: youtube.madeForKids, tags: youtube.tags } : void 0,
      tiktok: tiktok || args.tiktok ? {
        ...tiktok ? { privacy: tiktok.privacy, comments: tiktok.comments, duet: tiktok.duet, stitch: tiktok.stitch, promotion, inbox: tiktok.inbox } : {},
        ...definedOnly(args.tiktok)
      } : void 0
    },
    shared,
    own,
    youtube
  );
}
async function updatePost2(session, args) {
  const { scope } = session;
  const row = await postById(session, args.id);
  const existing = row.data;
  if (existing.status === "posted") throw new DapiError("invalid-input", "Posted posts stay as they went out. Post again to make a copy you can change.");
  const platforms = args.platforms ? sortPlatforms(args.platforms) : sortPlatforms(existing.platforms.filter(isPlatform));
  if (platforms.length === 0) throw new DapiError("invalid-input", "Pick at least one platform.");
  refuseSoon(platforms, existing.platforms);
  const choices = mergeAccountChoices(connected(scope), platforms, args.accounts, existing.accounts);
  const attached = args.media ? { shared: fromLibrary(scope, args.media), own: {} } : savedMedia(existing);
  const caption = args.caption ?? existing.description ?? "";
  const own = caption.trim() === (existing.description ?? "").trim() ? ownCaptions(existing) : {};
  const zone = existing.timeZone || scope.timeZone;
  const day = args.day ?? existing.day;
  if (!isDateKey(day)) throw new DapiError("invalid-input", "Day is YYYY-MM-DD.");
  const time = args.time ? clock(args.time) : existing.allDay ? null : existing.start;
  let status = existing.status;
  if (args.draft === false && awaitingApproval(existing)) throw new DapiError("invalid-input", AWAITING_APPROVAL);
  if (args.draft === true) status = "draft";
  else if (args.draft === false) status = "scheduled";
  else if (args.day !== void 0 && args.time !== void 0 && existing.status === "draft" && !awaitingApproval(existing)) status = "scheduled";
  const at = time ? momentOf(day, time, zone) : null;
  if (status === "scheduled") {
    if (!time) throw new DapiError("invalid-input", "A scheduled post needs a time. Pass one, or draft true.");
    const problem = inEnglish(() => scheduleProblem(at, zone, session.now));
    if (problem) throw new DapiError("invalid-input", problem);
  }
  const madeTitles = /* @__PURE__ */ new Set([postTitle(existing.description ?? "", ""), postTitle(existing.description ?? "", "Untitled post")]);
  const oldYouTubeTitle = existing.youtube?.title?.trim() ?? "";
  const ownTitle = platforms.includes("youtube") && oldYouTubeTitle && !madeTitles.has(oldYouTubeTitle) ? oldYouTubeTitle : "";
  const fileTitle = attached.shared?.names[0]?.name.replace(/\.[^.]+$/, "");
  const title = args.youtube?.title?.trim() || (args.caption !== void 0 ? ownTitle || postTitle(caption, fileTitle || existing.title) : existing.title);
  const media = mediaOn(attached.shared, attached.own);
  const youtube = youtubeOf(args.youtube, existing.youtube, platforms, caption, knownShape(media("youtube")), args.caption !== void 0 ? title : existing.youtube?.title);
  let tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok, existing.tiktok) : void 0;
  requireTikTok(platforms, tiktok, status === "scheduled");
  const warnings = [
    ...assertFits({ kind: kindOf(attached.shared, attached.own), platforms, caption, own, title: youtube?.title || title, media }),
    ...removedAccountNotes(connected(scope), platforms, choices)
  ];
  const agreedBefore = existing.status === "scheduled" && toProfile(existing.platforms, existing.tiktok);
  const tiktokChanged = args.tiktok?.privacy !== void 0 || args.tiktok?.promotion !== void 0 || args.tiktok?.inbox !== void 0 || args.accounts !== void 0;
  if (status === "scheduled" && toProfile(platforms, tiktok) && (!agreedBefore || tiktokChanged)) {
    const checked = await tiktokYes(session, choices, tiktok, media("tiktok"), args.tiktok?.agreed, "tiktok.agreed");
    tiktok = checked.tiktok;
    warnings.push(...checked.warnings);
  }
  const retimed = day !== existing.day || (time ?? "00:00") !== existing.start || !time !== existing.allDay || status !== existing.status;
  const built = args.repeat ? repeatOf(args.repeat, day) : null;
  const recurrence = args.repeat === null ? null : built ? built.repeat || null : existing.recurrence;
  const recurrenceEnd = args.repeat === null ? null : built ? recurrence ? resolveRepeatEnd(built.repeatEnd || void 0, recurrence, day) : null : existing.recurrenceEnd ?? null;
  if (recurrenceEnd && recurrenceEnd < day) throw new DapiError("invalid-input", "Pick an end on or after the first post.");
  const thread = threadOf(args.thread, platforms);
  const next = {
    ...existing,
    allDay: !time,
    day,
    start: time ?? "00:00",
    title: title.trim() || existing.title,
    description: caption.trim() || null,
    duration: !time ? 24 * 60 : existing.allDay ? 15 : existing.duration,
    link: args.link !== void 0 ? args.link.trim() || null : existing.link,
    platforms,
    accounts: choices,
    recurrence,
    recurrenceEnd,
    recurrenceExceptions: day !== existing.day || recurrence !== existing.recurrence ? [] : existing.recurrenceExceptions,
    status
  };
  if (tiktok) next.tiktok = tiktok;
  else delete next.tiktok;
  if (youtube) next.youtube = youtube;
  else delete next.youtube;
  const replies = thread === void 0 ? existing.thread : thread;
  if (replies?.length) next.thread = replies;
  else delete next.thread;
  const changedTiming = retimed || recurrence !== existing.recurrence || recurrenceEnd !== (existing.recurrenceEnd ?? null);
  if (changedTiming) next.sendFrom = new Date(session.now).toISOString();
  const revised = withRules(session, existing, withOwnCaptions(next, own));
  await refuseOverLimit(session, revised, existing);
  if (args.media && attached.shared) {
    const copied = await copyOnto(session, existing.id, attached.shared, {});
    revised.files = copied.files;
    delete revised.ownFiles;
    const replyFiles = new Set((revised.thread ?? []).flatMap((reply) => reply.files ?? []));
    revised.media = [...(existing.media ?? []).filter((item) => replyFiles.has(item.id)), ...copied.media];
  }
  const saved = await written(session, revised, row.version);
  return viewOf(session, saved, [...warnings, ...heldWarning(revised, status === "scheduled")]);
}
async function deletePost2(session, { id }) {
  const row = await postById(session, id);
  if (row.data.status === "posted") throw new DapiError("invalid-input", "Posted posts stay as they went out. Post again to make a copy you can change.");
  const removed = await session.store.remove(session.scope, id, row.version);
  if ("conflict" in removed) throw new DapiError("busy", CONFLICT);
  return { id, deleted: true };
}
async function tiktokCreator2(session, { account: requested }) {
  const choices = pickAccounts(connected(session.scope), ["tiktok"], requested ? [requested] : void 0);
  const account = accountsFor(session.scope, "tiktok", choices)[0];
  if (!account) throw new DapiError("invalid-input", "Connect TikTok in Connections first.");
  if (!account.ready) throw new DapiError("invalid-input", `Connect ${account.handle} in Connections again: plan.video has its name but no TikTok login.`);
  return tiktokCreatorView(account.id, await creatorOf(session, account));
}
function filesFor(post, platform) {
  const ids = post.ownFiles?.[platform] ?? post.files;
  if (ids) return [...ids];
  return post.media?.some((item) => item.id === post.id) ? [post.id] : [];
}
var isVideo = (file) => !!file && (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name));
var platformName2 = (id) => isPlatform(id) ? socialPlatform(id).name : id;
function deliveryErrors(row) {
  const lines = Object.entries(row.deliveries ?? {}).flatMap(
    ([id, delivery]) => !delivery || delivery.state === "sent" ? [] : [`${platformName2(id)}: ${delivery.error ?? "was not published."}`]
  );
  return lines.join(" ") || "The post was not published.";
}
async function publishPost2(session, { id, agreed }) {
  const { scope } = session;
  const row = await postById(session, id);
  let post = row.data;
  if (post.status === "posted") throw new DapiError("invalid-input", "This post already went out.");
  if (awaitingApproval(post)) throw new DapiError("invalid-input", AWAITING_APPROVAL);
  const foreign = post.platforms.filter((platform) => !PUBLISHES.has(platform));
  if (foreign.length > 0) {
    const names = foreign.map(platformName2);
    throw new DapiError(
      "unsupported",
      `plan.video sends ${inEnglish(() => listNames(PUBLISHING_PLATFORMS))} only. ${names.join(", ")} ${names.length === 1 ? "is" : "are"} not sent. Take ${names.length === 1 ? "it" : "them"} off the post, or leave this post on the calendar.`
    );
  }
  if (post.platforms.length === 0) throw new DapiError("invalid-input", "This post has no platform to send to.");
  for (const platform of post.platforms) {
    const name = platformName2(platform);
    const chosen = accountsFor(scope, platform, post.accounts);
    if (chosen.length > 1) throw new DapiError("invalid-input", `Publishing sends one ${name} account. This post has ${chosen.length}. Leave one on it.`);
    if (chosen.some((account) => account.ready)) continue;
    const unnamed = (readChoices(post.accounts)[platform] ?? []).length === 0;
    const others = connected(scope).filter((account) => account.platform === platform).length;
    if (unnamed && others > 1) throw new DapiError("invalid-input", `${name} has more than one account. Update the post with the account id to publish.`);
    if (!unnamed && chosen.length === 0 && others > 0) throw new DapiError("invalid-input", `The ${name} account this post named was removed. Update the post with a ${name} account id, then publish.`);
    throw new DapiError("invalid-input", `Connect ${name} in Connections. A name alone can't publish.`);
  }
  if (post.platforms.includes("tiktok") && !post.tiktok?.inbox && !post.tiktok?.privacy) {
    throw new DapiError("invalid-input", "TikTok needs who can watch before it can be published. Update the post with tiktok.privacy, or tiktok.inbox true.");
  }
  if (post.platforms.includes("youtube") && !(post.youtube?.title || post.title).trim()) throw new DapiError("invalid-input", "Add a YouTube title, then publish.");
  for (const platform of post.platforms.filter((item) => NEEDS_FILE.has(item))) {
    const files2 = filesFor(post, platform);
    if (!files2.length) throw new DapiError("invalid-input", platform === "youtube" ? "Attach a video before publishing." : "Attach a video or pictures before publishing.");
    if (platform === "youtube" && !files2.some((file) => isVideo(post.media?.find((item) => item.id === file)))) {
      throw new DapiError("wrong-kind", "YouTube needs a video. This post has pictures.");
    }
  }
  const files = /* @__PURE__ */ new Set([...post.platforms.flatMap((platform) => filesFor(post, platform)), ...(post.thread ?? []).flatMap((reply) => reply.files ?? [])]);
  if ([...files].some((file) => !post.media?.find((item) => item.id === file)?.cloud)) {
    throw new DapiError("invalid-input", "Its files haven't reached plan.video's storage yet. Ask the user to open plan.video where the post was made, so they finish uploading, then try again.");
  }
  const warnings = [];
  let base = row.version;
  const save = async (next) => {
    const saved = await session.store.save(scope, next, base);
    if ("conflict" in saved) throw new DapiError("busy", CONFLICT);
    base = saved.version;
    post = next;
  };
  if (toProfile(post.platforms, post.tiktok)) {
    const attached = savedMedia(post);
    const checked = await tiktokYes(session, post.accounts, post.tiktok, mediaOn(attached.shared, attached.own)("tiktok"), agreed, "agreed");
    warnings.push(...checked.warnings);
    if (checked.warnings.length) await save({ ...post, tiktok: checked.tiktok });
  }
  const before = { day: post.day, start: post.start, allDay: post.allDay };
  const zone = post.timeZone || scope.timeZone;
  const at = momentOf(post.day, post.allDay ? "00:00" : post.start, zone);
  const failedBefore = Object.values(row.deliveries ?? {}).some((delivery) => delivery?.state === "failed");
  const shift = !post.recurrence && !failedBefore && !!at && at.getTime() > session.now;
  if (shift) await save({ ...post, day: dayKeyAt(session.now, zone), start: clockAt(session.now, zone), allDay: false });
  let handed;
  try {
    handed = await session.store.send(scope, id);
  } catch (error) {
    throw await afterRefusedSend(session, id, shift ? before : null, error);
  }
  const targets = handed.filter((delivery) => PUBLISHES.has(delivery.platform) && delivery.state !== "sent");
  const missing = targets.filter((delivery) => delivery.connection_id === "none");
  let latest = await postById(session, id);
  const settled = (current2) => targets.every((delivery) => ["sent", "failed"].includes(current2.deliveries[delivery.platform]?.state ?? "") || delivery.connection_id === "none");
  for (let waited = 0; !settled(latest) && waited < SEND_WAIT_MS; waited += SEND_LOOK_MS) {
    await session.options.sleep(SEND_LOOK_MS);
    latest = await postById(session, id);
  }
  const failed = missing.length > 0 || targets.some((delivery) => latest.deliveries[delivery.platform]?.state === "failed");
  if (!failed && !settled(latest)) return viewOf(session, latest, [...warnings, "It's still going out. Check with list_posts in a minute: don't publish it again."]);
  if (!failed) return viewOf(session, latest, warnings);
  if (shift && latest.data.status !== "posted") {
    const back = await session.store.save(scope, { ...latest.data, ...before }, latest.version);
    if ("conflict" in back) warnings.push("Its time couldn't be put back, so it shows at the time it was tried.");
  }
  const reasons = [...missing.map((delivery) => `${platformName2(delivery.platform)}: ${delivery.error ?? "no login to send with."}`), deliveryErrors(latest)];
  throw new DapiError("unsupported", [...new Set(reasons)].join(" "));
}
async function afterRefusedSend(session, id, before, error) {
  const latest = await postById(session, id).catch(() => null);
  if (!latest) return error;
  if (Object.keys(latest.deliveries).length) {
    return new DapiError("busy", `${error.message} It may be going out anyway: check with list_posts in a minute, and don't publish it again.`);
  }
  const zone = latest.data.timeZone || session.scope.timeZone;
  const back = before ? { ...latest.data, ...before } : latest.data;
  const at = momentOf(back.day, back.allDay ? "00:00" : back.start, zone);
  const due = back.status === "scheduled" && !back.recurrence && (!at || at.getTime() <= session.now);
  if (before || due) {
    const saved = await session.store.save(session.scope, due ? { ...back, status: "draft" } : back, latest.version);
    if ("conflict" in saved) return new DapiError("busy", `${error.message} The post changed meanwhile: check it with list_posts.`);
  }
  return due ? new DapiError("unsupported", `${error.message} It's saved as a draft, so it won't go out by itself.`) : error;
}
function snapshotOf(session, post) {
  const files = (post.files ?? (post.media?.some((item) => item.id === post.id) ? [post.id] : [])).map((id) => post.media?.find((item) => item.id === id)).filter((file) => !!file?.cloud);
  const captions = ownCaptions(post);
  return {
    title: post.title,
    caption: post.description ?? "",
    ...Object.keys(captions).length ? { captions } : {},
    platforms: post.platforms.map((id) => {
      const accounts = accountsFor(session.scope, id, post.accounts);
      return { id, name: platformName2(id), handles: accounts.map((account) => account.handle), avatars: accounts.map(() => "") };
    }),
    day: post.day,
    start: post.start,
    allDay: post.allDay,
    timeZone: post.timeZone ?? null,
    status: post.status === "scheduled" ? "draft" : post.status,
    media: files[0] ? isVideo(files[0]) ? "video" : "image" : null,
    ...files.length && (files.length > 1 || files[0].id !== post.id) ? { files: files.map((file) => file.id) } : {},
    ...post.story ? { story: true } : {},
    youtubeTitle: post.youtube?.title || null,
    ...post.platforms.includes("pinterest") && post.pinterest?.title ? { pinterestTitle: post.pinterest.title } : {},
    ...!post.story && post.thread?.some((reply) => reply.text.trim()) ? { thread: post.thread.flatMap((reply) => reply.text.trim() ? [reply.text] : []) } : {},
    link: post.link,
    workspaceId: session.scope.workspace
  };
}
async function askForApproval2(session, { id }) {
  const row = await postById(session, id);
  if (row.data.status === "posted") throw new DapiError("invalid-input", "This post has already gone out.");
  const asked = await session.store.askApproval(session.scope, id, row.version, snapshotOf(session, row.data));
  if ("conflict" in asked) throw new DapiError("busy", CONFLICT);
  return { ...viewOf(session, await postById(session, id)), approvalLink: `${session.options.site}/p/${asked.preview}` };
}
export {
  createPostingTools
};
