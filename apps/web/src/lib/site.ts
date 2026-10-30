/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// plan.video's own website: the homepage, the feature pages, pricing, the
// docs pages and the rest, kept apart from the app in apps/web/site/, a
// repository of its own (its build plugins: site/vite.ts). The app takes it
// when it's there; without it (the open-source app on its own) there is no
// homepage, `/` opens the dashboard, and the sign-in is the form alone.
//
// Nothing in src/ imports the site's files; they reach the app only through
// this one entry (site/src/index.tsx).

import type { Component } from "solid-js";

export type Site = {
  /** The site's pages, as <Route>s for the app's router. */
  SiteRoutes: Component;
  /** The homepage, at `/`. */
  HomePage: Component;
  /** What a signed-in person who hasn't been let in yet sees in place of the app. */
  WaitlistedPage: Component;
  /** The sign-in page's right half, beside the form. Loads with the sign-in. */
  LoginPanel: Component & { preload: () => Promise<unknown> };
  /** The site's own scrollbar, over its pages. */
  SiteScrollbar: Component;
  /** Takes away the HTML's copy of the homepage's headline, once the homepage won't show. */
  removeHeroShell: () => void;
  /** The newest What's new entry's id, for the dot on the dashboard's help menu. */
  newestChangelog: () => Promise<string | undefined>;
};

const found = import.meta.glob<Site>("../../site/src/index.tsx", { eager: true });

/** The website, or nothing when the app is built without it. */
export const site: Site | undefined = Object.values(found)[0];
