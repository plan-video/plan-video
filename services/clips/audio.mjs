import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

const FETCH_AHEAD = 8;
const PIECE_TIMEOUT_MS = 30_000;
const LOUDNESS_RATE = 8000;
export const SPEECH_RATE = 16000;

/** The init segment and then each piece's bytes, in order, fetching a few ahead. */
export async function* pieceBytes(init, pieces, { fetchImpl = fetch, signal, headers } = {}) {
  const get = async (url) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(url, { headers, signal: AbortSignal.any([AbortSignal.timeout(PIECE_TIMEOUT_MS), ...(signal ? [signal] : [])]) });
        if (!res.ok) throw new Error(`Twitch answered ${res.status} for a piece of the broadcast.`);
        return Buffer.from(await res.arrayBuffer());
      } catch (error) {
        if (attempt >= 2 || signal?.aborted) throw error;
      }
    }
  };
  if (init) yield await get(init);
  const ahead = [];
  let next = 0;
  while (next < pieces.length || ahead.length) {
    while (ahead.length < FETCH_AHEAD && next < pieces.length) {
      const pending = get(pieces[next++].url);
      pending.catch(() => {});
      ahead.push(pending);
    }
    yield await ahead.shift();
  }
}

/** A sound file's [from, from + seconds) as the decoder reads it. */
const fileInput = (file, from, seconds) => ["-ss", String(from), "-t", String(seconds), "-i", file];

/**
 * Pipes `chunks` into ffmpeg and hands each piece of mono 16-bit PCM it decodes to `onPcm`. Samples
 * follow the pieces back to back, not Twitch's timestamps: those can drift from the playlist's
 * timeline, which chat and viewers' clips are timed on.
 */
export function decode(chunks, rate, onPcm, { ffmpeg = "ffmpeg", signal, input = ["-i", "pipe:0"] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...input, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "pipe:1"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let failed = null;
    let stderr = "";
    const stop = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => {
      failed = error.code === "ENOENT" ? new Error("ffmpeg isn't installed on the server.") : error;
    });
    child.stderr.on("data", (data) => (stderr = (stderr + data).slice(-2000)));
    let carry = null;
    child.stdout.on("data", (data) => {
      let bytes = carry ? Buffer.concat([carry, data]) : data;
      if (bytes.length % 2) {
        carry = bytes.subarray(bytes.length - 1);
        bytes = bytes.subarray(0, bytes.length - 1);
      } else carry = null;
      if (bytes.length) onPcm(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (failed) reject(failed);
      else if (signal?.aborted) reject(signal.reason ?? new Error("Stopped."));
      else if (code !== 0) reject(new Error(`ffmpeg couldn't read the audio: ${stderr.trim().split("\n").at(-1) ?? code}`));
      else resolve();
    });
    child.stdin.on("error", () => {});
    (async () => {
      try {
        for await (const chunk of chunks ?? []) {
          if (!child.stdin.write(chunk)) await new Promise((done) => child.stdin.once("drain", done));
        }
      } catch (error) {
        failed ??= error;
        stop();
      } finally {
        child.stdin.end();
      }
    })();
  });
}

/** Loudness of each second in dBFS, as a mean of the second's power. */
export class SecondLoudness {
  constructor(rate) {
    this.rate = rate;
    this.values = [];
    this.sum = 0;
    this.count = 0;
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i] / 32768;
      this.sum += value * value;
      if (++this.count === this.rate) this.flush();
    }
  }

  flush() {
    if (!this.count) return;
    this.values.push(10 * Math.log10(this.sum / this.count + 1e-10));
    this.sum = 0;
    this.count = 0;
  }

  done() {
    this.flush();
    return this.values;
  }
}

/**
 * Per-second loudness of the whole broadcast; seconds Twitch muted are null. `audio` is a stream's pieces
 * (`{ init, pieces, headers }`) or a downloaded `{ file }`.
 */
export async function measureLoudness(audio, { fetchImpl, ffmpeg, signal } = {}) {
  const meter = new SecondLoudness(LOUDNESS_RATE);
  if (audio.file) {
    await decode(createReadStream(audio.file), LOUDNESS_RATE, (pcm) => meter.push(pcm), { ffmpeg, signal });
    return meter.done();
  }
  await decode(pieceBytes(audio.init, audio.pieces, { fetchImpl, signal, headers: audio.headers }), LOUDNESS_RATE, (pcm) => meter.push(pcm), { ffmpeg, signal });
  const loud = meter.done();
  for (const piece of audio.pieces) {
    if (!piece.muted) continue;
    for (let s = Math.floor(piece.start); s < Math.ceil(piece.start + piece.duration) && s < loud.length; s++) loud[s] = null;
  }
  return loud;
}

export function wav(samples, rate) {
  const header = Buffer.alloc(44);
  const bytes = samples.length * 2;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, bytes)]);
}

/** [from, to) of the broadcast as 16 kHz mono WAV, the form /api/transcribe takes. */
export async function speechWav(audio, from, to, { fetchImpl, ffmpeg, signal } = {}) {
  const chunks = [];
  let length = 0;
  const keep = (pcm) => {
    chunks.push(pcm);
    length += pcm.length;
  };
  let first = from;
  if (audio.file) {
    await decode(null, SPEECH_RATE, keep, { ffmpeg, signal, input: fileInput(audio.file, from, to - from) });
  } else {
    const pieces = audio.pieces.filter((piece) => piece.start < to && piece.start + piece.duration > from);
    if (!pieces.length) return null;
    first = pieces[0].start;
    await decode(pieceBytes(audio.init, pieces, { fetchImpl, signal, headers: audio.headers }), SPEECH_RATE, keep, { ffmpeg, signal });
  }
  const all = new Int16Array(length);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const a = Math.max(0, Math.round((from - first) * SPEECH_RATE));
  const b = Math.min(all.length, Math.round((to - first) * SPEECH_RATE));
  return b > a ? wav(all.subarray(a, b), SPEECH_RATE) : null;
}
