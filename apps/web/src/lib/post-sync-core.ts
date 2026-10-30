/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The rules by which one workspace's posts in this browser and in the posts
// table (supabase/migrations/20261026090000_posts.sql) come into step: what
// is read, what is sent, and how two copies changed apart are merged. Pure:
// lib/post-sync.ts gives it this browser's posts, the server and the kept
// state through `SyncIO`, so the rules can be tested without either.
//
// Each post is sent and read on its own. What this browser and the server
// last agreed on (a post's `Base`) is kept for every post, so:
//
//   - only this side changed it: it's sent, over the version agreed on;
//   - only the other side did: theirs is taken;
//   - both did: the post is merged field by field, this side's change
//     winning a field both changed, and sent over the server's version;
//   - deleted on one side and changed on the other: the change wins;
//   - the server moved on while sending: it's read again and merged again.
//
// What only shows here, a post's delivery state and its thumbnail, is never
// sent as the post: delivery state is the publisher's (post_deliveries), and
// the thumbnail goes to post_thumbnails on its own.

import type { AccountMedia } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";

/** A post as the posts table has it. `data` is null once it's deleted. */
export type PostRow = {
  id: string;
  version: number;
  data: PostData | null;
  deleted_at: string | null;
  updated_at: string;
  thumbnail_at: string | null;
};

/** A post as it's sent: the calendar's, without what only shows here, with the details of its files. */
export type PostData = Record<string, unknown> & { id: string; media?: AccountMedia[] };

/** What this browser and the server last agreed a post was. `data` null: deleted. */
export type Base = {
  version: number;
  data: PostData | null;
  /** The thumbnail's time on the server when this browser last had it, and its fingerprint as last sent or read. */
  thumbnailAt: string | null;
  thumbnail: string | null;
  /** This post as the server last turned it down, and why: not sent again until it changes. */
  refused?: { mark: string; reason: string };
};

export type Snapshot<Read = unknown> = {
  events: StoredEvent[];
  media: AccountMedia[];
  /** As the store read them, so a write back leaves what changed here meanwhile (see writeWorkspacePosts). */
  read: Read;
};

export type Sent = { ok: PostRow } | { moved: true } | { exists: true } | { refused: string };

export interface SyncIO<Read = unknown> {
  readLocal(): Promise<Snapshot<Read>>;
  /** Writes the posts and file details given over this browser's. Returns the posts changed here meanwhile, which were kept as they are. */
  writeLocal(events: StoredEvent[], media: AccountMedia[], read: Read): Promise<Set<string>>;
  /**
   * What this browser last agreed with the server, kept in the same database
   * as its posts: a database cleared or made again loses both, so it reads
   * everything again, rather than reading its missing posts as deleted.
   */
  readState(): Promise<{ cursor: string | null; bases: Map<string, Base> }>;
  /** `bases` maps a post to its new base, or to null to forget it. */
  writeState(cursor: string | null, bases: Map<string, Base | null>): Promise<void>;
  /** Every post (since null), or the ones changed since `since`, oldest change first. */
  fetchRows(since: string | null): Promise<PostRow[]>;
  fetchRow(id: string): Promise<PostRow | null>;
  insert(id: string, data: PostData): Promise<Sent>;
  update(id: string, version: number, values: { data: PostData } | { deleted: true }): Promise<Sent>;
  fetchThumbnails(ids: string[]): Promise<Map<string, string>>;
  /** Saves (or deletes, with null) a post's thumbnail. Returns its new time on the server, or "gone" when its post is. */
  saveThumbnail(id: string, thumbnail: string | null): Promise<string | null | "gone">;
  /** Fingerprints of the posts as the old sync last agreed on them, for a first run with nothing agreed yet. */
  legacyKnown(): Promise<Record<string, string> | null>;
  legacyFingerprint(event: StoredEvent): string;
  /** Every file a post lists (everyFileOf). */
  filesOf(event: StoredEvent): string[];
}

export type SyncResult = {
  /** Whether both sides agree on every post afterwards, but the ones the server turned down (`refused`). */
  ok: boolean;
  /** Posts changed here that the server doesn't have. */
  unsynced: Set<string>;
  /** Posts the server turned down, and why. */
  refused: Map<string, string>;
  /** Asked to run again: something changed meanwhile. */
  again: boolean;
  /** Each post written to the server here, with the time of the change it made, so its echo isn't read again. */
  wrote: Map<string, string>;
};

