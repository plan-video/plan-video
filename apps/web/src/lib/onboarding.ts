/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { supabase } from "@/lib/supabase";

export const ONBOARDING_STEPS = ["workspace", "look", "rail", "accounts", "times", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

type Person = { id: string; created_at?: string; user_metadata?: Record<string, unknown> };

/** Accounts older than the guide were set up without it. */
const GUIDE_SINCE = Date.parse("2026-11-05T00:00:00Z");

/** In the tab, because connecting an account leaves for the network's page and comes back. */
const stepKey = (userId: string) => `plan.onboarding-step.${userId}`;
/** Keeps it closed on this device when the account couldn't be reached to say so. */
const doneKey = (userId: string) => `plan.onboarded.${userId}`;

const [revision, setRevision] = createSignal(0);

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be off (private windows); the guide then lasts the visit.
  }
  setRevision((count) => count + 1);
}

const isStep = (value: string | null): value is OnboardingStep => ONBOARDING_STEPS.includes(value as OnboardingStep);

/** The step this tab is on, once the guide has been opened or moved past its first. */
export function onboardingStep(userId: string): OnboardingStep | null {
  revision();
  const step = read(sessionStorage, stepKey(userId));
  return isStep(step) ? step : null;
}

export function setOnboardingStep(userId: string, step: OnboardingStep) {
  write(sessionStorage, stepKey(userId), step);
}

export function reopenOnboarding(userId: string) {
  setOnboardingStep(userId, ONBOARDING_STEPS[0]);
}

/** A new account that hasn't finished or skipped the guide, here or on another device. */
export function onboardingDue(person: Person): boolean {
  revision();
  const created = Date.parse(person.created_at ?? "");
  if (!(created >= GUIDE_SINCE)) return false;
  return !person.user_metadata?.onboarded_at && !read(localStorage, doneKey(person.id));
}

export function finishOnboarding(userId: string) {
  write(localStorage, doneKey(userId), "1");
  write(sessionStorage, stepKey(userId), null);
  void supabase?.auth
    .updateUser({ data: { onboarded_at: new Date().toISOString() } })
    .then(({ error }) => {
      if (error) console.error("[onboarding] Could not save that the guide is done", error);
    })
    .catch((error: unknown) => console.error("[onboarding] Could not save that the guide is done", error));
}
