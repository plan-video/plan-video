/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Loads only after consent and only on plan.video, so desktop, dev and preview deploys stay out of the property.

import { createSignal } from "solid-js";

import { startPostHog, stopPostHog } from "@/lib/posthog";

const MEASUREMENT_ID = "G-XPNDEG9C3Q";
const CONSENT_KEY = "plan.video.analytics-consent";
const HOSTS = new Set(["plan.video", "www.plan.video"]);

export type AnalyticsConsent = "granted" | "denied";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

function readConsent(): AnalyticsConsent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

const [consent, setConsent] = createSignal<AnalyticsConsent | null>(readConsent());

export { consent as analyticsConsent };

export function googleAnalyticsEnabled(): boolean {
  return !window.desktop && HOSTS.has(location.hostname);
}

function gtag(...args: unknown[]) {
  window.dataLayer?.push(args);
}

function loadGoogleAnalytics() {
  if (!googleAnalyticsEnabled() || document.getElementById("ga-gtag")) {
    window.gtag?.("consent", "update", { analytics_storage: "granted" });
    return;
  }

  window.dataLayer = [];
  window.gtag = gtag;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted",
  });
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, {
    send_page_view: true,
    cookie_domain: "plan.video",
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement("script");
  script.id = "ga-gtag";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

export function chooseAnalyticsConsent(value: AnalyticsConsent) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Private mode can refuse storage. The choice still applies to this visit.
  }
  setConsent(value);
  if (value === "granted") {
    loadGoogleAnalytics();
    startPostHog();
  } else {
    window.gtag?.("consent", "update", { analytics_storage: "denied" });
    stopPostHog();
  }
}

export function resetAnalyticsConsent() {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // The notice can still return for this visit.
  }
  setConsent(null);
}

export function initGoogleAnalytics() {
  if (consent() === "granted") {
    loadGoogleAnalytics();
    startPostHog();
  }
}