/** Changes this much older than the newest one seen are read again, for a write that got its time before an earlier one was saved. */
export const OVERLAP_MS = 2 * 60_000;
/** A post read and merged again this many times while the server keeps moving on is left for the next run. */
const TRIES = 3;

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const mark = (data: PostData | null) => (data ? stable(data) : null);

/** A post as it's sent: without its delivery state and thumbnail, with the details of the files it lists that this browser has. */
export function outbound(event: StoredEvent, media: ReadonlyMap<string, AccountMedia>, filesOf: (event: StoredEvent) => string[]): PostData {
  const { deliveries: _deliveries, thumbnail: _thumbnail, ...rest } = event;
  const files = filesOf(event)
    .map((id) => media.get(id))
    .filter((item): item is AccountMedia => !!item)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const data = JSON.parse(JSON.stringify(rest)) as PostData;
  delete data.media;
  if (files.length) data.media = files;
  return data;
}

/** A post read from the server, as the calendar keeps it: what only shows here comes from this browser's copy. */
export function inbound(data: PostData, here: StoredEvent | undefined, thumbnail?: string | null): StoredEvent {
  const { media: _media, ...rest } = data;
  const event = rest as unknown as StoredEvent;
  const shownHere: Partial<StoredEvent> = {};
  if (here?.deliveries) shownHere.deliveries = here.deliveries;
  const picture = thumbnail === undefined ? here?.thumbnail : (thumbnail ?? undefined);
  if (picture) shownHere.thumbnail = picture;
  return { ...event, ...shownHere };
}

/**
 * A post both sides changed since `base`, field by field: a field only one
 * side changed takes that side's, one both changed takes this side's.
 */
export function merge(base: PostData, here: PostData, there: PostData): PostData {
  const keys = new Set([...Object.keys(base), ...Object.keys(here), ...Object.keys(there)]);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = stable(here[key]) === stable(base[key]) ? there[key] : here[key];
    if (value !== undefined) out[key] = value;
  }
  return out as PostData;
}

