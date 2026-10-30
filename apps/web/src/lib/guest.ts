/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Guest mode, like Buffer's: a demo of the dashboard and editor, without an
// account, filled with sample posts, accounts and numbers (see
// lib/guest-demo.ts). It's kept in this browser under a guest id, the way a
// signed-in person's work is kept under their user id (see
// `workspaceDatabaseFor`), so the app works on it as it does for anyone.
// Nothing in it goes out: scheduling, posting, connecting, sharing and
// captions ask for an account instead, and nothing comes along into one.

import { createSignal } from "solid-js";

import { track } from "@/lib/analytics";

const KEY = "plan.video.guest";

export type GuestRecord = {
  id: string;
  startedAt: string;
  /** Projects made in guest mode, so starting the demo over can erase them. */
  projects?: string[];
  /** Which demo the guest's sample data is, and the day and language it was made in: a demo from another day or in another language starts over. */
  demo?: string;
};

/** The guest record as saved now. Another tab may have just started the demo over. */
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

/** Keeps the guest record, and makes it this tab's. */
export function saveGuest(next: GuestRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked, as in some private windows: guest mode lasts as long as this tab.
  }
  setRecord(next);
}

// Another tab started the demo, or started it over.
window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) setRecord(readGuest());
});

/** The id the guest's demo is kept under, while this browser has one. */
export function guestId(): string | null {
  return record()?.id ?? null;
}

const [signedInId, setSignedInId] = createSignal<string | undefined>(undefined);

/** The auth context says who is signed in, so code outside components can tell a guest apart. */
export function noteSignedIn(userId: string | undefined) {
  setSignedInId(userId);
}

/** The signed-in person's user id, for code outside components. */
export const signedInUserId = signedInId;

/** Signed out, in guest mode. The same as `useAuth().isGuest()`, for code outside components. */
export function inGuestMode() {
  return !signedInId() && guestId() !== null;
}

/**
 * Whose things a store reads: the signed-in person's, else the guest's in
 * guest mode. Stores kept per person take this, so a page that asks for the
 * signed-in person's shows a guest the demo's.
 */
export function ownerOf(userId: string | undefined): string | undefined {
  return userId ?? (inGuestMode() ? (guestId() ?? undefined) : undefined);
}

/** Whether a guest in this browser made the project. Those stay in the demo, out of any account. */
export function isGuestProject(id: string) {
  return !!record()?.projects?.includes(id);
}

/** Puts a project made in guest mode on the guest's list. */
export function addGuestProject(id: string) {
  const current = readGuest() ?? record();
  if (!current || current.projects?.includes(id)) return;
  saveGuest({ ...current, projects: [...(current.projects ?? []), id] });
}

// ---------------------------------------------------------------------------
// Asking for an account

/** What the guest was doing when asked. The dialog's words follow it. */
export type AccountReason = "schedule" | "post" | "connect" | "share" | "captions" | "agent" | "account";

export type AccountAsk = {
  reason: AccountReason;
  /** The network being connected, by its id, as in `SOCIAL_PLATFORMS`. */
  platform?: string;
};

const [ask, setAsk] = createSignal<AccountAsk | null>(null);

/** The open request for an account, if any. The dashboard draws it as a dialog. */
export const accountAsk = ask;

/** Asks the guest to create an account (or log in) to do this for real. */
export function askForAccount(next: AccountAsk) {
  setAsk(next);
  track("guest_account_asked", { reason: next.reason });
}

export function closeAccountAsk() {
  setAsk(null);
}
