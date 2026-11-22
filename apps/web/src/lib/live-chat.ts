/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import tiktokSansUrl from "@/assets/fonts/TikTokSans-Variable-Latin.woff2?url";

import { msg } from "./i18n";

export type ChatPlatform = "twitch" | "tiktok";

export type ChatMessage = {
  name: string;
  color: string;
  text: string;
  /** Built-in badge ids, or the data URL of a picture you added. Drawn in this order. */
  badges: string[];
  /** A data URL. TikTok only; without one it draws TikTok's empty profile picture. */
  avatar?: string;
};

export type ChatBackground = "bubble" | "none";

export type ChatBadge = { id: string; label: string; params?: Record<string, number>; svg: string; width: number; height: number };

/** Twitch's own name colours, in the order its colour picker shows them. */
export const TWITCH_COLORS = [
  "#FF0000", "#0000FF", "#008000", "#B22222", "#FF7F50",
  "#9ACD32", "#FF4500", "#2E8B57", "#DAA520", "#D2691E",
  "#5F9EA0", "#1E90FF", "#FF69B4", "#8A2BE2", "#00FF7F",
];

/** How TikTok LIVE shows every name, before anyone picks a colour. */
export const TIKTOK_NAME_COLOR = "#C9C9CB";

export const CHAT_COLORS: Record<ChatPlatform, string[]> = {
  twitch: TWITCH_COLORS,
  tiktok: [TIKTOK_NAME_COLOR, ...TWITCH_COLORS.slice(0, 14)],
};

export const DEFAULT_CHAT: Record<ChatPlatform, ChatMessage> = {
  twitch: { name: "viewer", color: "#FF69B4", text: "you are boosted!", badges: ["founder"] },
  tiktok: { name: "viewer", color: TIKTOK_NAME_COLOR, text: "you are boosted!", badges: ["level-24"] },
};

