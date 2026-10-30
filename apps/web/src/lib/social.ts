/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Ids are the calendar's, so a scheduled post shows its platforms there.

import { intlLocale, localized, msg, t } from "./i18n";

export type PlatformId =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "x"
  | "facebook"
  | "linkedin"
  | "threads"
  | "bluesky"
  | "pinterest";

export type PostKind = "text" | "image" | "video" | "story";

export const POST_KINDS: readonly { id: PostKind; name: string; plural: string }[] = [
  { id: "text", name: msg("Text"), plural: "text posts" },
  { id: "image", name: msg("Image"), plural: "image posts" },
  { id: "video", name: msg("Video"), plural: "video posts" },
  { id: "story", name: msg("Story"), plural: "stories" },
];

/** Stories take one picture or one video, and no caption or cover. */
export const STORY_MAX_SECONDS = 60;

export type SocialPlatform = {
  id: PlatformId;
  name: string;
  background: string;
  /** 24×24 path, from Simple Icons (CC0). */
  logo: string;
  captionLimit: number;
  /** `cutOff`: where search results cut it short. */
  title?: { limit: number; required: boolean; cutOff?: number };
  maxVideoSeconds: number;
  /** 0: video only. */
  maxImages: number;
  /** Pictures past this many are taken but never published. */
  publishedImages?: number;
  /** Width over height a picture can have before it is cropped to fit. */
  imageAspect?: { min: number; max: number };
  /** The others choose their own. */
  customCover?: boolean;
  kinds: readonly PostKind[];
  /** Plays full screen, 9:16. */
  vertical: boolean;
  maxHashtags?: number;
};

/** The rest can be planned for, and go out once they're added. */
export const PUBLISHING_PLATFORMS: readonly string[] = ["tiktok", "youtube", "bluesky", "linkedin", "x", "instagram", "facebook", "threads"];

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  {
    id: "tiktok",
    name: "TikTok",
    background: "#000000",
    logo: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
    captionLimit: 4000,
    maxVideoSeconds: 10 * 60,
    maxImages: 35,
    customCover: true,
    kinds: ["image", "video"],
    vertical: true,
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
    maxHashtags: 30,
  },
  {
    id: "youtube",
    name: "YouTube",
    background: "#FF0000",
    logo: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    captionLimit: 5000,
    title: { limit: 100, required: true, cutOff: 60 },
    maxVideoSeconds: 12 * 60 * 60,
    maxImages: 0,
    kinds: ["video"],
    vertical: false,
    maxHashtags: 60,
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
    vertical: false,
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
    vertical: false,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    background: "#0A66C2",
    logo: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
    captionLimit: 3000,
    maxVideoSeconds: 15 * 60,
    maxImages: 20,
    kinds: ["text", "image", "video"],
    vertical: false,
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
    vertical: false,
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
    vertical: false,
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
    vertical: false,
  },
];

export const PLATFORM_IDS: readonly PlatformId[] = SOCIAL_PLATFORMS.map((platform) => platform.id);

export function socialPlatform(id: PlatformId): SocialPlatform {
  return SOCIAL_PLATFORMS.find((platform) => platform.id === id)!;
}

/** en-GB's has no comma before "and". */
const NAME_LIST = localized((locale) => new Intl.ListFormat(locale, { type: "conjunction" }), "en-GB");

/** "TikTok", "TikTok and X", "TikTok, X and YouTube", "TikTok, X and 3 more". */
export function listNames(ids: readonly PlatformId[]): string {
  const names = ids.map((id) => socialPlatform(id).name);
  if (names.length <= 1) return names.join("");
  if (names.length > 3) return NAME_LIST().format([...names.slice(0, 2), t("{count, plural, one {# more} other {# more}}", { count: names.length - 2 })]);
  return NAME_LIST().format(names);
}

export function allNames(ids: readonly PlatformId[]): string {
  return NAME_LIST().format(ids.map((id) => socialPlatform(id).name));
}

export function platformsFor(kind: PostKind): PlatformId[] {
  return SOCIAL_PLATFORMS.filter((platform) => platform.kinds.includes(kind)).map((platform) => platform.id);
}

