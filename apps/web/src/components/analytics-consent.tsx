/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A } from "@solidjs/router";
import { Show } from "solid-js";

import { analyticsConsent, chooseAnalyticsConsent } from "@/lib/google-analytics";
import { rich, t } from "@/lib/i18n";
import { site } from "@/lib/site";

/** One style for both buttons, so neither is easier to pick. */
const choice =
  "h-9 cursor-pointer rounded-lg border border-white/10 bg-white/[0.03] text-[13px] font-450 text-white transition-colors hover:bg-white/[0.08]";

export function AnalyticsConsent() {
  return (
    <Show when={site && !window.desktop && analyticsConsent() === null}>
      <div
        role="region"
        aria-label={t("Analytics cookies")}
        class="fixed right-4 bottom-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-(--site-popover) p-4 text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)] max-sm:left-4 max-sm:w-auto"
      >
        <p class="text-[13px] leading-5 text-white/60">
          {rich(
            "May we use Google Analytics and PostHog to see how this site is used? They set cookies, and load only if you accept. <privacy>Privacy Policy</privacy>",
            {
              privacy: (text) => (
                <A href="/privacy" class="text-white underline decoration-white/60 underline-offset-2 hover:decoration-white">
                  {text}
                </A>
              ),
            },
          )}
        </p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button type="button" class={choice} onClick={() => chooseAnalyticsConsent("denied")}>
            {t("Decline")}
          </button>
          <button type="button" class={choice} onClick={() => chooseAnalyticsConsent("granted")}>
            {t("Accept")}
          </button>
        </div>
      </div>
    </Show>
  );
}
