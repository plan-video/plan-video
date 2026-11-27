/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import {
  arrival, createTracker, gatherKills, measureColumn, nameStrip, pickNames, placeKills, readRows, ROW, slot as slotLook, type FeedRow, type FrameSource, type Reading, type Rgba,
} from "./kill-read";

const TEAL = [87, 222, 196] as const;
const RED = [240, 91, 88] as const;
const YELLOW = [231, 237, 131] as const;
const GROUND = [92, 64, 44] as const;
const WHITE = [250, 250, 250] as const;

const WIDTH = 1080;
const HEIGHT = 486;
const TALL = 34;
const RIGHT = 1060;

function blank(): Rgba & { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let at = 0; at < data.length; at += 4) data.set([...GROUND, 255], at);
  return { data, width: WIDTH, height: HEIGHT };
}

function fill(frame: Rgba & { data: Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, color: readonly number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) frame.data.set([...color, 255], (y * WIDTH + x) * 4);
}

/** An entry as Valorant draws one: the killer's colour up to the notch, the victim's after, yellow on yours. */
function entry(
  frame: Rgba & { data: Uint8ClampedArray },
  top: number,
  notch: number,
  options: { enemyKill?: boolean; mine?: "killer" | "victim"; hair?: boolean; name?: number; headshot?: boolean } = {},
) {
  const left = notch - 6 * TALL;
  const bottom = top + TALL;
  fill(frame, left, top, notch, bottom, options.enemyKill ? RED : TEAL);
  fill(frame, notch, top, RIGHT, bottom, options.enemyKill ? TEAL : RED);
  // The weapon, and the victim's name, which tells entries apart.
  fill(frame, notch - 3 * TALL, top + 10, notch - TALL, top + 22, WHITE);
  fill(frame, notch + 20, top + 11, notch + 20 + (options.name ?? notch % 7) * 12 + 20, top + 23, WHITE);
  if (options.headshot) fill(frame, notch - 30, top + 6, notch - 10, top + 28, WHITE);
  if (options.mine === "killer") {
    fill(frame, left, top, left + 6, bottom, YELLOW);
    fill(frame, left, top, notch - 2 * TALL, top + 2, YELLOW);
    fill(frame, left, bottom - 2, notch - 2 * TALL, bottom, YELLOW);
  }
  if (options.mine === "victim") fill(frame, RIGHT - 6, top, RIGHT, bottom, YELLOW);
  // A blond agent: yellow in the picture, but not a bar from top to bottom.
  if (options.hair) fill(frame, RIGHT - 40, top, RIGHT - 10, top + 14, YELLOW);
}

describe("readRows", () => {
  it("finds each entry and whose it is", () => {
    const frame = blank();
    entry(frame, 96, 900, { mine: "killer" });
    entry(frame, 136, 930, { hair: true });
    entry(frame, 176, 960, { enemyKill: true, mine: "victim" });

    const rows = readRows(frame, 1);

    expect(rows.map(({ top, notch, enemyKill, mine }) => ({ top, notch, enemyKill, mine }))).toEqual([
      { top: 96, notch: 900, enemyKill: false, mine: "killer" },
      { top: 136, notch: 930, enemyKill: false, mine: null },
      { top: 176, notch: 960, enemyKill: true, mine: "victim" },
    ]);
  });

  it("joins an entry that glare split in two, but not two entries", () => {
    const frame = blank();
    entry(frame, 96, 900, { mine: "killer" });
    entry(frame, 136, 900, { mine: "killer" });
    // Orange light through the panel turns a few lines of the victim's red pink.
    fill(frame, 900, 148, 940, 154, [241, 175, 167]);

    expect(readRows(frame, 1).map(({ top, bottom }) => [top, bottom])).toEqual([
      [96, 130],
      [136, 170],
    ]);
  });

  it("doesn't take yellow light showing around an entry for the lines on yours", () => {
    const frame = blank();
    entry(frame, 96, 900);
    fill(frame, 900 - 6 * TALL, 90, 900 - 3 * TALL, 96, YELLOW);
    fill(frame, 900 - 6 * TALL, 130, 900 - 3 * TALL, 135, YELLOW);

    expect(readRows(frame, 1).map(({ mine }) => mine)).toEqual([null]);
  });

  it("never makes an enemy's kill yours, nor a teammate's death", () => {
    const frame = blank();
    entry(frame, 96, 900, { enemyKill: true, mine: "killer" });
    entry(frame, 136, 930, { mine: "victim" });

    expect(readRows(frame, 1).map(({ mine }) => mine)).toEqual([null, null]);
  });

  it("finds nothing in a frame without a feed", () => {
    const frame = blank();
    fill(frame, 300, 100, 700, 300, RED);
    expect(readRows(frame, 1)).toEqual([]);
  });
});

