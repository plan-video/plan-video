/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Nothing in guest mode goes out: scheduling, posting, connecting, sharing and captions ask for an account,
// and nothing carries into one.

import { createSignal } from "solid-js";

import { track } from "@/lib/analytics";

const KEY = "plan.video.guest";

export type GuestRecord = {
  id: string;
  startedAt: string;
  /** So starting the demo over can erase them. */
  projects?: string[];
  /** Also the day and language it was made in: one from another day or language starts over. */
  demo?: string;
};

/** Another tab may have just started the demo over. */
export function readGuest(): GuestRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<GuestRecord>) : null;
    if (!parsed || typeof parsed.id !== "string" || !parsed.id.startsWith("guest-")) return null;
    return {
      id: parsed.id,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      projects: Array.isArray(parsed.projects) ? parsed.projects.filter((id): id is string => typeof id === "string") : [],
      ...(typeof parsed.demo === "string" ? { demo: parsed.demo } : {}),
    };
  } catch {
    return null;
  }
}

const [record, setRecord] = createSignal<GuestRecord | null>(readGuest());

export function saveGuest(next: GuestRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked, as in some private windows: guest mode lasts as long as this tab.
  }
  setRecord(next);
}

window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) setRecord(readGuest());
});

export function guestId(): string | null {
  return record()?.id ?? null;
}

const [signedInId, setSignedInId] = createSignal<string | undefined>(undefined);

export function noteSignedIn(userId: string | undefined) {
  setSignedInId(userId);
}

export const signedInUserId = signedInId;

export function inGuestMode() {
  return !signedInId() && guestId() !== null;
}

/** Stores kept per person take this, so a page asking for the signed-in person's shows a guest the demo's. */
export function ownerOf(userId: string | undefined): string | undefined {
  return userId ?? (inGuestMode() ? (guestId() ?? undefined) : undefined);
}

/** Those stay in the demo, out of any account. */
export function isGuestProject(id: string) {
  return !!record()?.projects?.includes(id);
}

export function addGuestProject(id: string) {
  const current = readGuest() ?? record();
  if (!current || current.projects?.includes(id)) return;
  saveGuest({ ...current, projects: [...(current.projects ?? []), id] });
}

/** The dialog's words follow it. */
export type AccountReason = "schedule" | "post" | "connect" | "share" | "captions" | "agent" | "account";

export type AccountAsk = {
  reason: AccountReason;
  /** As in `SOCIAL_PLATFORMS`. */
  platform?: string;
};

const [ask, setAsk] = createSignal<AccountAsk | null>(null);

/** The dashboard draws it as a dialog. */
export const accountAsk = ask;

export function askForAccount(next: AccountAsk) {
  setAsk(next);
  track("guest_account_asked", { reason: next.reason });
}

export function closeAccountAsk() {
  setAsk(null);
}
