/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PostStatusFilter } from "@/components/calendar/types";

export type DashboardView =
  | "projects"
  | "trash"
  | "templates"
  | "billing"
  | "account"
  | "settings"
  | "storage"
  | "mcp"
  | "preferences"
  | "help"
  | "search"
  | "notifications"
  | "new-post"
  | "bulk-tools"
  | "calendar"
  | "posts"
  | "scheduled"
  | "posted"
  | "drafts"
  | "failed"
  | "connections"
  | "workspace"
  | "analytics"
  | "analytics-posts"
  | "analytics-platforms"
  | "analytics-times"
  | "vault"
  | "plugs"
  | "media"
  | "agent";
export type AnalyticsSection = "overview" | "posts" | "platforms" | "times";

export type PostsTab = PostStatusFilter | "failed";

export type ProjectSortOption = | "last-viewed" | "alphabetical" | "date-created";
export type TemplateSourceOption = "official" | "custom";
export type TemplatePreviewKind = "landscape" | "portrait" | "square";

export type TemplateCard = {
  name: string;
  resolution: string;
  badge: string;
  previewKind: TemplatePreviewKind;
};