describe("createTracker", () => {
  type Shown = { top: number; notch: number; name: number };
  const see = (frames: { time: number; shown: Shown[] }[]) => {
    const tracker = createTracker();
    for (const { time, shown } of frames) {
      const frame = blank();
      for (const { top, notch, name } of shown) entry(frame, top, notch, { mine: "killer", name, headshot: true });
      const rows = readRows(frame, 1);
      tracker.see(time, frame, rows, measureColumn(rows) ?? { right: RIGHT, tall: TALL }, 1);
    }
    return tracker.kills().map((kill) => [kill.first, kill.seen, kill.arrived.top]);
  };
  const A = { notch: 900, name: 2 };
  const B = { notch: 902, name: 3 };

  it("keeps one entry through a frame that missed the feed", () => {
    expect(see([
      { time: 0, shown: [{ top: 96, ...A }] },
      { time: 0.1, shown: [] },
      { time: 0.2, shown: [{ top: 96, ...A }] },
    ])).toEqual([[0, 2, 96]]);
  });

  it("follows entries afresh after a flash hid the feed", () => {
    expect(see([
      { time: 0, shown: [{ top: 96, ...A }] },
      { time: 0.1, shown: [{ top: 96, ...A }] },
      { time: 0.5, shown: [{ top: 96, ...B }] },
      { time: 0.6, shown: [{ top: 96, ...B }] },
    ])).toEqual([
      [0, 2, 96],
      [0.5, 2, 96],
    ]);
  });

  it("keeps a look-alike that came in below from taking over the entry above as the stack moves up", () => {
    expect(see([
      { time: 0, shown: [{ top: 96, notch: 960, name: 6 }, { top: 136, ...A }] },
      { time: 0.1, shown: [{ top: 96, notch: 960, name: 6 }, { top: 136, ...A }] },
      // The top entry leaves, A moves up into its place, and B comes in where A was.
      { time: 0.2, shown: [{ top: 96, ...A }, { top: 136, ...B }] },
      { time: 0.3, shown: [{ top: 96, ...A }, { top: 136, ...B }] },
    ])).toEqual([
      [0, 2, 96],
      [0, 4, 136],
      [0.2, 2, 136],
    ]);
  });

  it("moves the whole stack up together when one leaves the top as a look-alike joins the bottom", () => {
    const S = { notch: 960, name: 6 };
    expect(see([
      { time: 0, shown: [{ top: 96, notch: 940, name: 4 }, { top: 136, ...S }, { top: 176, ...A }] },
      { time: 0.1, shown: [{ top: 96, notch: 940, name: 4 }, { top: 136, ...S }, { top: 176, ...A }] },
      // The scene behind the see-through panel changes A's look as it moves up; the new one below looks as A did.
      { time: 0.2, shown: [{ top: 96, ...S }, { top: 136, ...A, name: 3 }, { top: 176, ...A }] },
      { time: 0.3, shown: [{ top: 96, ...S }, { top: 136, ...A, name: 3 }, { top: 176, ...A }] },
    ])).toEqual([
      [0, 2, 96],
      [0, 4, 136],
      [0, 4, 176],
      [0.2, 2, 176],
    ]);
  });
});

const reading = (killer: string, victim: string, headshot = false, fits: Reading["fits"] = { killer: { [killer]: 0.9 }, victim: { [victim]: 0.9 } }): Reading => ({
  killer,
  victim,
  weapon: "weapons/Vandal.png",
  headshot,
  scores: { killer: 0.9, victim: 0.9, weapon: 0.9, headshot: headshot ? 0.6 : 0.1 },
  fits,
  names: { killer: [0, 0], victim: [0, 0] },
});

const row = { top: 96, bottom: 130, notch: 900, right: RIGHT, enemyKill: false, mine: "killer", print: new Float32Array() } satisfies FeedRow;

const picture = { data: new Uint8ClampedArray(4), width: 1, height: 1, notch: 0 };

