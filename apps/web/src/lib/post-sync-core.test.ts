// The rules of lib/post-sync-core.ts, between devices and a server that keeps
// posts the way the posts table does: a version raised on every change, a
// write only over the version read, deletion markers, a time per change, and
// thumbnails apart.

import { describe, expect, test } from "vitest";

import type { AccountMedia } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";

import { OVERLAP_MS, stable, syncPosts, type Base, type PostData, type PostRow, type Sent, type SyncIO } from "./post-sync-core";

const filesOf = (post: Pick<StoredEvent, "id" | "files" | "ownFiles" | "thread">) => [
  ...new Set([...(post.files ?? [post.id]), ...Object.values(post.ownFiles ?? {}).flatMap((ids) => ids ?? []), ...(post.thread ?? []).flatMap((reply) => reply.files ?? [])]),
];

/** The posts table, for one workspace. */
class Server {
  rows = new Map<string, PostRow>();
  thumbnails = new Map<string, string>();
  clock = Date.parse("2026-10-26T09:00:00Z");
  calls: string[] = [];
  /** A post with this title is turned down, as one naming another workspace's file is. */
  refuse = "refused by the server";
  /** Ids of posts in another of the owner's workspaces: taken, but not to be read from this one. */
  elsewhere = new Set<string>();

  tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  write(id: string, data: PostData | null): PostRow {
    const row = this.rows.get(id);
    const next: PostRow = {
      id,
      version: (row?.version ?? 0) + 1,
      data: data ? structuredClone(data) : null,
      deleted_at: data ? null : new Date(this.clock).toISOString(),
      updated_at: this.tick(),
      thumbnail_at: data ? (row?.thumbnail_at ?? null) : null,
    };
    if (!data) this.thumbnails.delete(id);
    this.rows.set(id, next);
    return structuredClone(next);
  }

  /** Someone else's edit, straight to the server. */
  edit(id: string, change: (data: PostData) => PostData) {
    return this.write(id, change(structuredClone(this.rows.get(id)!.data!)));
  }
}

/** A browser: its posts, file details and what it last agreed with the server. */
class Device {
  events = new Map<string, StoredEvent>();
  media = new Map<string, AccountMedia>();
  cursor: string | null = null;
  bases = new Map<string, Base>();
  known: Record<string, string> | null = null;
  /** Runs while a sync is between reading this device's posts and writing them back, like an edit made meanwhile. */
  meanwhile: (() => void) | null = null;

  constructor(readonly server: Server) {}