/** Whatever order they were picked in. */
export function sortPlatforms(ids: Iterable<PlatformId>): PlatformId[] {
  const picked = new Set(ids);
  return PLATFORM_IDS.filter((id) => picked.has(id));
}

/** Characters as people count them: an emoji is one. */
export function captionLength(text: string): number {
  return [...text].length;
}

export function hashtagCount(text: string): number {
  return text.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

/** `2:20`, `10:00`, `1:02:05`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export type MediaSummary =
  | { kind: "video"; duration: number; width: number; height: number }
  | { kind: "images"; count: number; width: number; height: number; mixedShapes: boolean };

export type PostIssue = {
  platform: PlatformId;
  /** Errors keep the post from going out; warnings are worth a look. */
  level: "error" | "warning";
  message: string;
};

/** A post with more goes out with the first ones and skips the rest. */
export function picturesOut(id: PlatformId): number {
  const platform = socialPlatform(id);
  return Math.min(platform.maxImages, platform.publishedImages ?? platform.maxImages);
}

export type PostCheckInput = {
  kind: PostKind;
  platforms: readonly PlatformId[];
  caption(platform: PlatformId): string;
  title(platform: PlatformId): string;
  /** The shared media, or its own. */
  media(platform: PlatformId): MediaSummary | null;
  settings?: PlatformSettings;
};

function settingsIssues(id: PlatformId, settings: PlatformSettings, add: (level: PostIssue["level"], message: string) => void) {
  if (id === "tiktok") {
    if (settings.tiktok.inbox) return;
    const { disclose, yourBrand, brandedContent, privacy } = settings.tiktok;
    if (!privacy) add("error", t("Pick who can watch."));
    if (disclose && !yourBrand && !brandedContent) {
      add("error", t("You need to indicate if your content promotes yourself, a third party, or both."));
    }
    if (disclose && brandedContent && privacy === "private") add("error", t("Branded content visibility cannot be set to private."));
  }
  if (id === "youtube" && youtubeTagsLength(settings.youtube.tags) > YOUTUBE_TAGS_LIMIT) {
    add("error", t("Tags are over the {limit} character limit.", { limit: YOUTUBE_TAGS_LIMIT }));
  }
  if (id === "youtube" && settings.youtube.tags.some((tag) => captionLength(tag) > 30)) {
    add("error", t("A YouTube tag can be 30 characters."));
  }
  if (id === "instagram" && settings.instagram.collaborators.length > INSTAGRAM_MAX_COLLABORATORS) {
    add("error", t("Takes up to {count, plural, one {# collaborator} other {# collaborators}}.", { count: INSTAGRAM_MAX_COLLABORATORS }));
  }
  if (id === "x" && settings.x.community.trim() && !xCommunityId(settings.x.community)) {
    add("error", t("Paste the community's link, like x.com/i/communities/…"));
  }
  if (id === "pinterest" && !settings.pinterest.board.trim()) add("error", t("Pick a board."));
}

