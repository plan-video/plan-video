/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const DOCS_URL = "/docs";

export const FAQ_URL = `${DOCS_URL}/faq`;

export const FEATURES_PATH = "/features";

export const featurePath = (slug: string) => `${FEATURES_PATH}/${slug}`;

/** Kept here so the footer links them without loading their words. */
export const ALTERNATIVES_URL = "/alternatives";
export const CHARACTER_LIMITS_URL = "/character-limits";

export const TOOLS_URL = "/tools";

export const AGENTS_URL = "/agents";

export const ROADMAP_URL = "/roadmap";

export const CHANGELOG_URL = "/changelog";

export const SUPPORT_URL = "/support";

export const REPO_URL = "https://github.com/plan-video/plan-video";

/**
 * Until true, builds say nothing about the code being open, so the live site never links a page GitHub hides.
 * The dev server shows it all.
 */
export const REPO_PUBLIC = true;