  io(): SyncIO<Map<string, string>> {
    const server = this.server;
    return {
      readLocal: async () => {
        const read = new Map([...this.events].map(([id, event]) => [id, stable(event)]));
        const snapshot = { events: [...this.events.values()].map((event) => structuredClone(event)), media: [...this.media.values()].map((item) => structuredClone(item)), read };
        this.meanwhile?.();
        this.meanwhile = null;
        return snapshot;
      },
      writeLocal: async (events, media, read) => {
        // As writeWorkspacePosts: a post changed here since it was read stays as it is.
        const kept = new Set<string>();
        const wanted = new Map(events.map((event) => [event.id, event]));
        for (const id of new Set([...this.events.keys(), ...wanted.keys()])) {
          const here = this.events.get(id);
          const changedHere = here ? read.get(id) !== stable(here) : read.has(id);
          if (changedHere) {
            if (stable(wanted.get(id) ?? null) !== stable(here ?? null)) kept.add(id);
            continue;
          }
          const there = wanted.get(id);
          if (there) this.events.set(id, structuredClone(there));
          else this.events.delete(id);
        }
        const listed = new Set([...this.events.values()].flatMap(filesOf));
        for (const item of media) this.media.set(item.id, structuredClone(item));
        for (const id of [...this.media.keys()]) if (!listed.has(id)) this.media.delete(id);
        return kept;
      },
      readState: async () => ({ cursor: this.cursor, bases: new Map([...this.bases].map(([id, base]) => [id, structuredClone(base)])) }),
      writeState: async (cursor, bases) => {
        this.cursor = cursor;
        for (const [id, base] of bases) {
          if (base) this.bases.set(id, structuredClone(base));
          else this.bases.delete(id);
        }
      },
      fetchRows: async (since) => {
        server.calls.push(since ? "changes" : "all");
        return [...server.rows.values()].filter((row) => !since || row.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map((row) => structuredClone(row));
      },
      fetchRow: async (id) => {
        server.calls.push(`read ${id}`);
        const row = server.rows.get(id);
        return row ? structuredClone(row) : null;
      },
      insert: async (id, data): Promise<Sent> => {
        server.calls.push(`insert ${id}`);
        if (data.title === server.refuse) return { refused: "This post names a file of another workspace." };
        if (server.rows.has(id) || server.elsewhere.has(id)) return { exists: true };
        return { ok: server.write(id, data) };
      },
      update: async (id, version, values): Promise<Sent> => {
        server.calls.push(`update ${id}`);
        const row = server.rows.get(id);
        if (!row || row.version !== version) return { moved: true };
        if ("data" in values && values.data.title === server.refuse) return { refused: "This post names a file of another workspace." };
        return { ok: server.write(id, "data" in values ? values.data : null) };
      },
      fetchThumbnails: async (ids) => {
        server.calls.push(`thumbnails ${ids.length}`);
        return new Map(ids.flatMap((id) => (server.thumbnails.has(id) ? [[id, server.thumbnails.get(id)!]] : [])));
      },
      saveThumbnail: async (id, thumbnail) => {
        server.calls.push(`thumbnail ${id}`);
        const row = server.rows.get(id);
        if (!row || !row.data) return "gone";
        if (thumbnail) server.thumbnails.set(id, thumbnail);
        else server.thumbnails.delete(id);
        const at = server.tick();
        server.rows.set(id, { ...row, thumbnail_at: at, updated_at: at });
        return at;
      },
      legacyKnown: async () => this.known,
      legacyFingerprint: (event) => stable(event),
      filesOf,
    };
  }

  sync() {
    return syncPosts(this.io());
  }

  /** Runs until it has nothing left to do, at most a few times. */
  async settle() {
    for (let run = 0; run < 5; run++) {
      const result = await this.sync();
      if (!result.again) return result;
    }
    throw new Error("never settled");
  }

  put(event: StoredEvent) {
    this.events.set(event.id, structuredClone(event));
  }

  edit(id: string, change: Partial<StoredEvent>) {
    this.events.set(id, { ...this.events.get(id)!, ...change });
  }
}

function post(id: string, change: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id,
    title: id,
    description: null,
    day: "2026-11-02",
    start: "09:00",
    allDay: false,
    duration: 30,
    calendarId: "posts",
    createdAt: "2026-10-26T08:00:00.000Z",
    link: null,
    platforms: ["x"],
    recurrence: null,
    recurrenceExceptions: [],
    status: "scheduled",
    timeZone: "Europe/Amsterdam",
    ...change,
  };
}

/** Each device's posts, as the publisher would read them. */
const posts = (device: Device) =>
  Object.fromEntries([...device.events.values()].sort((a, b) => a.id.localeCompare(b.id)).map((event) => [event.id, { ...event, deliveries: undefined, thumbnail: undefined }]));
const onServer = (server: Server) =>
  Object.fromEntries([...server.rows.values()].filter((row) => row.data).sort((a, b) => a.id.localeCompare(b.id)).map((row) => [row.id, { ...row.data }]));

function pair() {
  const server = new Server();
  return { server, a: new Device(server), b: new Device(server) };
}

