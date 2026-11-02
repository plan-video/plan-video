/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { assignTimes, columnFromRows, fillCaptions, fillDown, fillTitlesDown, moveItem, readInOrder, restorablePosts, rowsFromPlainText, shuffled, spread, suggestTime } from "@/components/publish/bulk-plan";
import { localDateKey } from "@/components/calendar/utils";
import { momentOf } from "@/lib/time-zone";

const post = (id: string, fields: { ownTime?: boolean; ownCaption?: boolean; caption?: string } = {}) => ({
  id,
  day: "2030-01-01",
  time: "09:00",
  caption: "",
  ownTime: false,
  ownCaption: false,
  ...fields,
});

const at = (day: string, time = "09:00") => momentOf(day, time)!;

describe("assignTimes", () => {
  it("gives the plan's times to the posts nobody timed by hand, in order", () => {
    const posts = [post("a"), post("b", { ownTime: true }), post("c")];
    assignTimes(posts, [at("2030-02-01"), at("2030-02-02")]);
    expect(posts.map((item) => item.day)).toEqual(["2030-02-01", "2030-01-01", "2030-02-02"]);
  });

  it("overrides a hand-set time when the post is selected", () => {
    const posts = [post("a"), post("b", { ownTime: true })];
    assignTimes(posts, [at("2030-02-01")], new Set(["b"]));
    expect(posts[1]!.day).toBe("2030-02-01");
    expect(posts[0]!.day).toBe("2030-01-01");
  });

  it("keeps a selected post's new time when the rest are planned again", () => {
    const posts = [post("a"), post("b")];
    assignTimes(posts, [at("2030-02-01")], new Set(["b"]));
    assignTimes(posts, [at("2030-03-01"), at("2030-03-02")]);
    expect(posts.map((item) => item.day)).toEqual(["2030-03-01", "2030-02-01"]);
  });

  it("leaves the rest where they are when the plan runs out of times", () => {
    const posts = [post("a"), post("b")];
    assignTimes(posts, [at("2030-02-01")]);
    expect(posts.map((item) => item.day)).toEqual(["2030-02-01", "2030-01-01"]);
  });
});

describe("fillCaptions", () => {
  const fill = (template: string, target: ReturnType<typeof post>, index: number) => `${template} ${index + 1} of ${target.id}`;

  it("fills only the posts nobody wrote on, and empties them again with the template", () => {
    const posts = [post("a"), post("b", { ownCaption: true, caption: "mine" })];
    fillCaptions(posts, "hi", fill);
    expect(posts.map((item) => item.caption)).toEqual(["hi 1 of a", "mine"]);
    fillCaptions(posts, "  ", fill);
    expect(posts.map((item) => item.caption)).toEqual(["", "mine"]);
  });
});

describe("spread", () => {
  const plan = { startDay: "2030-01-07", times: ["09:00"], every: 1, skipWeekends: false };
  const stamps = (times: readonly Date[]) => times.map((time) => time.getTime());

  it("steps by days", () => {
    expect(spread(3, { ...plan, every: 2 }).map(localDateKey)).toEqual(["2030-01-07", "2030-01-09", "2030-01-11"]);
  });

  it("posts several a day, at their times in clock order, however they were entered", () => {
    expect(stamps(spread(3, { ...plan, times: ["18:00", "09:00"] }))).toEqual(stamps([at("2030-01-07", "09:00"), at("2030-01-07", "18:00"), at("2030-01-08", "09:00")]));
  });

  it("never gives two posts the same moment when a time is entered twice", () => {
    expect(stamps(spread(2, { ...plan, times: ["09:00", "09:00"] }))).toEqual(stamps([at("2030-01-07", "09:00"), at("2030-01-08", "09:00")]));
  });

  it("skips weekends", () => {
    // 2030-01-11 is a Friday.
    const times = spread(3, { ...plan, startDay: "2030-01-11", skipWeekends: true });
    expect(times.map(localDateKey)).toEqual(["2030-01-11", "2030-01-14", "2030-01-15"]);
  });

  it("leaves out times that have already passed", () => {
    const times = spread(2, { ...plan, times: ["09:00", "18:00"], after: at("2030-01-07", "12:00") });
    expect(stamps(times)).toEqual(stamps([at("2030-01-07", "18:00"), at("2030-01-08", "09:00")]));
  });

  it("gives nothing, and doesn't hang, without a time to post at", () => {
    expect(spread(3, { ...plan, times: [] })).toEqual([]);
  });
});

describe("suggestTime", () => {
  it("spaces new times three hours on, then fills the widest gap", () => {
    expect(suggestTime(["09:00"])).toBe("12:00");
    expect(suggestTime(["09:00", "21:00"])).toBe("15:00");
  });

  it("never repeats a time up to the most a day takes", () => {
    const times = ["09:00"];
    while (times.length < 12) times.push(suggestTime(times));
    expect(new Set(times).size).toBe(12);
    expect(times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))).toBe(true);
  });
});