describe("gatherKills", () => {
  it("makes one kill of an entry read twice, from its steadiest reading", () => {
    const kills = gatherKills([
      { time: 2, death: false, seen: 3, row, picture, kill: reading("Cypher", "Sova", true) },
      { time: 2.5, death: false, seen: 30, row, picture, kill: reading("Cypher", "Sova") },
    ]);
    expect(kills.map(({ time, victim, headshot }) => ({ time, victim, headshot }))).toEqual([{ time: 2, victim: "Sova", headshot: false }]);
  });

  it("reads an entry seen twice from the surer reading, not the one glare washed out", () => {
    const washed = { ...reading("Cypher", "Clove"), weapon: "weapons/Operator.png", scores: { killer: 0.9, victim: 0.86, weapon: 0.55, headshot: 0.37 } };
    const kills = gatherKills([
      { time: 5.1, death: false, seen: 18, row, picture, kill: { ...reading("Cypher", "Clove", true), scores: { killer: 0.9, victim: 0.86, weapon: 0.92, headshot: 0.61 } } },
      { time: 7.9, death: false, seen: 21, row, picture, kill: washed },
    ]);
    expect(kills.map(({ time, weapon, headshot }) => ({ time, weapon, headshot }))).toEqual([{ time: 5.1, weapon: "weapons/Vandal.png", headshot: true }]);
  });

  it("names you by the agent that fits your side best across all your entries", () => {
    // Skye wins two entries by a hair; Hush fits every one about as well.
    const close = { killer: { Skye: 0.63, Hush: 0.62 }, victim: {} };
    const kills = gatherKills([
      { time: 1, death: false, seen: 9, row, picture, kill: reading("Skye", "Phoenix", false, close) },
      { time: 2, death: false, seen: 9, row, picture, kill: reading("Skye", "Sova", false, close) },
      { time: 3, death: false, seen: 9, row, picture, kill: reading("Hush", "Omen", false, { killer: { Hush: 0.66, Skye: 0.41 }, victim: {} }) },
      { time: 4, death: true, seen: 9, row, picture, kill: reading("Yoru", "Hush", false, { killer: {}, victim: { Hush: 0.9, Skye: 0.3 } }) },
    ]);
    expect(kills.map((kill) => `${kill.killer} > ${kill.victim}`)).toEqual(["Hush > Phoenix", "Hush > Sova", "Hush > Omen", "Yoru > Hush"]);
  });

  it("leaves out an entry whose victim couldn't be made out", () => {
    const blurred = { ...reading("Hush", "Astra"), scores: { killer: 0.6, victim: 0.46, weapon: 0.9, headshot: 0.1 } };
    const kills = gatherKills([
      { time: 13.6, death: false, seen: 3, row, picture, kill: blurred },
      { time: 13.9, death: false, seen: 9, row, picture, kill: reading("Hush", "Chamber") },
    ]);
    expect(kills.map((kill) => kill.victim)).toEqual(["Chamber"]);
  });

  it("counts the streak up and starts it over when you die", () => {
    const kills = gatherKills([
      { time: 1, death: false, seen: 9, row, picture, kill: reading("Jett", "Sova") },
      { time: 2, death: false, seen: 9, row, picture, kill: reading("Jett", "Omen") },
      { time: 3, death: true, seen: 9, row, picture, kill: reading("Yoru", "Jett") },
      { time: 40, death: true, seen: 9, row, picture, kill: reading("Raze", "Jett") },
      { time: 90, death: false, seen: 9, row, picture, kill: reading("Jett", "Sova") },
    ]);
    expect(kills.map((kill) => [kill.death, kill.streak])).toEqual([
      [false, 1],
      [false, 2],
      [true, 0],
      [true, 0],
      [false, 1],
    ]);
  });

  it("keeps one death a round, however the killer was read", () => {
    const kills = gatherKills([
      { time: 11.8, death: true, seen: 3, row, picture, kill: reading("Skye", "Cypher") },
      { time: 11.9, death: true, seen: 40, row, picture, kill: reading("Yoru", "Cypher") },
    ]);
    expect(kills.map((kill) => [kill.time, kill.killer])).toEqual([[11.8, "Yoru"]]);
  });
});

describe("arrival", () => {
  const slot = (look: "empty" | "flash" | "kill" | "other") => {
    const frame = blank();
    if (look === "flash") fill(frame, 700, 96, RIGHT, 130, TEAL);
    if (look === "kill") entry(frame, 96, 900, { mine: "killer", name: 2 });
    if (look === "other") entry(frame, 96, 900, { mine: "killer", name: 6, headshot: true });
    return frame;
  };
  const at = (looks: Parameters<typeof slot>[0][], seen: number) =>
    arrival(looks.map((look, index) => ({ time: index, look: slotLook(slot(look), row) })), seen);

  it("lands on the frame the entry flashed in on", () => {
    expect(at(["empty", "empty", "flash", "kill", "kill"], 3)).toBe(2);
  });

  it("stops at another entry the stack moved out of the slot", () => {
    expect(at(["other", "other", "flash", "kill", "kill"], 4)).toBe(2);
  });

  it("stops at the flash though the entry before it looks alike", () => {
    expect(at(["kill", "kill", "flash", "kill", "kill"], 4)).toBe(2);
  });

  it("follows back from the first frame that shows it, not the last", () => {
    // Caught at 2, then the stack moved it up and out of the slot.
    expect(at(["empty", "flash", "kill", "kill", "empty"], 2)).toBe(1);
  });
});

