/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useBeforeLeave, useIsRouting, useLocation } from "@solidjs/router";
import { Show, createEffect, onCleanup, onMount, untrack } from "solid-js";

import { useAuth } from "@/context/auth";
import { isEditorPath } from "@/hooks/use-project-route";
import { dashboardTheme } from "@/lib/dashboard-theme";

const html = document.documentElement;
/** Must match index.html's loop: the mark is drawn by 900ms and held to 1296ms of every 1.8s. */
const LOOP_MS = 1800;
const DRAWN_MS = 900;
const HELD_MS = 1296;
const SHOWN_MS = DRAWN_MS + 100;
const FADE_OUT_MS = 200;
/** Must match index.html's boot-in. */
const FADE_IN_MS = 150;

let holds = 0;
let leaving: number | undefined;
let fading: Animation | undefined;

function holdPageLoader(fadeIn = false): () => void {
  holds++;
  clearTimeout(leaving);
  if (fading) {
    fading.cancel();
    fading = undefined;
    window.bootMark?.hold(false);
  }
  const splash = document.getElementById("boot-splash");
  if (splash && !html.dataset.boot) {
    splash.toggleAttribute("data-fade-in", fadeIn);
    html.dataset.boot = dashboardTheme();
  }

  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--holds > 0) return;
    // Never leave partway through drawing the mark. Even leaving at once goes through
    // the timer, so a page can hand over to the next part of itself in the same moment.
    clearTimeout(leaving);
    leaving = window.setTimeout(hide, Math.max(0, SHOWN_MS - (drawing() % LOOP_MS)));
  };
}

/** Reads index.html's window.bootMark. */
function drawing(): number {
  return window.bootMark?.time() ?? SHOWN_MS;
}

function hide() {
  const splash = document.getElementById("boot-splash");
  if (holds > 0 || fading || !splash || !html.dataset.boot) return;
  // A whole mark stays whole while it fades, however late this runs.
  const at = drawing() % LOOP_MS;
  if (at >= DRAWN_MS && at < HELD_MS) window.bootMark?.hold(true);
  const opacity = Number(getComputedStyle(splash).opacity);
  fading = splash.animate([{ opacity }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: "ease-out", fill: "forwards" });
  fading.onfinish = () => {
    delete html.dataset.boot;
    fading?.cancel();
    fading = undefined;
  };
}

// index.html opens a dashboard on the loader; it stays until the app knows who is signed in (LoadingScreen).
let releaseBoot = html.dataset.boot ? holdPageLoader() : undefined;

/** Must pick the same pages as index.html. Signed out, /dashboard is the sign-in page. */
function opensDashboard(path: string, signedIn: boolean): boolean {
  if (window.desktop) return !isEditorPath(path);
  return /^\/try\/?$/.test(path) || (signedIn && /^\/(dashboard\/?)?$/.test(path));
}

export function PageLoader() {
  const location = useLocation();
  const auth = useAuth();
  return (
    <Show when={opensDashboard(location.pathname, auth.isAuthenticated())}>
      <Hold />
    </Show>
  );
}

function Hold() {
  onMount(() => onCleanup(holdPageLoader()));
  return null;
}

export function LoadingScreen() {
  const location = useLocation();
  const routing = useIsRouting();
  const auth = useAuth();
  let to = "";
  const headsIntoDashboard = () => {
    if (window.desktop) return false;
    const from = untrack(() => location.pathname);
    const signedIn = untrack(auth.isAuthenticated);
    return opensDashboard(to, signedIn) && !opensDashboard(from, signedIn) && !isEditorPath(from);
  };

  useBeforeLeave((event) => {
    to = typeof event.to === "string" ? event.to.replace(/[?#].*/, "") : "";
    if (event.defaultPrevented || html.dataset.boot || !headsIntoDashboard()) return;
    // Hold the old page until the loader covers it, so the dashboard doesn't show
    // through the loader as it fades in.
    event.preventDefault();
    const release = holdPageLoader(true);
    window.setTimeout(() => {
      event.retry();
      // By now the dashboard's own holds have taken over.
      window.setTimeout(release);
    }, FADE_IN_MS);
  });

  createEffect(() => {
    if (!routing() || !headsIntoDashboard()) return;
    onCleanup(holdPageLoader(true));
  });

  createEffect(() => {
    if (auth.isLoading()) return;
    releaseBoot?.();
    releaseBoot = undefined;
  });

  return null;
}