const square = (fill: string, glyph: string, label: string, id: string): ChatBadge => ({
  id,
  label,
  width: 18,
  height: 18,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="3" fill="${fill}"/>${glyph}</svg>`,
});

const W = `fill="#fff"`;
const S = (width = 1.8) => `fill="none" stroke="#fff" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
const NUMBER = `font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#fff"`;

export const TWITCH_BADGES: ChatBadge[] = [
  square("#E91916", `<rect x="3" y="5.5" width="8.5" height="7" rx="1.4" ${W}/><path d="M12 8.2 15 6.4v5.2L12 9.8z" ${W}/>`, msg("Broadcaster"), "broadcaster"),
  square("#00AD03", `<path d="M14.2 3.8 7.4 10.6M5.2 8.8l4 4M4 14l1.8-1.8" ${S()}/><path d="M14.6 3.4v2.2l-1-1z" ${W}/>`, msg("Moderator"), "moderator"),
  square("#E005B9", `<path d="M5.4 4.6h7.2L15 7.6 9 14 3 7.6z" ${W}/><path d="M3 7.6h12M7 4.6 9 7.6l2-3M9 7.6V14" fill="none" stroke="#E005B9" stroke-width=".7"/>`, msg("VIP"), "vip"),
  {
    id: "founder",
    label: msg("Founder"),
    width: 18,
    height: 18,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E35BE8"/><stop offset="1" stop-color="#8B2BE2"/></linearGradient></defs><rect width="18" height="18" rx="3" fill="url(#g)"/><text x="3" y="14.5" font-size="13" ${NUMBER}>1</text><text x="9.4" y="8.6" font-size="6.6" ${NUMBER}>ST</text></svg>`,
  },
  square("#9146FF", `<path d="m9 3 1.8 3.8 4.1.5-3 2.8.8 4.1L9 12.2l-3.7 2 .8-4.1-3-2.8 4.1-.5z" ${W}/>`, msg("Subscriber"), "subscriber"),
  square("#9146FF", `<path d="m5 9.2 2.7 2.7L13.2 6.3" ${S(2.2)}/>`, msg("Verified"), "verified"),
  square("#00A8E1", `<path d="M3.5 6.5 6.4 9 9 4.8 11.6 9l2.9-2.5-1.2 6.5H4.7z" ${W}/>`, msg("Prime Gaming"), "prime"),
  square("#59399A", `<rect x="3" y="5.5" width="10.5" height="7" rx="1.2" ${S(1.4)}/><path d="M14.4 7.8v2.4" ${S(1.4)}/><path d="M8.9 6.4 6.6 9.3h1.9l-.6 2.3 2.3-2.9H8.3z" ${W}/>`, msg("Turbo"), "turbo"),
  square("#1F69FF", `<path d="M12.7 3.6 14.4 5.3 8.2 11.5 6.5 9.8zM6 10.6l1.4 1.4-.9 1.9c-.6.9-2 1.3-3.3 1 .5-.6.4-1.5.8-2.4z" ${W}/>`, msg("Artist"), "artist"),
  square("#000000", `<path d="M12.8 3.5a3 3 0 0 0-3.3 4L4 13a1.4 1.4 0 0 0 2 2l5.5-5.5a3 3 0 0 0 4-3.3l-1.9 1.9-1.6-.4-.4-1.6z" ${W}/>`, msg("Staff"), "staff"),
  square("#FAAF19", `<path d="M9 3.2 14 5v3.8c0 3-2.1 5.1-5 6.2-2.9-1.1-5-3.2-5-6.2V5z" ${W}/><path d="m9 6.1.9 1.8 2 .3-1.5 1.4.4 2L9 10.6l-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#FAAF19"/>`, msg("Admin"), "admin"),
];

const pill = (id: string, label: string, width: number, from: string, to: string, inner: string): ChatBadge => ({
  id,
  label,
  width,
  height: 16,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 16"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${width}" height="16" rx="${width === 16 ? 4 : 8}" fill="url(#g)"/>${inner}</svg>`,
});

const GEM = `<path d="M5.4 4h5.2L13 7l-5 5.4L3 7z" ${W}/>`;
const CROWN = `<path d="M3 5.5 5.2 7.4 7 4.2l1.8 3.2L11 5.5l-.9 5.3H3.9z" ${W}/>`;

const level = (n: number, from: string, to: string): ChatBadge => ({
  ...pill(`level-${n}`, msg("Level {n}"), 32, from, to, `${GEM}<text x="14.5" y="11.6" font-size="9.5" ${NUMBER}>${n}</text>`),
  params: { n },
});

const top = (n: number, from: string, to: string): ChatBadge => ({
  ...pill(`top-${n}`, msg("Top viewer No. {n}"), 36, from, to, `${CROWN}<text x="13" y="11.4" font-size="8.6" ${NUMBER}>No.${n}</text>`),
  params: { n },
});

export const TIKTOK_BADGES: ChatBadge[] = [
  level(8, "#00B89F", "#4BDDC2"),
  level(24, "#3570FF", "#6FA4FF"),
  level(38, "#8A3FFC", "#C479FF"),
  pill("moderator", msg("Moderator"), 16, "#22B573", "#2FCB82", `<path d="M8 2.8 12.4 4.4v3.3c0 2.6-1.8 4.4-4.4 5.4-2.6-1-4.4-2.8-4.4-5.4V4.4z" ${W}/><path d="m6 8 1.5 1.5L10.2 6.7" fill="none" stroke="#22B573" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  top(1, "#FFC93C", "#FF9A16"),
  top(2, "#B9C6D6", "#8396AD"),
  top(3, "#E7A574", "#B9693A"),
  pill("subscriber", msg("Subscriber"), 16, "#FF3B87", "#A33BFF", `<path d="m8 2.8 1.6 3.3 3.6.4-2.7 2.5.7 3.6L8 10.8l-3.2 1.8.7-3.6-2.7-2.5 3.6-.4z" ${W}/>`),
  pill("fan-club", msg("Fan club"), 30, "#FE2C55", "#FF5C7C", `<path d="M8 12.4 3.6 8.2a2.5 2.5 0 0 1 4.4-2.4 2.5 2.5 0 0 1 4.4 2.4z" ${W}/><text x="14" y="11.6" font-size="9.5" ${NUMBER}>12</text>`),
  {
    id: "verified",
    label: msg("Verified"),
    width: 16,
    height: 16,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#20D5EC"/><path d="m4.6 8.2 2.3 2.3 4.5-4.6" ${S()}/></svg>`,
  },
  pill("gifter", msg("Gifter"), 16, "#FF8A3D", "#FE2C55", `<rect x="3.2" y="6.6" width="9.6" height="6.4" rx=".8" ${W}/><rect x="2.6" y="4.8" width="10.8" height="2.4" rx=".6" ${W}/><path d="M8 4.8v8.2" stroke="#FE5C49" stroke-width="1.2"/><path d="M8 4.8C6.6 2.6 4.6 3 5 4.2c.3.6 1.6.6 3 .6zm0 0c1.4-2.2 3.4-1.8 3 .6-.3.6-1.6.6-3 .6" ${W}/>`),
];

export const CHAT_BADGES: Record<ChatPlatform, ChatBadge[]> = { twitch: TWITCH_BADGES, tiktok: TIKTOK_BADGES };

/** Sizes in px at scale 1, which is the size each app shows them at. */
type Look = {
  font: string;
  size: number;
  line: number;
  nameWeight: number;
  textWeight: number;
  textColor: string;
  /** Between the name and the words. */
  separator: string;
  badge: number;
  badgeGap: number;
  avatar: number;
  avatarGap: number;
  padX: number;
  padY: number;
  radius: number;
  bubble: string;
  /** The most a line holds before it wraps, words only. */
  maxWidth: number;
};

const LOOKS: Record<ChatPlatform, Look> = {
  // Twitch's chat: Roobert 13/20 on #18181B, 18px badges 3px apart. Inter stands in for Roobert.
  twitch: {
    font: "Inter",
    size: 13,
    line: 20,
    nameWeight: 700,
    textWeight: 400,
    textColor: "#EFEFF1",
    separator: ": ",
    badge: 18,
    badgeGap: 3,
    avatar: 0,
    avatarGap: 0,
    padX: 10,
    padY: 5,
    radius: 8,
    bubble: "rgba(24, 24, 27, 0.94)",
    maxWidth: 300,
  },
  // TikTok LIVE's comments: TikTok Sans, a round picture, the name in grey and the words in white.
  tiktok: {
    font: "TikTok Sans",
    size: 13,
    line: 18,
    nameWeight: 600,
    textWeight: 500,
    textColor: "#FFFFFF",
    separator: " ",
    badge: 16,
    badgeGap: 4,
    avatar: 24,
    avatarGap: 8,
    padX: 8,
    padY: 6,
    radius: 18,
    bubble: "rgba(0, 0, 0, 0.32)",
    maxWidth: 240,
  },
};

const fontLoads = new Map<string, Promise<unknown>>();

function loadFonts(platform: ChatPlatform): Promise<unknown> {
  let loading = fontLoads.get(platform);
  if (!loading) {
    const look = LOOKS[platform];
    if (platform === "tiktok" && ![...document.fonts].some((face) => face.family.replace(/"/g, "") === look.font)) {
      document.fonts.add(new FontFace(look.font, `url(${tiktokSansUrl})`, { weight: "400 800" }));
    }
    loading = Promise.all([look.nameWeight, look.textWeight].map((weight) => document.fonts.load(`${weight} ${look.size}px "${look.font}"`))).catch((error: unknown) => {
      fontLoads.delete(platform);
      throw error;
    });
    fontLoads.set(platform, loading);
  }
  return loading;
}

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let loading = images.get(url);
  if (!loading) {
    loading = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load a chat picture"));
      image.src = url;
    });
    loading.catch(() => images.delete(url));
    images.set(url, loading);
  }
  return loading;
}

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const isPicture = (badge: string) => badge.startsWith("data:");

export function chatBadge(platform: ChatPlatform, id: string): ChatBadge | undefined {
  return CHAT_BADGES[platform].find((badge) => badge.id === id);
}

export function badgeUrl(platform: ChatPlatform, badge: string): string | undefined {
  if (isPicture(badge)) return badge;
  const known = chatBadge(platform, badge);
  return known ? svgUrl(known.svg) : undefined;
}

/** TikTok's picture for someone who hasn't set one: a grey head and shoulders. */
const EMPTY_AVATAR = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#8A8B91"/><circle cx="12" cy="9.6" r="4.2" fill="#D7D8DC"/><path d="M3.6 24c.6-4.6 4-7.4 8.4-7.4s7.8 2.8 8.4 7.4z" fill="#D7D8DC"/></svg>`,
);

export type ChatToken =
  | { kind: "badge"; width: number; height: number; image: HTMLImageElement }
  | { kind: "text"; text: string; width: number; font: string; color: string; space?: boolean };

export type PlacedToken = ChatToken & { x: number; line: number };

/** Lays tokens out left to right, wrapping at `maxWidth`; a word too long for a line breaks between letters. */
export function wrapTokens(tokens: ChatToken[], maxWidth: number, measure: (text: string, font: string) => number): { placed: PlacedToken[]; lines: number; width: number } {
  const placed: PlacedToken[] = [];
  let x = 0;
  let line = 0;
  const put = (token: ChatToken) => {
    placed.push({ ...token, x, line });
    x += token.width;
  };
  const isSpace = (token: ChatToken | undefined) => token?.kind === "text" && !!token.space;
  for (const token of tokens) {
    if (token.kind === "text" && token.space) {
      // A space never starts a line.
      if (x > 0) put(token);
      continue;
    }
    if (x > 0 && x + token.width > maxWidth) {
      while (isSpace(placed[placed.length - 1])) placed.pop();
      line += 1;
      x = 0;
    }
    if (token.kind === "text" && token.width > maxWidth) {
      let piece = "";
      for (const letter of token.text) {
        const width = measure(piece + letter, token.font);
        if (piece && x + width > maxWidth) {
          put({ ...token, text: piece, width: measure(piece, token.font) });
          line += 1;
          x = 0;
          piece = letter;
        } else piece += letter;
      }
      if (piece) put({ ...token, text: piece, width: measure(piece, token.font) });
      continue;
    }
    put(token);
  }
  while (isSpace(placed[placed.length - 1])) placed.pop();
  const width = placed.reduce((most, token) => Math.max(most, token.x + token.width), 0);
  return { placed, lines: line + 1, width };
}

/** Splits words from the spaces between them, so a line wraps between words. */
export function words(text: string): { text: string; space: boolean }[] {
  return (text.match(/\s+|\S+/g) ?? []).map((part) => (/^\s/.test(part) ? { text: " ", space: true } : { text: part, space: false }));
}

export async function renderChatMessage(platform: ChatPlatform, message: ChatMessage, background: ChatBackground, scale = 1): Promise<HTMLCanvasElement> {
  const look = LOOKS[platform];
  const badgeIds = message.badges.filter((badge) => badgeUrl(platform, badge));
  const [badgeImages, avatar] = await Promise.all([
    Promise.all(badgeIds.map((badge) => loadImage(badgeUrl(platform, badge)!).catch(() => null))),
    look.avatar ? loadImage(message.avatar || EMPTY_AVATAR).catch(() => loadImage(EMPTY_AVATAR)) : Promise.resolve(null),
    loadFonts(platform).catch(() => undefined),
  ]);

  const s = scale;
  const font = (weight: number) => `${weight} ${look.size * s}px "${look.font}", Inter, sans-serif`;
  const nameFont = font(look.nameWeight);
  const textFont = font(look.textWeight);
  const measureCtx = document.createElement("canvas").getContext("2d")!;
  const measure = (text: string, which: string) => {
    measureCtx.font = which;
    return measureCtx.measureText(text).width;
  };

  const tokens: ChatToken[] = [];
  for (const [index, image] of badgeImages.entries()) {
    if (!image) continue;
    const known = chatBadge(platform, badgeIds[index]!);
    const height = look.badge * s;
    const width = known ? (known.width / known.height) * height : (image.naturalWidth / Math.max(1, image.naturalHeight)) * height;
    tokens.push({ kind: "badge", width: width + look.badgeGap * s, height, image });
  }
  const name = message.name.trim() || "user";
  tokens.push({ kind: "text", text: name, width: measure(name, nameFont), font: nameFont, color: message.color });
  const separator = look.separator.trimEnd();
  if (separator) tokens.push({ kind: "text", text: separator, width: measure(separator, textFont), font: textFont, color: look.textColor });
  tokens.push({ kind: "text", text: " ", width: measure(" ", textFont), font: textFont, color: look.textColor, space: true });
  for (const word of words(message.text)) {
    tokens.push({ kind: "text", text: word.text, width: measure(word.text, textFont), font: textFont, color: look.textColor, space: word.space });
  }

  const { placed, lines, width: textWidth } = wrapTokens(tokens, look.maxWidth * s, measure);
  const line = look.line * s;
  const avatarSize = look.avatar * s;
  const left = look.padX * s + (avatar ? avatarSize + look.avatarGap * s : 0);
  const textHeight = lines * line;
  const contentHeight = Math.max(textHeight, avatarSize);
  const width = Math.ceil(left + textWidth + look.padX * s);
  const height = Math.ceil(contentHeight + look.padY * 2 * s);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  if (background === "bubble") {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, Math.min(look.radius * s, height / 2));
    ctx.fillStyle = look.bubble;
    ctx.fill();
  } else {
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 3 * s;
    ctx.shadowOffsetY = 1 * s;
  }

  const top = look.padY * s;
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(look.padX * s + avatarSize / 2, top + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, avatar, look.padX * s, top, avatarSize, avatarSize);
    ctx.restore();
  }

  // One line of text sits in the middle of the picture when the picture is taller.
  const textTop = top + (lines === 1 ? (contentHeight - line) / 2 : 0);
  ctx.textBaseline = "middle";
  for (const token of placed) {
    const middle = textTop + token.line * line + line / 2;
    if (token.kind === "badge") {
      ctx.drawImage(token.image, left + token.x, middle - token.height / 2, token.width - look.badgeGap * s, token.height);
    } else {
      ctx.font = token.font;
      ctx.fillStyle = token.color;
      ctx.fillText(token.text, left + token.x, middle + look.size * s * 0.04);
    }
  }
  return canvas;
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
  const drawWidth = ratio > 1 ? height * ratio : width;
  const drawHeight = ratio > 1 ? height : width / ratio;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

export function chatFileName(message: ChatMessage): string {
  const clean = message.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "Chat";
  return `${clean} chat.png`;
}

/** A picture you add, shrunk to a square this many px, so a feed stays light to drag and save. */
const PICTURE_SIZE = 96;

export async function shrinkPicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageOnce(url);
    const side = Math.min(image.naturalWidth, image.naturalHeight) || 1;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(PICTURE_SIZE, side);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImageOnce(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that picture"));
    image.src = url;
  });
}