export function checkPost(input: PostCheckInput): PostIssue[] {
  const issues: PostIssue[] = [];

  for (const id of input.platforms) {
    const platform = socialPlatform(id);
    const media = input.media(id);
    const add = (level: PostIssue["level"], message: string) => issues.push({ platform: id, level, message });

    if (!platform.kinds.includes(input.kind)) {
      if (input.kind === "text") add("error", platform.kinds.includes("image") ? t("Add a video or pictures.") : t("Add a video."));
      else add("error", t("Doesn't take {kind, select, image {image posts} video {video posts} story {stories} other {text posts}}.", { kind: input.kind }));
      continue;
    }
    if (input.settings && input.kind !== "story") settingsIssues(id, input.settings, add);

    if (input.kind === "story") {
      if (!media) add("error", t("Needs a picture or a video."));
      else if (media.kind === "images" && media.count > 1) add("error", t("A story takes one picture."));
      else if (media.kind === "video" && media.duration > STORY_MAX_SECONDS) {
        add("error", t("Story videos can be up to {duration}.", { duration: formatDuration(STORY_MAX_SECONDS) }));
      }
      if (media && media.width > 0 && !isAspect(media.width, media.height, 9 / 16)) add("warning", t("Not 9:16, so it shows with bars."));
      continue;
    }

    const caption = input.caption(id);
    const length = captionLength(caption);
    if (length > platform.captionLimit) {
      add(
        "error",
        t("Caption is {over} over the {limit} limit.", {
          over: (length - platform.captionLimit).toLocaleString(intlLocale()),
          limit: platform.captionLimit.toLocaleString(intlLocale()),
        }),
      );
    }
    if (platform.maxHashtags && hashtagCount(caption) > platform.maxHashtags) {
      add("error", t("Takes up to {count, plural, one {# hashtag} other {# hashtags}}.", { count: platform.maxHashtags }));
    }

    if (platform.title) {
      const title = input.title(id).trim();
      if (platform.title.required && !title) add("error", t("Needs a title."));
      const length = captionLength(title);
      if (length > platform.title.limit) add("error", t("Title is over the {limit} limit.", { limit: platform.title.limit }));
      else if (platform.title.cutOff && length > platform.title.cutOff) {
        add("warning", t("Titles over {count, plural, one {# character} other {# characters}} get cut off in search.", { count: platform.title.cutOff }));
      }
    }

    if (input.kind === "text") {
      if (!caption.trim()) add("error", t("Needs some text."));
      continue;
    }

    if (!media) {
      add("error", input.kind === "image" ? t("Needs a picture.") : t("Needs a video."));
      continue;
    }

    if (media.kind === "images") {
      const out = picturesOut(id);
      if (media.count > out) {
        const skipped = media.count - out;
        add(
          "warning",
          t("Takes the first {count, plural, one {# picture} other {# pictures}} and skips the other {skipped, plural, =1 {one} other {#}}.", { count: out, skipped }),
        );
      }
      if (platform.imageAspect && media.count > 0) {
        const aspect = media.width / media.height;
        if (aspect < platform.imageAspect.min || aspect > platform.imageAspect.max) add("warning", t("The first picture is cropped to fit."));
        if (media.count > 1 && media.mixedShapes) add("warning", t("Pictures are cropped to the first one's shape."));
      }
    } else if (media.duration > platform.maxVideoSeconds) {
      add("error", t("Videos can be up to {duration}.", { duration: formatDuration(platform.maxVideoSeconds) }));
    }

    const cropped = media.kind === "images" && platform.imageAspect;
    if (platform.vertical && !cropped && media.width > 0 && media.height > 0 && media.width / media.height > 0.8) {
      add("warning", t("Not vertical, so it plays with bars."));
    }
  }

  return issues;
}

/** Give or take a few pixels of rounding. */
export function isAspect(width: number, height: number, ratio: number): boolean {
  return width > 0 && height > 0 && Math.abs(width / height / ratio - 1) < 0.02;
}

/** A Short is 9:16 and three minutes or less. */
export function youtubeFormat(media: MediaSummary | null): "short" | "video" {
  return media?.kind === "video" && isAspect(media.width, media.height, 9 / 16) && media.duration <= 180 ? "short" : "video";
}

export type TikTokPrivacy = "public" | "friends" | "followers" | "private";
export type YouTubePrivacy = "public" | "unlisted" | "private";
export type XReplies = "everyone" | "following" | "mentioned";

export type PlatformSettings = {
  tiktok: {
    /** Empty until the person picks one. TikTok rejects a pre-selected choice. */
    privacy: TikTokPrivacy | null;
    comments: boolean;
    duet: boolean;
    stitch: boolean;
    /** TikTok then wants to know whose. */
    disclose: boolean;
    yourBrand: boolean;
    brandedContent: boolean;
    inbox: boolean;
  };
  instagram: { shareToFeed: boolean; collaborators: string[] };
  youtube: { title: string; privacy: YouTubePrivacy; madeForKids: boolean; tags: string[] };
  /** `community` is the link or number as it was pasted. */
  x: { replies: XReplies; community: string };
  pinterest: { title: string; link: string; board: string };
};