describe("between two devices", () => {
  test("a new post goes up, and another device gets it", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    const sent = await a.sync();
    expect(sent.ok).toBe(true);
    expect(server.rows.get("p1")?.version).toBe(1);
    await b.sync();
    expect(posts(b)).toEqual(posts(a));
  });

  test("a run with nothing to do only asks what changed", async () => {
    const { server, a } = pair();
    a.put(post("p1"));
    await a.sync();
    server.calls = [];
    await a.sync();
    expect(server.calls).toEqual(["changes"]);
  });

  test("an edit reaches the other device, and its echo isn't sent back", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    await a.sync();
    await b.sync();
    a.edit("p1", { title: "Edited on A" });
    await a.sync();
    server.calls = [];
    await b.sync();
    expect(b.events.get("p1")?.title).toBe("Edited on A");
    expect(server.calls).toEqual(["changes"]);
    expect(server.rows.get("p1")?.version).toBe(2);
  });

  test("edits to different fields on each device are both kept", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    await a.sync();
    await b.sync();
    a.edit("p1", { title: "Title from A" });
    b.edit("p1", { description: "Words from B" });
    await a.sync();
    await b.sync();
    await a.sync();
    for (const device of [a, b]) {
      expect(device.events.get("p1")?.title).toBe("Title from A");
      expect(device.events.get("p1")?.description).toBe("Words from B");
    }
    expect(onServer(server)).toEqual(posts(a));
  });

  test("the same field changed on both: the device that saves later wins, and both agree", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    await a.sync();
    await b.sync();
    a.edit("p1", { title: "A" });
    b.edit("p1", { title: "B" });
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.events.get("p1")?.title).toBe("B");
    expect(posts(a)).toEqual(posts(b));
    expect(onServer(server)).toEqual(posts(a));
  });

  test("deleting the only post deletes it, rather than reading as a lost database", async () => {
    const { server, a } = pair();
    a.put(post("only"));
    await a.sync();
    a.events.delete("only");
    await a.sync();
    expect(server.rows.get("only")?.data).toBeNull();
    await a.sync();
    expect(a.events.has("only")).toBe(false);
  });

  test("a delete reaches the other device when it hadn't changed the post", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    await a.sync();
    await b.sync();
    a.events.delete("p1");
    await a.sync();
    expect(server.rows.get("p1")?.data).toBeNull();
    await b.sync();
    expect(b.events.has("p1")).toBe(false);
  });

  test("deleted on one device and edited on the other: the edit wins, either way round", async () => {
    for (const deleterFirst of [true, false]) {
      const { server, a, b } = pair();
      a.put(post("p1"));
      await a.sync();
      await b.sync();
      a.events.delete("p1");
      b.edit("p1", { title: "Kept" });
      if (deleterFirst) {
        await a.sync();
        await b.sync();
        await a.sync();
      } else {
        await b.sync();
        await a.sync();
        await b.sync();
      }
      expect(a.events.get("p1")?.title, `deleter first: ${deleterFirst}`).toBe("Kept");
      expect(b.events.get("p1")?.title).toBe("Kept");
      expect(server.rows.get("p1")?.data?.title).toBe("Kept");
    }
  });

  test("the server moving on between the read and the write is read and merged again", async () => {
    const { server, a } = pair();
    a.put(post("p1"));
    await a.sync();
    a.edit("p1", { title: "Mine" });
    // Someone else saves just after this device read what changed.
    a.meanwhile = () => server.edit("p1", (data) => ({ ...data, description: "Theirs" }));
    const result = await a.sync();
    expect(result.ok).toBe(true);
    expect(server.rows.get("p1")?.data).toMatchObject({ title: "Mine", description: "Theirs" });
    await a.sync();
    expect(a.events.get("p1")).toMatchObject({ title: "Mine", description: "Theirs" });
  });

  test("an edit made here while a run writes back is kept, and sent by the next run", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    await a.sync();
    await b.sync();
    b.edit("p1", { title: "From B" });
    await b.sync();
    a.meanwhile = () => a.edit("p1", { description: "Typed meanwhile" });
    const first = await a.sync();
    expect(first.again).toBe(true);
    await a.settle();
    expect(server.rows.get("p1")?.data).toMatchObject({ title: "From B", description: "Typed meanwhile" });
  });
});

describe("edits made while a run writes back", () => {
  test("a field changed back here while a run sends it is sent back again, not lost", async () => {
    const { server, a } = pair();
    a.put(post("p1", { title: "A" }));
    a.put(post("p2"));
    await a.sync();
    // Another post changes elsewhere, so this run writes back; meanwhile the title goes back to A.
    server.edit("p2", (data) => ({ ...data, title: "Elsewhere" }));
    a.edit("p1", { title: "B" });
    a.meanwhile = () => a.edit("p1", { title: "A" });
    await a.settle();
    expect(server.rows.get("p1")?.data?.title).toBe("A");
    expect(a.events.get("p1")?.title).toBe("A");
  });

  test("a merge kept back by an edit made meanwhile still keeps the other side's change", async () => {
    const { server, a } = pair();
    a.put(post("p1"));
    await a.sync();
    server.edit("p1", (data) => ({ ...data, title: "Theirs" }));
    a.edit("p1", { description: "Mine" });
    a.meanwhile = () => a.edit("p1", { link: "https://typed.meanwhile" });
    await a.settle();
    expect(server.rows.get("p1")?.data).toMatchObject({ title: "Theirs", description: "Mine", link: "https://typed.meanwhile" });
    expect(a.events.get("p1")).toMatchObject({ title: "Theirs", description: "Mine", link: "https://typed.meanwhile" });
  });

  test("a post the server keeps a little differently from how it was sent is taken as kept, and not sent again", async () => {
    const { server, a } = pair();
    const write = server.write.bind(server);
    // As jsonb might: one field comes back written its own way.
    server.write = (id, data) => write(id, data ? { ...data, duration: Number(data.duration) + 0 === 30 ? 30.0 : data.duration, title: String(data.title).normalize("NFC") } : data);
    a.put(post("p1", { title: "Cafe\u0301" }));
    await a.settle();
    server.calls = [];
    await a.sync();
    expect(server.calls).toEqual(["changes"]);
    expect(a.events.get("p1")?.title).toBe("Caf\u00e9");
  });
});

