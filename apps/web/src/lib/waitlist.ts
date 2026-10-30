/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Before launch the site is a waitlist, and the app only opens for emails
// that have been let in. Who is in is decided by the database, in
// `supabase/migrations/20261001000000_waitlist.sql`.

import { msg } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

const flag = import.meta.env.VITE_INVITE_ONLY as string | undefined;

/** On in production builds unless `VITE_INVITE_ONLY=false`; off in development unless it is `true`. */
export const INVITE_ONLY = flag ? flag === "true" : import.meta.env.PROD;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isEmail = (value: string) => value.length <= 254 && EMAIL.test(value.trim());

/** Adds an email to the waitlist. Joining twice is not an error. Returns what went wrong, in English to show with t(), or null. */
export async function joinWaitlist(email: string, source: string): Promise<string | null> {
  if (!supabase) return msg("The waitlist isn't set up yet.");
  if (!isEmail(email)) return msg("That doesn't look like an email address.");
  const { error } = await supabase.rpc("join_waitlist", { address: email.trim(), origin: source });
  if (error) {
    console.error("[waitlist] join failed", error);
    return msg("Couldn't add you to the waitlist. Try again in a moment.");
  }
  return null;
}

/**
 * Whether this email has been let in. False means do not send a sign-in link:
 * the first link creates the account. Null means the check itself failed.
 */
export async function isInvited(email: string): Promise<boolean | null> {
  if (!INVITE_ONLY) return true;
  if (!supabase || !isEmail(email)) return false;
  const { data, error } = await supabase.rpc("is_invited", { address: email.trim() });
  if (error) {
    console.error("[waitlist] invite check failed", error);
    return null;
  }
  return data === true;
}

/** Whether the signed-in user has been let in. */
export async function checkAccess(): Promise<boolean> {
  if (!INVITE_ONLY) return true;
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_access");
  if (error) {
    console.error("[waitlist] access check failed", error);
    return false;
  }
  return data === true;
}