export type TikTokPostSettings = {
  privacy: TikTokPrivacy;
  comments: boolean;
  duet: boolean;
  stitch: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  /** The creator finishes it in TikTok. */
  inbox?: boolean;
};

export type YouTubePostSettings = {
  title: string;
  description: string;
  privacy: YouTubePrivacy;
  madeForKids: boolean;
  tags: string[];
  /** Vertical and three minutes or less, so the description carries #Shorts. */
  short?: boolean;
};

/** The description is the caption that platform gets. */
export function youtubePostSettings(
  settings: PlatformSettings,
  description = "",
  extra?: { title?: string; short?: boolean },
): YouTubePostSettings {
  return {
    title: [...(extra?.title ?? settings.youtube.title).trim()].slice(0, 100).join(""),
    description: [...description].slice(0, 5000).join(""),
    privacy: settings.youtube.privacy,
    madeForKids: settings.youtube.madeForKids,
    // A copy: the form's tags are a live store array, which the browser can't save.
    tags: [...settings.youtube.tags],
    ...(extra?.short ? { short: true } : {}),
  };
}

/** Nothing until who can watch is picked. */
export function tiktokPostSettings(settings: PlatformSettings): TikTokPostSettings | undefined {
  const tiktok = settings.tiktok;
  if (tiktok.inbox) {
    return {
      privacy: tiktok.privacy ?? "private",
      comments: false,
      duet: false,
      stitch: false,
      yourBrand: false,
      brandedContent: false,
      inbox: true,
    };
  }
  if (!tiktok.privacy) return undefined;
  return {
    privacy: tiktok.privacy,
    comments: tiktok.comments,
    duet: tiktok.duet,
    stitch: tiktok.stitch,
    yourBrand: tiktok.disclose && tiktok.yourBrand,
    brandedContent: tiktok.disclose && tiktok.brandedContent,
  };
}

export type InstagramPostSettings = PlatformSettings["instagram"];
export type XPostSettings = PlatformSettings["x"];
/** Its link is the post's own. */
export type PinterestPostSettings = Omit<PlatformSettings["pinterest"], "link">;

// The lists are copies: the form's are live store arrays, which the browser can't save.

export function instagramPostSettings(settings: PlatformSettings): InstagramPostSettings {
  return { shareToFeed: settings.instagram.shareToFeed, collaborators: [...settings.instagram.collaborators] };
}

export function xPostSettings(settings: PlatformSettings): XPostSettings {
  return { replies: settings.x.replies, community: settings.x.community.trim() };
}

export function pinterestPostSettings(settings: PlatformSettings): PinterestPostSettings {
  return { title: settings.pinterest.title.trim(), board: settings.pinterest.board.trim() };
}

export function defaultPlatformSettings(): PlatformSettings {
  return {
    tiktok: { privacy: null, comments: false, duet: false, stitch: false, disclose: false, yourBrand: false, brandedContent: false, inbox: false },
    instagram: { shareToFeed: true, collaborators: [] },
    youtube: { title: "", privacy: "public", madeForKids: false, tags: [] },
    x: { replies: "everyone", community: "" },
    pinterest: { title: "", link: "", board: "" },
  };
}

export const INSTAGRAM_MAX_COLLABORATORS = 3;
export const YOUTUBE_TAGS_LIMIT = 500;

/** Null when it can't be one. */
export function instagramHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

/** Null when there is nothing left. */
export function youtubeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ");
  return tag || null;
}

/** Commas between, and quotes around a tag with a space. */
export function youtubeTagsLength(tags: readonly string[]): number {
  return tags.reduce((sum, tag, index) => sum + captionLength(tag) + (tag.includes(" ") ? 2 : 0) + (index ? 1 : 0), 0);
}

/** From `x.com/i/communities/123…`, or the number on its own. */
export function xCommunityId(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{5,25}$/.test(text)) return text;
  return text.match(/(?:twitter|x)\.com\/i\/communities\/(\d{5,25})/i)?.[1] ?? null;
}

export function platformTitle(settings: PlatformSettings, id: PlatformId): string {
  if (id === "youtube") return settings.youtube.title;
  if (id === "pinterest") return settings.pinterest.title;
  return "";
}
