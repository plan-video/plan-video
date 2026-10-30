/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { onMount } from "solid-js";
import { useLocation } from "@solidjs/router";

import { DASHBOARD_PATH, appRoute } from "@/hooks/use-project-route";
import { site } from "@/lib/site";
import { t } from "@/lib/i18n";

const RELOADED_KEY = "route-error.reloaded";

let reloading = false;

/** Errors after this are the old page going away. */
export function isReloadingAfterModuleError() {
  return reloading;
}

/** The browser's wording when a page's code could not be fetched (Chrome, Safari, Firefox). */
export function isModuleLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
}

/**
 * Browsers remember a failed module fetch for the page's life, so one hiccup (a
 * deploy replacing files) breaks it until a reload. Reload once; a second failure is shown.
 */
export function reloadOnceAfterModuleError(target?: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY)) return false;
    sessionStorage.setItem(RELOADED_KEY, "1");
  } catch {
    return false;
  }
  reloading = true;
  const here = window.desktop ? window.location.hash.replace(/^#/, "") : window.location.pathname + window.location.search;
  if (!target || target === here) {
    window.location.reload();
  } else if (window.desktop) {
    window.location.hash = target;
    window.location.reload();
  } else {
    window.location.assign(target);
  }
  return true;
}

export function clearModuleReloadMark() {
  try {
    sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // Storage can be off; there is nothing to clear then.
  }
}

export function RouteError(props: { error: unknown; reset(): void }) {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error));
  // Where the user was going. A failed page load can happen before the address
  // bar changes, so the router's location is the one to reload at.
  const location = useLocation();

  onMount(() => {
    site?.removeHeroShell();
    console.error("[app] page failed to render", props.error);
    if (isModuleLoadError(props.error)) reloadOnceAfterModuleError(location.pathname + location.search);
  });

  const backToDashboard = () => {
    // A full load: whatever broke may still hold state the router would keep.
    window.location.assign(window.desktop ? `#${DASHBOARD_PATH}` : appRoute());
    if (window.desktop) window.location.reload();
  };

  return (
    <div class="grid h-screen place-items-center bg-background px-6 text-foreground">
      <div class="flex w-full max-w-md flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <h1 class="text-sm font-450">{t("This page couldn't open")}</h1>
          <p class="text-xs text-muted-foreground">{t("Something went wrong while it loaded. Reloading usually fixes it.")}</p>
        </div>
        <pre class="max-h-40 overflow-auto rounded-md border border-border-strong bg-input px-3 py-2 font-mono text-xxs whitespace-pre-wrap text-muted-foreground select-text">
          {message()}
        </pre>
        <div class="flex gap-2">
          <button
            type="button"
            class="h-7 rounded-md bg-primary px-3 text-xs font-450 text-primary-foreground transition-colors hover:bg-primary-hover focus-ring"
            onClick={() => window.location.reload()}
          >
            {t("Reload")}
          </button>
          <button
            type="button"
            class="h-7 rounded-md bg-secondary px-3 text-xs font-450 text-foreground transition-colors hover:bg-secondary-hover focus-ring"
            onClick={backToDashboard}
          >
            {t("Back to dashboard")}
          </button>
        </div>
      </div>
    </div>
  );
}
