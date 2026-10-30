/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Where Docs goes, from the site's nav and the dashboard's help menu (pages/docs.tsx). */
export const DOCS_URL = "/docs";

/** The docs' FAQ, every question in full; the homepage asks only the first few (site-faq.tsx). */
export const FAQ_URL = `${DOCS_URL}/faq`;

/** The feature pages, one per feature at /features/<slug> (lib/feature-pages.ts). */
export const FEATURES_PATH = "/features";

/** A feature's own page. */
export const featurePath = (slug: string) => `${FEATURES_PATH}/${slug}`;

/** The comparison pages' hub and the character limits page, kept here so the footer links them without loading their words. */
export const ALTERNATIVES_URL = "/alternatives";
export const CHARACTER_LIMITS_URL = "/character-limits";

/** The free tools' hub; each tool is at /tools/<slug> (lib/tool-pages.ts). */
export const TOOLS_URL = "/tools";

/** The AI agents' pages, one per agent at /agents/<slug> (lib/agent-pages.ts), and the page that lists them. */
export const AGENTS_URL = "/agents";

/** The roadmap: what's being built, what's next and what has shipped (lib/roadmap.ts). */
export const ROADMAP_URL = "/roadmap";

/** What's new: every update to plan.video (lib/changelog.ts). */
export const CHANGELOG_URL = "/changelog";

/** The support form: a bug, a feature request or a question, emailed to the founder (pages/support.tsx). */
export const SUPPORT_URL = "/support";

/** plan.video's code on GitHub. */
export const REPO_URL = "https://github.com/plan-video/plan-video";

/**
 * Whether the repository is public yet. Until it is, a build says nothing
 * about the code being open (the homepage's open-source section, its question
 * and hero line, the search title and markup, the docs' Developers tab), so the
 * live site never points at a page GitHub hides; the dev server shows it all.
 * Turn it on the day the repository goes public.
 */
export const REPO_PUBLIC = false;
