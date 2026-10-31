/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * In the desktop app the Umami script is inert (its `data-domains` gate misses `file://`), so `track` hands events
 * to main. Pageviews are auto-tracked; call `track` only for custom events.
 */

import { capturePostHog, identifyPostHog, resetPostHog } from "@/lib/posthog";

type UmamiEventData = Record<string, string | number | boolean | undefined>;

type UmamiClient = {
  track: (event?: string | UmamiEventData, data?: UmamiEventData) => void;
  identify: (data: UmamiEventData) => void;
};

declare global {
  interface Window {
    umami?: UmamiClient;
  }
}

const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID ?? '';
const scriptUrl = import.meta.env.VITE_UMAMI_SCRIPT_URL ?? '';
const domains = import.meta.env.VITE_UMAMI_DOMAINS ?? '';

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  if (!websiteId || !scriptUrl) return;

  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src = scriptUrl;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-domains", domains);
  script.setAttribute("data-tag", "web-app-v1");
  script.setAttribute("data-performance", "true");
  document.head.appendChild(script);
}

/** Umami rejects payloads with `undefined` values. */
function clean(data?: UmamiEventData): UmamiEventData | undefined {
  if (!data) return undefined;
  const out: UmamiEventData = {};
  for (const k in data) {
    const v = data[k];
    if (v !== undefined) {
      out[k] = v
    };
  }
  return out;
}

export function track(event: string, data?: UmamiEventData): void {
  const payload = clean(data);
  if (payload) {
    window.umami?.track(event, payload);
  } else {
    window.umami?.track(event);
  }
  capturePostHog(event, payload);
}

export function identify(userId: string, traits?: UmamiEventData): void {
  const payload = clean(traits);
  window.umami?.identify({ id: userId, ...(payload ?? {}) });
  identifyPostHog(userId, payload);
}

export function resetIdentity(): void {
  window.umami?.identify({});
  resetPostHog();
}
