/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { addedClip, clipFromMoment, clipMade, clipPostOptions, clipWords, readClock, trimmed } from "./clip-studio";

import type { StreamMoment, StreamVideo } from "./stream-clips";

const video: StreamVideo = { id: "1", title: "Stream", seconds: 3600, channel: "tarik", login: "tarik", game: "VALORANT" };
const moment: StreamMoment = {
  start: 1010,
  end: 1035,
  score: 80,
  title: "No way",
  caption: "#valorant",
  reason: "A clutch.",
  window: { start: 1000, end: 1060 },
  words: [
    { text: "before", start: 1002, end: 1002.5 },
    { text: "no", start: 1010.2, end: 1010.5 },
    { text: "way!", start: 1011, end: 1011.6 },
    { text: "after", start: 1050, end: 1050.4 },
  ],
};

describe("clip studio", () => {
  it("lets a found clip grow past what was picked, to the stretch heard and a little more", () => {
    const clip = clipFromMoment(moment, video);
    expect(clip.range).toEqual({ start: 985, end: 1075 });
    expect(trimmed(clip, 900, 2000)).toEqual({ start: 985, end: 1075 });
    // Never shorter than a few seconds, whichever handle was dragged past the other.
    expect(trimmed(clip, 1020, 1019)).toEqual({ start: 1020, end: 1023 });
    expect(trimmed(clip, 1074, 1075)).toEqual({ start: 1072, end: 1075 });
  });

  it("captions only the words inside the clip, timed from its start", () => {
    const clip = { ...clipFromMoment(moment, video), start: 1001, end: 1012 };
    expect(clipWords(clip).map((word) => [word.text, word.start, word.end])).toEqual([
      ["before", 1, 1.5],
      ["no", 9.2, 9.5],
      ["way!", 10, 10.6],
    ]);
  });

  it("makes the project from the trim and the words heard, and leaves unheard clips to transcribe", () => {
    const clip = clipFromMoment(moment, video);
    const options = clipPostOptions(clip, 4.5);
    expect(options.trims).toEqual([{ start: 4.5, duration: 25 }]);
    expect(options.transcript?.flatMap((line) => line.words.map((word) => word.text))).toEqual(["no", "way!"]);
    expect(options.hook?.text).toBe("No way");
    expect(options.name).toBe("No way");

    expect(clipPostOptions({ ...clip, captions: { ...clip.captions, on: false } }, 0)).toMatchObject({ captions: null });
    expect(clipPostOptions({ ...clip, captions: { ...clip.captions, on: false } }, 0).transcript).toBeUndefined();

    const added = addedClip(2000, 30, video, "Mine");
    const made = clipPostOptions(added, 1);
    expect(made.captions?.preset).toBe("pop");
    expect(made.transcript).toBeUndefined();
  });

  it("only makes a new project when something the video shows changed", () => {
    const clip = clipFromMoment(moment, video);
    const same = { ...clip, score: 10, reason: "Other", caption: "new post text" };
    expect(clipMade(same)).toBe(clipMade(clip));
    expect(clipMade({ ...clip, end: 1030 })).not.toBe(clipMade(clip));
    expect(clipMade({ ...clip, captions: { ...clip.captions, size: 100 } })).not.toBe(clipMade(clip));
  });

  it("reads times the way people type them", () => {
    expect(readClock("1:02:03")).toBe(3723);
    expect(readClock("62:03")).toBe(3723);
    expect(readClock("3723")).toBe(3723);
    expect(readClock("1h2m3s")).toBe(3723);
    expect(readClock("2m")).toBe(120);
    expect(readClock("soon")).toBeNull();
    expect(readClock("")).toBeNull();
  });
});
