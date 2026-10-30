/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pure, so the merge rules can be tested. Per post, against the last agreed `Base`: one side changed → that
// side wins; both → merged per field, this side winning shared fields; delete vs change → change wins.
// Delivery state (the publisher's) and the thumbnail (post_thumbnails) are never sent as the post.

import type { AccountMedia } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";

/** `data` is null once it's deleted. */
export type PostRow = {
  id: string;
  version: number;
  data: PostData | null;
  deleted_at: string | null;
  updated_at: string;
  thumbnail_at: string | null;
};

/** Without what only shows here, with the details of its files. */
export type PostData = Record<string, unknown> & { id: string; media?: AccountMedia[] };

/** `data` null: deleted. */
export type Base = {
  version: number;
  data: PostData | null;
  /** The thumbnail's server time when last had here, and its fingerprint as last sent or read. */
  thumbnailAt: string | null;
  thumbnail: string | null;
  /** Not sent again until it changes. */
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
  /** Returns the posts changed here meanwhile, which were kept as they are. */
  writeLocal(events: StoredEvent[], media: AccountMedia[], read: Read): Promise<Set<string>>;
  /**
   * Kept in the same database as the posts: if it's cleared, both go, so everything is read again
   * rather than missing posts reading as deleted.
   */
  readState(): Promise<{ cursor: string | null; bases: Map<string, Base> }>;
  /** `bases` maps a post to its new base, or to null to forget it. */
  writeState(cursor: string | null, bases: Map<string, Base | null>): Promise<void>;
  /** Oldest change first. */
  fetchRows(since: string | null): Promise<PostRow[]>;
  fetchRow(id: string): Promise<PostRow | null>;
  insert(id: string, data: PostData): Promise<Sent>;
  update(id: string, version: number, values: { data: PostData } | { deleted: true }): Promise<Sent>;
  fetchThumbnails(ids: string[]): Promise<Map<string, string>>;
  /** Returns its new time on the server, or "gone" when its post is. */
  saveThumbnail(id: string, thumbnail: string | null): Promise<string | null | "gone">;
  /** For a first run with nothing agreed yet. */
  legacyKnown(): Promise<Record<string, string> | null>;
  legacyFingerprint(event: StoredEvent): string;
  filesOf(event: StoredEvent): string[];
}

export type SyncResult = {
  /** Except the ones the server turned down (`refused`). */
  ok: boolean;
  unsynced: Set<string>;
  refused: Map<string, string>;
  /** Something changed meanwhile. */
  again: boolean;
  /** With the time of the change it made, so its echo isn't read again. */
  wrote: Map<string, string>;
};

/** Re-read, for a write that got its time before an earlier one was saved. */
export const OVERLAP_MS = 2 * 60_000;
/** After this many re-merges while the server keeps moving, the post is left for the next run. */
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

/** What only shows here comes from this browser's copy. */
export function inbound(data: PostData, here: StoredEvent | undefined, thumbnail?: string | null): StoredEvent {
  const { media: _media, ...rest } = data;
  const event = rest as unknown as StoredEvent;
  const shownHere: Partial<StoredEvent> = {};
  if (here?.deliveries) shownHere.deliveries = here.deliveries;
  const picture = thumbnail === undefined ? here?.thumbnail : (thumbnail ?? undefined);
  if (picture) shownHere.thumbnail = picture;
  return { ...event, ...shownHere };
}

/** A field both sides changed takes this side's. */
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
  /** Posts sent as this browser had them, not merged. */
  const sentAsRead = new Set<string>();
  let changedHere = false;

  const baseFor = (id: string) => (changes.has(id) ? (changes.get(id) ?? undefined) : bases.get(id));

  const keep = (id: string, data: PostData) => {
    const before = next.get(id);
    next.set(id, inbound(data, before));
    for (const item of data.media ?? []) nextMedia.set(item.id, item);
    if (stable(next.get(id)) !== stable(before ?? null)) changedHere = true;
  };

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
        // Written here too when it differs, so the next run doesn't send it again.
        if (ours && answer.ok.data && stable(ours) !== stable(answer.ok.data)) keep(id, answer.ok.data);
        return;
      }
      if ("refused" in answer) {
        refused.set(id, answer.refused);
        unsynced.add(id);
        if (sentMark) changes.set(id, { ...(previous ?? { version: against ?? 0, data: null, thumbnailAt: null, thumbnail: null }), refused: { mark: sentMark, reason: answer.refused } });
        return;
      }
      const row = await io.fetchRow(id);
      if (!row) {
        if ("exists" in answer) {
          // There but unreadable: for a post this browser had, the workspace can't be reached now (team paused or
          // left), retried later; otherwise the id belongs to another of the owner's workspaces.
          if (previous) throw Object.assign(new Error("This workspace's posts can't be reached right now."), { unreachable: true });
          const reason = "This post's id is used by another workspace.";
          refused.set(id, reason);
          unsynced.add(id);
          if (sentMark) changes.set(id, { ...(previous ?? { version: 0, data: null, thumbnailAt: null, thumbnail: null }), refused: { mark: sentMark, reason } });
          return;
        }
        // Not on the server at all (a deletion marker past its time): made again when it's here, forgotten when not.
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

  const decide = (id: string, row: PostRow, base: Base | null): Outcome => {
    const here = next.get(id);
    const ours = here ? outbound(here, nextMedia, io.filesOf) : null;
    if (mark(ours) === mark(row.data)) return { kind: "agree" };
    if (!base) {
      if (!here) return { kind: "take" };
      // Nothing agreed yet: a post past version 1 changed on the server after anything here, so the server's wins.
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
    // Sent as read: the next run sends the later change over it. Otherwise keep the old base, so the next
    // run merges against the server's again rather than reading its fields as changed here.
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

export function changedSince(events: readonly StoredEvent[], media: readonly AccountMedia[], bases: ReadonlyMap<string, Base>, filesOf: (event: StoredEvent) => string[]): Set<string> {
  const byId = new Map(media.map((item) => [item.id, item]));
  return new Set(events.filter((event) => mark(outbound(event, byId, filesOf)) !== mark(bases.get(event.id)?.data ?? null)).map((event) => event.id));
}
