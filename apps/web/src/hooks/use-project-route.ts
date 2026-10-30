/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLocation, useParams } from "@solidjs/router";
import { createMemo } from 'solid-js';

import { inGuestMode } from "@/lib/guest";

/** The dashboard, which opens on the calendar. On the website this is `/dashboard`; the desktop app also keeps it at `/`. */
export const DASHBOARD_PATH = "/dashboard";

/**
 * Guest mode's own place: the same dashboard and editor, without an account
 * (see lib/guest.ts). Apart from `/dashboard`, so signing up and logging in
 * work as they always have.
 */
export const TRY_PATH = "/try";

/**
 * Route for the editor with the project `id` loaded (see `/projects/*ref` in
 * app.tsx), under guest mode's own place for a guest. The id, not the folder
 * name: a project keeps it when it is renamed, so the link keeps working (and
 * so does the restored last route).
 */
export const projectRoute = (id: string): string => `${inGuestMode() ? TRY_PATH : ""}/projects/${encodeURIComponent(id)}`;

/** Whether `path` is the editor's, in an account or in guest mode. */
export const isEditorPath = (path: string): boolean => path.startsWith('/projects/') || path.startsWith(`${TRY_PATH}/projects/`);

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * Whether `path` is a post shared for feedback (pages/post-preview.tsx),
 * which is drawn in the dashboard's theme. index.html reads it the same way.
 */
export const isPostPreviewPath = (path: string): boolean => /^\/p\/[^/]+\/?$/.test(path);

/** Whether `path` is a client connect link (pages/connect.tsx), drawn in the dashboard's theme too. */
export const isConnectLinkPath = (path: string): boolean => /^\/connect\/[^/]+\/?$/.test(path);

/**
 * Whether `path` is one of the site's pages (the homepage, features, pricing,
 * log in and the rest) rather than the dashboard, the editor, a shared post
 * or a client connect link.
 * The desktop app opens straight into the dashboard, so it has none.
 */
export const isSitePath = (path: string): boolean =>
  !window.desktop && !isEditorPath(path) && !under(path, DASHBOARD_PATH) && !under(path, TRY_PATH) && !isPostPreviewPath(path) && !isConnectLinkPath(path);

/** The account's dashboard, at `view`. Links from the site go here, guest mode or not. */
export function dashboardRoute(view?: string): string {
  return dashboardAt(DASHBOARD_PATH, view);
}

/** The dashboard this person is using: guest mode's own place for a guest, else the account's. For links inside the app. */
export function appRoute(view?: string): string {
  return dashboardAt(inGuestMode() ? TRY_PATH : DASHBOARD_PATH, view);
}

function dashboardAt(path: string, view?: string): string {
  return view ? `${path}?dashboard=${encodeURIComponent(view)}` : path;
}

/** Route state of the editor: where leaving it goes back to. */
export type ProjectRouteState = { returnTo?: string };

/**
 * State for a navigation into the editor from the current page, so that
 * leaving the editor lands back here (the dashboard view it was opened from).
 */
export function useReturnHere() {
  const location = useLocation();
  return (): ProjectRouteState => ({ returnTo: location.pathname + location.search });
}

/**
 * The `/projects/*ref` segment: a project id, or a folder name for links made
 * before ids existed. `resolveProject` in @/projects decides which it is; the
 * editor then rewrites the URL to the id it finds.
 */
export function useProjectRef() {
  const params = useParams<{ ref?: string }>();
  return createMemo(() => params.ref ?? '');
}