describe("placeKills", () => {
  /** An entry that flashes in at `arrives` and stays up. */
  const video = (arrives: number): FrameSource => ({
    unit: 1,
    frameRate: 10,
    duration: 20,
    async *frames(times) {
      for (const time of times) {
        const frame = blank();
        if (time >= arrives + 0.1 - 1e-6) entry(frame, 96, 900, { mine: "killer", name: 2 });
        else if (time >= arrives - 1e-6) fill(frame, 700, 96, RIGHT, 130, TEAL);
        yield { time, frame };
      }
    },
  });
  /** A clip showing `start` to `end` of the video, whose scan caught the entry at `caught`. */
  const place = async (start: number, end: number, arrives: number, caught: number) => {
    const sightings = [{ time: caught, death: false, seen: 9, row, picture, kill: reading("Jett", "Sova") }];
    const kills = await placeKills(video(arrives), { start, end, from: start - 1, to: end + 1.5, sightings });
    return kills.map((kill) => Math.round(kill.time * 100) / 100);
  };

  it("gives a kill on a cut to one clip, when a video is cut in pieces", async () => {
    expect(await place(3, 5, 5, 5.2)).toEqual([]);
    expect(await place(5, 7, 5, 5.2)).toEqual([5]);
  });

  it("leaves out an entry still up from before the clip, though a flash made it look new", async () => {
    expect(await place(5, 7, 4, 5.2)).toEqual([]);
  });

  it("times kills caught close together from the frames they share", async () => {
    const sightings = [
      { time: 5.2, death: false, seen: 9, row, picture, kill: reading("Jett", "Sova") },
      { time: 5.6, death: false, seen: 9, row, picture, kill: reading("Jett", "Omen") },
    ];
    const kills = await placeKills(video(5), { start: 3, end: 8, from: 2, to: 9.5, sightings });
    expect(kills.map((kill) => Math.round(kill.time * 100) / 100)).toEqual([5, 5]);
  });

  it("keeps a kill that came in before the clip ended, though it was told yours only after", async () => {
    expect(await place(10, 12, 11.7, 12.3)).toEqual([11.7]);
  });
});

describe("pickNames", () => {
  const name = (text: string, confidence = 95) => ({ text, confidence });

  it("names you as most of your entries read, and everyone else only where clear", () => {
    const names = pickNames(
      [{ death: false }, { death: false }, { death: false }, { death: true }],
      [
        { killer: name("Me"), victim: name("Phoenix") },
        { killer: name("Lyne", 17), victim: name("Omen") },
        { killer: name("Me"), victim: name("EP MAGNUM") },
        { killer: name("Yoru"), victim: name("Me") },
      ],
    );
    expect(names).toEqual([
      { killer: "Me", victim: "Phoenix" },
      { killer: "Me", victim: "Omen" },
      { killer: "Me", victim: "EP MAGNUM" },
      { killer: "Yoru", victim: "Me" },
    ]);
  });

  it("leaves a name it couldn't read clearly to the agent", () => {
    expect(pickNames([{ death: false }], [{ killer: name("ve", 25), victim: name("Taru", 0) }])).toEqual([{ killer: undefined, victim: undefined }]);
  });

  it("leaves to the agent what no player could be called: letters it can't read, like Korean, come out as these", () => {
    expect(pickNames([{ death: false }], [{ killer: name("Lt", 77), victim: name("At}", 80) }])).toEqual([{ killer: undefined, victim: undefined }]);
  });
});

describe("nameStrip", () => {
  /** A cut-out entry: the victim's name, then a white-haired picture a wide gap after it. */
  const cut = () => {
    const width = 200;
    const data = new Uint8ClampedArray(width * ROW * 4);
    for (let at = 0; at < data.length; at += 4) data.set([240, 91, 88, 255], at);
    const paint = (x0: number, x1: number, color: number[]) => {
      for (let y = 10; y < 22; y++) for (let x = x0; x < x1; x++) data.set([...color, 255], (y * width + x) * 4);
    };
    // White letters that compression tinted pink on the red.
    paint(20, 30, [240, 185, 178]);
    paint(33, 60, [240, 185, 178]);
    paint(120, 140, [250, 250, 250]);
    return { data, width, height: ROW, notch: 10 };
  };

  it("keeps the name nearest the notch and leaves the picture out", () => {
    const strip = nameStrip(cut(), [12, 160], "victim", 1);
    // The letters and a little room either side, black on white.
    expect(strip.width).toBeLessThan(60);
    const dark = (x: number) => strip.data[(16 * strip.width + x) * 4]! < 128;
    expect(Array.from({ length: strip.width }, (_, x) => dark(x)).filter(Boolean).length).toBeGreaterThan(30);
  });
});