const baseOf = (row: PostRow, previous?: Base): Base => ({
  version: row.version,
  data: row.data,
  thumbnailAt: previous?.thumbnailAt ?? null,
  thumbnail: previous?.thumbnail ?? null,
});

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** One run for one workspace. */
export async function syncPosts<Read>(io: SyncIO<Read>): Promise<SyncResult> {
  const state = await io.readState();
  const snapshot = await io.readLocal();
  const bases = state.bases;
  const cursor = state.cursor;
  const rows = await io.fetchRows(cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null);
  // Read in order of change, so the newest of a post read twice is the one kept.
  const remote = new Map(rows.map((row) => [row.id, row]));
  let seenUntil = rows.reduce<string | null>((newest, row) => later(newest, row.updated_at), cursor);
  // A first run with nothing agreed: the old account copy's fingerprints say which posts this browser changed since.
  const known = bases.size === 0 ? await io.legacyKnown() : null;

  const local = new Map(snapshot.events.map((event) => [event.id, event]));
  const media = new Map(snapshot.media.map((item) => [item.id, item]));
  const next = new Map(local);
  const nextMedia = new Map(media);
  const changes = new Map<string, Base | null>();
  const unsynced = new Set<string>();
  const refused = new Map<string, string>();
  const wrote = new Map<string, string>();
  const thumbnailsWanted = new Set<string>();
  /** Posts sent as this browser had them, not merged: what was sent is what this browser had when it read its posts. */
  const sentAsRead = new Set<string>();
  let changedHere = false;

  const baseFor = (id: string) => (changes.has(id) ? (changes.get(id) ?? undefined) : bases.get(id));

  /** Keeps a post as the server or a merge has it here, with the details of the files it lists. */
  const keep = (id: string, data: PostData) => {
    const before = next.get(id);
    next.set(id, inbound(data, before));
    for (const item of data.media ?? []) nextMedia.set(item.id, item);
    if (stable(next.get(id)) !== stable(before ?? null)) changedHere = true;
  };

  /** Takes the server's post here. */
  const take = (row: PostRow) => {
    const here = local.get(row.id);
    const previous = baseFor(row.id);
    if (row.data) keep(row.id, row.data);
    else {
      next.delete(row.id);
      if (here) changedHere = true;
    }
    changes.set(row.id, baseOf(row, previous));
  };

  /** Sends this side's post over `version` (or makes it), reading and merging again while the server moves on. */
  const send = async (id: string, data: PostData | null, version: number | null): Promise<void> => {
    let against = version;
    let ours = data;
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const previous = baseFor(id);
      const sentMark = mark(ours);
      if (previous?.refused && previous.refused.mark === sentMark) {
        refused.set(id, previous.refused.reason);
        unsynced.add(id);
        return;
      }
      if (against === null && !ours) {
        changes.set(id, null);
        return;
      }
      const answer = against === null ? await io.insert(id, ours!) : await io.update(id, against, ours ? { data: ours } : { deleted: true });
      if ("ok" in answer) {
        changes.set(id, baseOf(answer.ok, previous));
        wrote.set(id, answer.ok.updated_at);
        seenUntil = later(seenUntil, answer.ok.updated_at);
        // Kept as the server has it, which is what was sent: written here too when it differs, so the next run doesn't send it again.
        if (ours && answer.ok.data && stable(ours) !== stable(answer.ok.data)) keep(id, answer.ok.data);
        return;
      }
      if ("refused" in answer) {
        refused.set(id, answer.refused);
        unsynced.add(id);
        if (sentMark) changes.set(id, { ...(previous ?? { version: against ?? 0, data: null, thumbnailAt: null, thumbnail: null }), refused: { mark: sentMark, reason: answer.refused } });
        return;
      }
      // Moved on, or made meanwhile: read it and decide again.
      const row = await io.fetchRow(id);
      if (!row) {
        if ("exists" in answer) {
          // There, but not to be read here. A post this browser had: the workspace can't be reached now (a team paused,
          // or left), which is tried again later like any failed run. One it never had: its id is a post of another
          // workspace of the owner's, and one id is one post.
          if (previous) throw Object.assign(new Error("This workspace's posts can't be reached right now."), { unreachable: true });
          const reason = "This post's id is used by another workspace.";
          refused.set(id, reason);
          unsynced.add(id);
          if (sentMark) changes.set(id, { ...(previous ?? { version: 0, data: null, thumbnailAt: null, thumbnail: null }), refused: { mark: sentMark, reason } });
          return;
        }
        // Not on the server at all, as a deletion marker past its time: made again when it's here, forgotten when not.
        against = null;
        continue;
      }
      seenUntil = later(seenUntil, row.updated_at);
      const outcome = decide(id, row, previous ?? null);
      if (outcome.kind === "take") {
        take(row);
        return;
      }
      if (outcome.kind === "agree") {
        changes.set(id, baseOf(row, previous));
        return;
      }
      ours = outcome.data;
      against = row.version;
      if (ours) keep(id, ours);
    }
    unsynced.add(id);
  };

  type Outcome = { kind: "take" } | { kind: "agree" } | { kind: "send"; data: PostData | null };

  /** What to do with a post the server has changed since `base` (or that nothing was agreed on yet). */
  const decide = (id: string, row: PostRow, base: Base | null): Outcome => {
    const here = next.get(id);
    const ours = here ? outbound(here, nextMedia, io.filesOf) : null;
    if (mark(ours) === mark(row.data)) return { kind: "agree" };
    if (!base) {
      if (!here) return { kind: "take" };
      // Nothing agreed on yet, as on the first run after posts moved. A post past its first version was
      // changed on the server since (by the new site, or the publisher), after anything this browser holds:
      // the server's is the newer. Only one the server has as it was copied can take this browser's change.
      if (row.version > 1) return { kind: "take" };
      // Unchanged here since the old copy both had: the server's, or its delete, is the newer.
      const was = known?.[id];
      if (was !== undefined && io.legacyFingerprint(here) === was) return { kind: "take" };
      return { kind: "send", data: ours };
    }
    const changedHereSince = mark(ours) !== mark(base.data);
    if (!changedHereSince) return { kind: "take" };
    if (!row.data) return ours ? { kind: "send", data: ours } : { kind: "agree" };
    if (!ours) return { kind: "take" };
    return { kind: "send", data: base.data ? merge(base.data, ours, row.data) : ours };
  };

  const ids = new Set([...local.keys(), ...remote.keys(), ...bases.keys()]);
  for (const id of ids) {
    const here = local.get(id);
    const base = bases.get(id);
    const row = remote.get(id);
    // Its thumbnail moved on, with the post or alone: read once the posts are settled.
    if (row?.data && row.thumbnail_at && row.thumbnail_at !== base?.thumbnailAt) thumbnailsWanted.add(id);
    if (row && (!base || row.version !== base.version)) {
      const outcome = decide(id, row, base ?? null);
      if (outcome.kind === "take") take(row);
      else if (outcome.kind === "agree") changes.set(id, baseOf(row, base));
      else {
        if (outcome.data && here) {
          const merged = stable(inbound(outcome.data, here)) !== stable(here);
          keep(id, outcome.data);
          if (!merged) sentAsRead.add(id);
        }
        await send(id, outcome.data, row.version);
      }
      continue;
    }
    const ours = here ? outbound(here, media, io.filesOf) : null;
    if (base) {
      if (mark(ours) !== mark(base.data)) {
        sentAsRead.add(id);
        await send(id, ours, base.version);
      }
    } else if (ours) {
      sentAsRead.add(id);
      await send(id, ours, null);
    }
  }

  // Thumbnails: the server's newer ones read, this browser's changed ones sent.
  if (thumbnailsWanted.size) {
    const found = await io.fetchThumbnails([...thumbnailsWanted]);
    for (const id of thumbnailsWanted) {
      const event = next.get(id);
      const row = remote.get(id);
      const picture = found.get(id) ?? null;
      if (event && stable(event.thumbnail ?? null) !== stable(picture)) {
        next.set(id, picture ? { ...event, thumbnail: picture } : withoutThumbnail(event));
        changedHere = true;
      }
      const base = baseFor(id);
      if (base) changes.set(id, { ...base, thumbnailAt: row?.thumbnail_at ?? base.thumbnailAt, thumbnail: picture });
    }
  }
  for (const [id, event] of next) {
    const base = baseFor(id);
    if (!base || base.data === null || thumbnailsWanted.has(id)) continue;
    const picture = event.thumbnail ?? null;
    if (picture === base.thumbnail) continue;
    const at = await io.saveThumbnail(id, picture);
    if (at === "gone") continue;
    changes.set(id, { ...base, thumbnailAt: at ?? base.thumbnailAt, thumbnail: picture });
    if (at) {
      seenUntil = later(seenUntil, at);
      wrote.set(id, at);
    }
  }

  let again = false;
  if (changedHere) {
    const events = [...next.values()];
    const listed = new Set(events.flatMap((event) => io.filesOf(event)));
    const kept = await io.writeLocal(
      events,
      [...nextMedia.values()].filter((item) => listed.has(item.id)),
      snapshot.read,
    );
    // A post changed here meanwhile stays as it is. When this run sent it as this browser had it, the server
    // now has what was read, and the next run sends the change made since over that. Otherwise (taken from the
    // server, or merged with it) what was agreed on stays as before, and the next run merges against the
    // server's again, rather than reading the server's fields as changed here.
    for (const id of kept) if (!(sentAsRead.has(id) && wrote.has(id))) changes.set(id, bases.get(id) ?? null);
    again = kept.size > 0;
  }
  await io.writeState(seenUntil, changes);
  return { ok: [...unsynced].every((id) => refused.has(id)) && !again, unsynced, refused, again, wrote };
}

function withoutThumbnail(event: StoredEvent): StoredEvent {
  const { thumbnail: _thumbnail, ...rest } = event;
  return rest as StoredEvent;
}

/** The posts changed here that the server doesn't have, by what was last agreed: for showing while a run fails. */
export function changedSince(events: readonly StoredEvent[], media: readonly AccountMedia[], bases: ReadonlyMap<string, Base>, filesOf: (event: StoredEvent) => string[]): Set<string> {
  const byId = new Map(media.map((item) => [item.id, item]));
  return new Set(events.filter((event) => mark(outbound(event, byId, filesOf)) !== mark(bases.get(event.id)?.data ?? null)).map((event) => event.id));
}
