/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLocation, useParams } from "@solidjs/router";
import { createMemo } from 'solid-js';

import { inGuestMode } from "@/lib/guest";

/** The desktop app also keeps it at `/`. */
export const DASHBOARD_PATH = "/dashboard";

/** Apart from `/dashboard`, so signing up and logging in work as they always have. */
export const TRY_PATH = "/try";

/** Uses the id, not the folder name: it survives a rename, so links and the restored last route keep working. */
export const projectRoute = (id: string): string => `${inGuestMode() ? TRY_PATH : ""}/projects/${encodeURIComponent(id)}`;

export const isEditorPath = (path: string): boolean => path.startsWith('/projects/') || path.startsWith(`${TRY_PATH}/projects/`);

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** index.html reads it the same way. */
export const isPostPreviewPath = (path: string): boolean => /^\/p\/[^/]+\/?$/.test(path);

export const isConnectLinkPath = (path: string): boolean => /^\/connect\/[^/]+\/?$/.test(path);

/** The desktop app opens straight into the dashboard, so it has none. */
export const isSitePath = (path: string): boolean =>
  !isEditorPath(path) && !under(path, DASHBOARD_PATH) && !under(path, TRY_PATH) && !isPostPreviewPath(path) && !isConnectLinkPath(path);

/** Links from the site go here, guest mode or not. */
export function dashboardRoute(view?: string): string {
  return dashboardAt(DASHBOARD_PATH, view);
}

/** For links inside the app: guest mode's own place for a guest. */
export function appRoute(view?: string): string {
  return dashboardAt(inGuestMode() ? TRY_PATH : DASHBOARD_PATH, view);
}

function dashboardAt(path: string, view?: string): string {
  return view ? `${path}?dashboard=${encodeURIComponent(view)}` : path;
}

export type ProjectRouteState = { returnTo?: string };

export function useReturnHere() {
  const location = useLocation();
  return (): ProjectRouteState => ({ returnTo: location.pathname + location.search });
}

/** A project id, or a folder name for older links; the editor rewrites the URL to the id it finds. */
export function useProjectRef() {
  const params = useParams<{ ref?: string }>();
  return createMemo(() => params.ref ?? '');
}
