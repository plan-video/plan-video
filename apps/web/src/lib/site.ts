/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The site lives in apps/web/site/, a repository of its own; without it `/` opens the dashboard.
// Nothing in src/ imports the site's files: they reach the app only through this one entry (site/src/index.tsx).

import type { Component } from "solid-js";

export type Site = {
  SiteRoutes: Component;
  HomePage: Component;
  /** Seen by a signed-in person not let in yet, in place of the app. */
  WaitlistedPage: Component;
  /** Loads with the sign-in. */
  LoginPanel: Component & { preload: () => Promise<unknown> };
  SiteScrollbar: Component;
  /** Once the page the HTML drew a hero for won't show. */
  removeHeroShell: (unless?: string) => void;
  /** For the dot on the dashboard's help menu. */
  newestChangelog: () => Promise<string | undefined>;
};

const found = import.meta.glob<Site>("../../site/src/index.tsx", { eager: true });

/** Undefined when the app is built without it. */
export const site: Site | undefined = Object.values(found)[0];