describe("files, refusals and ids", () => {
  test("a file the other device added to a post this side changed too keeps its details, here and on the server", async () => {
    const { server, a, b } = pair();
    a.put(post("p1", { files: [] }));
    await a.sync();
    await b.sync();
    a.edit("p1", { files: ["p1_new"] });
    a.media.set("p1_new", { id: "p1_new", name: "new.mp4", type: "video/mp4", lastModified: 5, cloud: { key: "posts/u/p1_new", at: "2026-10-26T09:00:00Z" } });
    await a.sync();
    b.edit("p1", { description: "B's caption" });
    await b.settle();
    expect(b.media.get("p1_new")).toEqual(a.media.get("p1_new"));
    await b.settle();
    expect(server.rows.get("p1")?.data?.media).toEqual([a.media.get("p1_new")]);
    expect(server.rows.get("p1")?.data).toMatchObject({ files: ["p1_new"], description: "B's caption" });
  });

  test("a post the server turns down doesn't make the run fail for the others", async () => {
    const { server, a } = pair();
    a.put(post("bad", { title: server.refuse }));
    a.put(post("good"));
    const result = await a.sync();
    expect(result.ok).toBe(true);
    expect(result.unsynced).toEqual(new Set(["bad"]));
  });

  test("a post this browser had, hidden from it now (a team paused), fails the run and goes once it can", async () => {
    const { server, a } = pair();
    a.put(post("p1"));
    await a.sync();
    a.edit("p1", { title: "Changed while paused" });
    const row = server.rows.get("p1")!;
    // Hidden: not to be read or written from here, though it's there.
    server.rows.delete("p1");
    server.elsewhere.add("p1");
    await expect(a.sync()).rejects.toThrow(/can't be reached/);
    server.elsewhere.delete("p1");
    server.rows.set("p1", row);
    await a.settle();
    expect(server.rows.get("p1")?.data?.title).toBe("Changed while paused");
  });

  test("an id another workspace has is turned down with a reason, not tried for ever", async () => {
    const { server, a } = pair();
    server.elsewhere.add("taken");
    a.put(post("taken"));
    const first = await a.sync();
    expect(first.refused.get("taken")).toMatch(/another workspace/);
    server.calls = [];
    await a.sync();
    expect(server.calls.filter((call) => call !== "all" && call !== "changes")).toEqual([]);
  });
});

describe("what isn't sent as the post", () => {
  test("delivery state stays here, the thumbnail goes on its own, and the other device gets the thumbnail", async () => {
    const { server, a, b } = pair();
    a.put(post("p1", { deliveries: { x: { state: "sent", attempts: 1, at: "2026-10-26T09:00:00Z" } }, thumbnail: "data:image/jpeg;base64,AAA" }));
    await a.sync();
    expect(server.rows.get("p1")?.data).not.toHaveProperty("deliveries");
    expect(server.rows.get("p1")?.data).not.toHaveProperty("thumbnail");
    expect(server.thumbnails.get("p1")).toBe("data:image/jpeg;base64,AAA");
    await b.sync();
    expect(b.events.get("p1")?.thumbnail).toBe("data:image/jpeg;base64,AAA");
    expect(b.events.get("p1")?.deliveries).toBeUndefined();
    // A's delivery state changing sends nothing.
    server.calls = [];
    a.edit("p1", { deliveries: { x: { state: "failed", attempts: 2, at: "2026-10-26T10:00:00Z" } } });
    await a.sync();
    expect(server.calls).toEqual(["changes"]);
  });

  test("a thumbnail sent here isn't read back, and a new one from the other device is", async () => {
    const { server, a, b } = pair();
    a.put(post("p1", { thumbnail: "data:image/jpeg;base64,ONE" }));
    await a.sync();
    await b.sync();
    server.calls = [];
    await a.sync();
    expect(server.calls).toEqual(["changes"]);
    b.edit("p1", { thumbnail: "data:image/jpeg;base64,TWO" });
    await b.sync();
    await a.sync();
    expect(a.events.get("p1")?.thumbnail).toBe("data:image/jpeg;base64,TWO");
  });

  test("a post's file details travel with it, and go when it does", async () => {
    const { server, a, b } = pair();
    a.put(post("p1", { files: ["p1_a"] }));
    a.media.set("p1_a", { id: "p1_a", name: "a.mp4", type: "video/mp4", lastModified: 1, cloud: { key: "posts/u/p1_a", at: "2026-10-26T09:00:00Z" } });
    a.media.set("stray", { id: "stray", name: "s.mp4", type: "video/mp4", lastModified: 2 });
    await a.sync();
    expect(server.rows.get("p1")?.data?.media).toEqual([a.media.get("p1_a")]);
    await b.sync();
    expect(b.media.get("p1_a")).toEqual(a.media.get("p1_a"));
    expect(b.events.get("p1")).not.toHaveProperty("media");
    a.events.delete("p1");
    await a.sync();
    await b.sync();
    expect(b.media.has("p1_a")).toBe(false);
  });
});

describe("keeping posts safe", () => {
  test("a browser whose database was lost reads its posts again rather than deleting them", async () => {
    const { server, a } = pair();
    for (const id of ["p1", "p2", "p3"]) a.put(post(id));
    await a.sync();
    // The posts and what was agreed on are kept together, and go together.
    a.events.clear();
    a.media.clear();
    a.bases.clear();
    a.cursor = null;
    const result = await a.sync();
    expect(result.ok).toBe(true);
    expect([...server.rows.values()].every((row) => row.data)).toBe(true);
    expect([...a.events.keys()].sort()).toEqual(["p1", "p2", "p3"]);
  });

  test("a post the server turns down is named, not sent again until it changes, and holds up nobody else", async () => {
    const { server, a } = pair();
    a.put(post("bad", { title: server.refuse }));
    a.put(post("good"));
    const first = await a.sync();
    expect(first.refused.get("bad")).toMatch(/another workspace/);
    expect(first.unsynced.has("bad")).toBe(true);
    expect(server.rows.has("good")).toBe(true);
    server.calls = [];
    const second = await a.sync();
    expect(server.calls).toEqual(["changes"]);
    expect(second.unsynced.has("bad")).toBe(true);
    a.edit("bad", { title: "Fixed" });
    const third = await a.sync();
    expect(third.ok).toBe(true);
    expect(server.rows.get("bad")?.data?.title).toBe("Fixed");
  });

  test("a write that got its time before an earlier one was saved is still read", async () => {
    const { server, a, b } = pair();
    a.put(post("p1"));
    await a.sync();
    await b.sync();
    // Saved with a time a minute before B's newest change, as a write that got its time before an earlier one was saved.
    expect(OVERLAP_MS).toBeGreaterThan(60_000);
    const row = server.rows.get("p1")!;
    server.rows.set("p1", { ...row, version: row.version + 1, data: { ...row.data!, title: "Late" }, updated_at: new Date(Date.parse(b.cursor!) - 60_000).toISOString() });
    await b.sync();
    expect(b.events.get("p1")?.title).toBe("Late");
  });

  test("a deletion marker gone from the server forgets the post here, or makes it again when it was changed", async () => {
    const { server, a, b } = pair();
    a.put(post("gone"));
    a.put(post("edited"));
    await a.sync();
    await b.sync();
    a.events.delete("gone");
    a.events.delete("edited");
    await a.sync();
    // Both markers pruned while B was away; B changed one meanwhile.
    server.rows.delete("gone");
    server.rows.delete("edited");
    b.events.delete("gone");
    b.edit("edited", { title: "Changed while away" });
    await b.settle();
    expect(b.bases.has("gone")).toBe(false);
    expect(server.rows.get("edited")?.data?.title).toBe("Changed while away");
  });
});

describe("the first run after posts moved", () => {
  test("posts unchanged here since the old account copy take the server's; changed ones are sent; new ones go up", async () => {
    const server = new Server();
    const old = [post("same"), post("changed"), post("edited-elsewhere")];
    for (const event of old) server.write(event.id, { ...(event as unknown as PostData) });
    // Since the copy, another device edited one on the new site.
    server.edit("edited-elsewhere", (data) => ({ ...data, title: "Newer on the server" }));
    const device = new Device(server);
    for (const event of old) device.put(event);
    device.known = Object.fromEntries(old.map((event) => [event.id, stable(event)]));
    device.edit("changed", { title: "Changed here before the move" });
    device.put(post("new"));
    const result = await device.settle();
    expect(result.ok).toBe(true);
    expect(device.events.get("edited-elsewhere")?.title).toBe("Newer on the server");
    expect(server.rows.get("changed")?.data?.title).toBe("Changed here before the move");
    expect(server.rows.get("new")?.data?.title).toBe("new");
    expect(onServer(server)).toEqual(posts(device));
  });

  test("a post the new site changed since the move keeps that change, whatever this browser's old copy says", async () => {
    const server = new Server();
    server.write("p1", { ...(post("p1") as unknown as PostData) });
    server.edit("p1", (data) => ({ ...data, title: "Edited on the new site" }));
    const device = new Device(server);
    // This browser's copy only shows a newer delivery state than the old fingerprint had, so it reads as changed here.
    device.put(post("p1", { deliveries: { x: { state: "sent", attempts: 1, at: "2026-10-26T09:00:00Z" } } }));
    device.known = { p1: stable(post("p1")) };
    await device.settle();
    expect(server.rows.get("p1")?.data?.title).toBe("Edited on the new site");
    expect(device.events.get("p1")?.title).toBe("Edited on the new site");
    expect(device.events.get("p1")?.deliveries).toBeDefined();
  });

  test("with no old fingerprints, a post that differs here is kept as here, not lost", async () => {
    const server = new Server();
    server.write("p1", { ...(post("p1") as unknown as PostData) });
    const device = new Device(server);
    device.put(post("p1", { title: "Only here" }));
    await device.settle();
    expect(server.rows.get("p1")?.data?.title).toBe("Only here");
  });
});

describe("many devices at random", () => {
  test("whatever is done in whatever order, every device ends with the server's posts", async () => {
    for (let seed = 1; seed <= 300; seed++) {
      let random = seed * 48271;
      const next = () => ((random = (random * 16807) % 2147483647) / 2147483647);
      const server = new Server();
      const devices = [new Device(server), new Device(server), new Device(server)];
      let made = 0;
      const deletedSomewhere = new Set<string>();
      for (let step = 0; step < 40; step++) {
        const device = devices[Math.floor(next() * devices.length)]!;
        const ids = [...device.events.keys()];
        const roll = next();
        if (roll < 0.25 || !ids.length) device.put(post(`p${made++}`, { title: `made ${seed}.${step}` }));
        else if (roll < 0.55) device.edit(ids[Math.floor(next() * ids.length)]!, { title: `title ${step}` });
        else if (roll < 0.7) device.edit(ids[Math.floor(next() * ids.length)]!, { description: `words ${step}` });
        else if (roll < 0.8) {
          const id = ids[Math.floor(next() * ids.length)]!;
          device.events.delete(id);
          deletedSomewhere.add(id);
        }
        else if (roll < 0.85) device.meanwhile = () => device.events.size && device.edit([...device.events.keys()][0]!, { link: `https://e.test/${step}` });
        else await device.sync();
      }
      for (let round = 0; round < 4; round++) for (const device of devices) await device.settle();
      for (const device of devices) {
        expect(posts(device), `seed ${seed}`).toEqual(onServer(server));
        expect(device.cursor).not.toBeNull();
      }
      // Nothing is gone that no device deleted, and nothing made anywhere is lost.
      for (let id = 0; id < made; id++) {
        if (!deletedSomewhere.has(`p${id}`)) expect(server.rows.get(`p${id}`)?.data, `seed ${seed}: p${id}`).toBeTruthy();
      }
      for (const row of server.rows.values()) if (!row.data) expect(deletedSomewhere.has(row.id), `seed ${seed}: ${row.id}`).toBe(true);
    }
  });
});
