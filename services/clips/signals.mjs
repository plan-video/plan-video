// Finds the stretches of a broadcast worth a closer look, from chat, loudness and viewers' own clips.
// Everything here is per second of the broadcast.

/** Chat reacts after the stream does: the delay of the stream, then the time to type. */
export const CHAT_LAG = 8;
export const WINDOW = 60;
const BASELINE = 300;
const REACTION = /\b(LUL|LULW|KEKW|OMEGALUL|LMAO+|LOL+|ICANT|PogU?|POGGERS|Pog|WTF|NO+|W+|HOLY|CLIP|INSANE)\b|😂|🤣|💀/i;
const CLIP_CALL = /\bclip\s*(it|that|this)\b|^clip$/i;

const median = (values) => {
  const sorted = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** A value's height over its neighbourhood: the median of `radius` seconds either side, sampled every `step`. */
function overBaseline(series, radius, step, spread) {
  const out = new Float64Array(series.length);
  const bases = [];
  for (let s = 0; s < series.length; s += step) {
    const a = Math.max(0, s - radius);
    const b = Math.min(series.length, s + radius);
    const near = [];
    for (let i = a; i < b; i += 2) near.push(series[i]);
    bases.push(median(near));
  }
  for (let s = 0; s < series.length; s++) {
    const base = bases[Math.min(bases.length - 1, Math.round(s / step))];
    const value = series[s];
    out[s] = value === null || base === null ? 0 : Math.max(0, spread(value, base));
  }
  return out;
}

/** Each message weighs 1, a reaction 2 and "clip it" 4, moved back by the chat's lag and summed over 10 s. */
export function chatHeat(messages, seconds) {
  const weight = new Float64Array(seconds);
  for (const message of messages) {
    const s = Math.floor(message.t) - CHAT_LAG;
    if (s < 0 || s >= seconds) continue;
    weight[s] += CLIP_CALL.test(message.text) ? 4 : REACTION.test(message.text) ? 2 : 1;
  }
  const summed = new Array(seconds).fill(0);
  let run = 0;
  for (let s = seconds - 1; s >= 0; s--) {
    run += weight[s] - (s + 10 < seconds ? weight[s + 10] : 0);
    summed[s] = run;
  }
  // As a Poisson count over its neighbourhood, so a quiet chat's burst counts like a busy one's.
  return overBaseline(summed, BASELINE, 10, (value, base) => (value - base) / Math.sqrt(base + 1));
}

/** Loudness over 3 s against the neighbourhood, in dB above it. */
export function loudHeat(loud) {
  const smooth = loud.map((_, s) => {
    const near = loud.slice(Math.max(0, s - 1), s + 2).filter((value) => value !== null);
    return near.length ? near.reduce((a, b) => a + b, 0) / near.length : null;
  });
  return overBaseline(smooth, BASELINE, 10, (value, base) => value - base);
}

/** Each viewer clip lights up its stretch, more for more views. */
export function clipHeat(clips, seconds) {
  const out = new Float64Array(seconds);
  for (const clip of clips) {
    const value = 1 + Math.log2(1 + clip.views);
    for (let s = Math.max(0, Math.floor(clip.start)); s < Math.min(seconds, Math.ceil(clip.start + clip.duration)); s++) out[s] = Math.max(out[s], value);
  }
  return out;
}

/** Scaled so its loudest 1% sits at 1, so each signal counts the same whatever its units. */
function normalise(series) {
  const sorted = [...series].filter((value) => value > 0).sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.99)] ?? sorted.at(-1) ?? 0;
  return top > 0 ? series.map((value) => Math.min(1.5, value / top)) : series.map(() => 0);
}

export function heat({ seconds, messages = [], loud = [], clips = [] }) {
  const chat = normalise(chatHeat(messages, seconds));
  const sound = normalise(loudHeat(Array.from({ length: seconds }, (_, s) => loud[s] ?? null)));
  const viewers = normalise(clipHeat(clips, seconds));
  return Array.from({ length: seconds }, (_, s) => chat[s] + 0.7 * sound[s] + 1.5 * viewers[s]);
}

/**
 * The hottest stretches, `WINDOW` long and apart from each other, hottest first. A window sits mostly
 * before its peak: what people react to comes first. Windows mostly muted by Twitch are skipped.
 */
export function pickWindows(scores, { count = 25, muted = () => false, clips = [] } = {}) {
  const seconds = scores.length;
  if (seconds < 10) return [];
  const length = Math.min(WINDOW, seconds);
  const taken = new Uint8Array(seconds);
  const windows = [];
  // Viewers already said where the moments are, so their best clips come first.
  for (const clip of [...clips].sort((a, b) => b.views - a.views)) {
    if (windows.length >= Math.ceil(count / 2)) break;
    const middle = clip.start + clip.duration / 2;
    const window = place(middle - length / 2, length, seconds);
    if (overlaps(taken, window) || muted(window)) continue;
    mark(taken, window);
    windows.push({ ...window, score: windowScore(scores, window) });
  }
  const order = Array.from({ length: seconds }, (_, s) => s).sort((a, b) => scores[b] - scores[a]);
  for (const peak of order) {
    if (windows.length >= count || scores[peak] <= 0) break;
    if (taken[peak]) continue;
    const window = place(peak - length * 0.6, length, seconds);
    if (overlaps(taken, window) || muted(window)) continue;
    mark(taken, window);
    windows.push({ ...window, score: windowScore(scores, window) });
  }
  return windows.sort((a, b) => b.score - a.score);
}

function place(start, length, seconds) {
  const from = Math.max(0, Math.min(seconds - length, Math.round(start)));
  return { start: from, end: from + length };
}

const overlaps = (taken, window) => {
  for (let s = window.start; s < window.end; s++) if (taken[s]) return true;
  return false;
};

const mark = (taken, window) => taken.fill(1, window.start, window.end);

function windowScore(scores, window) {
  let best = 0;
  for (let s = window.start; s < window.end; s++) best = Math.max(best, scores[s]);
  return best;
}

/** What chat said most during [from, to), for the model to read: "LUL ×42". */
export function chatSummary(messages, from, to, top = 8) {
  const counts = new Map();
  let total = 0;
  for (const message of messages) {
    const s = message.t - CHAT_LAG;
    if (s < from || s >= to) continue;
    total += 1;
    const text = message.text.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!text) continue;
    const key = text.toLowerCase();
    const entry = counts.get(key) ?? { text, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const lines = [...counts.values()].sort((a, b) => b.count - a.count || b.text.length - a.text.length).slice(0, top);
  return { total, lines: lines.map((entry) => (entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text)) };
}