describe("fillDown", () => {
  const row = (id: string, story = false) => ({ id, story, caption: "", ownCaption: false });

  it("fills from the row it was pasted on, stepping over stories", () => {
    const posts = [row("a"), row("b"), row("c", true), row("d")];
    expect(fillDown(posts, 1, ["one", "two"])).toEqual({ filled: 2, left: 0 });
    expect(posts.map((post) => post.caption)).toEqual(["", "one", "", "two"]);
    expect(posts[1]!.ownCaption).toBe(true);
    expect(posts[0]!.ownCaption).toBe(false);
  });

  it("says how many didn't fit, and an empty cell doesn't count as written", () => {
    const posts = [row("a"), row("b")];
    posts[1]!.caption = "old";
    posts[1]!.ownCaption = true;
    expect(fillDown(posts, 0, ["one", "", "three"])).toEqual({ filled: 2, left: 1 });
    expect(posts[1]).toMatchObject({ caption: "", ownCaption: false });
  });
});

describe("fillTitlesDown", () => {
  const row = (id: string, titled = true) => ({ id, titled, title: "" });

  it("fills from the row it was pasted on, stepping over posts with no title and saying what didn't fit", () => {
    const posts = [row("a"), row("b"), row("c", false), row("d")];
    expect(fillTitlesDown(posts, 1, ["one", "two", "three"], (post) => post.titled)).toEqual({ filled: 2, left: 1 });
    expect(posts.map((post) => post.title)).toEqual(["", "one", "", "two"]);
  });
});

describe("spreadsheet columns", () => {
  it("takes the first column and drops empty rows at the end, keeping those in between", () => {
    expect(columnFromRows([["a", "x"], [""], ["c"], [""], [""]])).toEqual(["a", "", "c"]);
  });

  it("treats tab-separated text as rows, but leaves an ordinary caption with line breaks alone", () => {
    expect(rowsFromPlainText("one\tx\ntwo\ty\n")).toEqual([["one", "x"], ["two", "y"]]);
    expect(rowsFromPlainText("First line\n\nSecond line")).toEqual([]);
  });
});

describe("order", () => {
  it("moves an item up and down", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("ignores a move out of range", () => {
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("shuffles without losing anything", () => {
    const list = ["a", "b", "c", "d"];
    expect(shuffled(list, () => 0)).toEqual(["b", "c", "d", "a"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  it("always changes the order when it can", () => {
    expect(shuffled(["a", "b"], () => 0.999)).toEqual(["b", "a"]);
  });
});

describe("readInOrder", () => {
  it("hands results over in the files' order, however they finish", async () => {
    const release: Record<string, (value: string) => void> = {};
    const ready: (string | null)[] = [];
    const running = readInOrder(
      ["a", "b", "c"],
      (name) => new Promise<string>((resolve) => (release[name] = resolve)),
      (value) => ready.push(value),
      () => {},
      3,
    );
    release.c!("C");
    release.b!("B");
    await Promise.resolve();
    expect(ready).toEqual([]);
    release.a!("A");
    await running;
    expect(ready).toEqual(["A", "B", "C"]);
  });

  it("never reads more than the limit at once, and a failed file doesn't stop the rest", async () => {
    let inFlight = 0;
    let most = 0;
    const failed: string[] = [];
    const ready: string[] = [];
    await readInOrder(
      ["a", "b", "c", "d", "e"],
      async (name) => {
        most = Math.max(most, ++inFlight);
        await Promise.resolve();
        inFlight--;
        if (name === "c") throw new Error("bad file");
        return name;
      },
      (value) => ready.push(value),
      (name) => failed.push(name),
      2,
    );
    expect(most).toBe(2);
    expect(failed).toEqual(["c"]);
    expect(ready).toEqual(["a", "b", "d", "e"]);
  });
});

describe("restorablePosts", () => {
  const files = new Map([
    ["a", "file a"],
    ["b", "file b"],
    ["c", "file c"],
  ]);

  it("never brings back a post that already reached the calendar", () => {
    const { posts, missing } = restorablePosts([{ id: "a" }, { id: "b" }], files, (id) => id === "a");
    expect(posts).toEqual([{ post: { id: "b" }, file: "file b" }]);
    expect(missing).toBe(0);
  });

  it("counts a post whose file wasn't kept, and keeps the order of the rest", () => {
    const { posts, missing } = restorablePosts([{ id: "c" }, { id: "gone" }, { id: "a" }], files, () => false);
    expect(posts.map(({ post }) => post.id)).toEqual(["c", "a"]);
    expect(missing).toBe(1);
  });
});
