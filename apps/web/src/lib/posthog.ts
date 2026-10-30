/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// PostHog product analytics for the public site. The library loads only after
// a visitor accepts, and only on plan.video. The project token is public by
// design. Session replay stays off.

import type { PostHog } from "posthog-js";

const PROJECT_TOKEN = "phc_AzigqMXbwUHXEYRR9KVeYkzt6nGXszSnUtVYAvBqTJUb";
const API_HOST = "https://eu.i.posthog.com";
const HOSTS = new Set(["plan.video", "www.plan.video"]);

type EventData = Record<string, string | number | boolean | undefined>;

let client: PostHog | null = null;
let starting: Promise<void> | null = null;
let allowed = false;

function enabled() {
  return !window.desktop && HOSTS.has(location.hostname);
}

/** Starts PostHog after the visitor accepts analytics. */
export function startPostHog() {
  if (!enabled()) return;
  allowed = true;
  if (client) {
    client.opt_in_capturing();
    return;
  }
  starting ??= (async () => {
    const { default: posthog } = await import("posthog-js");
    posthog.init(PROJECT_TOKEN, {
      api_host: API_HOST,
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      disable_session_recording: true,
    });
    client = posthog;
    if (!allowed) {
      posthog.opt_out_capturing();
      return;
    }
    const { supabase } = await import("@/lib/supabase");
    const user = supabase ? (await supabase.auth.getSession()).data.session?.user : null;
    if (user && allowed) posthog.identify(user.id);
  })();
}

/** Stops PostHog when the visitor rejects analytics. */
export function stopPostHog() {
  allowed = false;
  client?.opt_out_capturing();
}

export function capturePostHog(event: string, data?: EventData) {
  if (!client || !allowed) return;
  const properties: Record<string, string | number | boolean> = {};
  if (data) {
    for (const key in data) {
      const value = data[key];
      if (value !== undefined) properties[key] = value;
    }
  }
  client.capture(event, properties);
}

export function identifyPostHog(userId: string, traits?: EventData) {
  if (!client || !allowed) return;
  const properties: Record<string, string | number | boolean> = {};
  if (traits) {
    for (const key in traits) {
      const value = traits[key];
      if (value !== undefined) properties[key] = value;
    }
  }
  client.identify(userId, properties);
}

export function resetPostHog() {
  if (!client || !allowed) return;
  client.reset();
}
