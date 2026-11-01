/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate, useSearchParams } from "@solidjs/router";
import Menu from "lucide-solid/icons/menu";
import { For, Match, Show, Suspense, Switch, createEffect, createRenderEffect, createSignal, lazy, on, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";
import { DashboardSectionView } from "@/components/dashboard/section-view";

const DashboardCalendarView = lazy(() => import("@/components/calendar/calendar-view").then((module) => ({ default: module.DashboardCalendarView })));
const DashboardConnectionsView = lazy(() => import("@/components/dashboard/connections-view").then((module) => ({ default: module.DashboardConnectionsView })));
const DashboardAnalyticsView = lazy(() => import("@/components/dashboard/analytics-view").then((module) => ({ default: module.DashboardAnalyticsView })));
const DashboardVaultView = lazy(() => import("@/components/dashboard/vault-view").then((module) => ({ default: module.DashboardVaultView })));
const DashboardTemplatesView = lazy(() => import("@/components/dashboard/templates-view").then((module) => ({ default: module.DashboardTemplatesView })));
const DashboardPlugsView = lazy(() => import("@/components/dashboard/plugs-view").then((module) => ({ default: module.DashboardPlugsView })));
const DashboardPlugChannels = lazy(() => import("@/components/dashboard/plugs-view").then((module) => ({ default: module.DashboardPlugChannels })));
const DashboardAgentView = lazy(() => import("@/components/dashboard/agent-view").then((module) => ({ default: module.DashboardAgentView })));
const DashboardAssistantNewChat = lazy(() => import("@/components/dashboard/agent-view").then((module) => ({ default: module.DashboardAssistantNewChat })));
const DashboardAssistantChats = lazy(() => import("@/components/dashboard/agent-view").then((module) => ({ default: module.DashboardAssistantChats })));
const AssistantLauncher = lazy(() => import("@/components/dashboard/assistant-panel").then((module) => ({ default: module.AssistantLauncher })));
const DashboardMediaView = lazy(() => import("@/components/dashboard/media-view").then((module) => ({ default: module.DashboardMediaView })));
const DashboardNewPostView = lazy(() => import("@/components/dashboard/new-post-view").then((module) => ({ default: module.DashboardNewPostView })));
const DashboardBulkToolsView = lazy(() => import("@/components/dashboard/bulk-tools-view").then((module) => ({ default: module.DashboardBulkToolsView })));
const DashboardAccountView = lazy(() => import("@/components/dashboard/account-view").then((module) => ({ default: module.DashboardAccountView })));
const DashboardBillingView = lazy(() => import("@/components/dashboard/billing-view").then((module) => ({ default: module.DashboardBillingView })));
const DashboardHelpView = lazy(() => import("@/components/dashboard/help-view").then((module) => ({ default: module.DashboardHelpView })));
const DashboardMcpView = lazy(() => import("@/components/dashboard/mcp-view").then((module) => ({ default: module.DashboardMcpView })));
const DashboardProjectsView = lazy(() => import("@/components/dashboard/projects-view").then((module) => ({ default: module.DashboardProjectsView })));
const DashboardTrashView = lazy(() => import("@/components/dashboard/trash-view").then((module) => ({ default: module.DashboardTrashView })));
const DashboardSettingsView = lazy(() => import("@/components/dashboard/settings-view").then((module) => ({ default: module.DashboardSettingsView })));
const DashboardStorageView = lazy(() => import("@/components/dashboard/storage-view").then((module) => ({ default: module.DashboardStorageView })));
const DashboardWorkspaceView = lazy(() => import("@/components/dashboard/workspace-view").then((module) => ({ default: module.DashboardWorkspaceView })));
const DashboardNotificationsView = lazy(() => import("@/components/dashboard/notifications-view").then((module) => ({ default: module.DashboardNotificationsView })));
const DashboardAnalyticsAccounts = lazy(() => import("@/components/dashboard/analytics-accounts").then((module) => ({ default: module.AnalyticsAccounts })));
const DashboardCalendarSidebar = lazy(() => import("@/components/calendar/calendar-sidebar").then((module) => ({ default: module.CalendarSidebar })));
import { createNotifications, needsAttention } from "@/components/dashboard/notifications";
import {
  DashboardHelpMenu,
  DashboardIconRailItem,
  DashboardSidebarItem,
  DashboardSidebarNav,
  DashboardSidebarProjectItem,
  DashboardSidebarSection,
  DashboardSidebarUser,
} from "@/components/dashboard/sidebar";
import { DashboardSidebarSearch } from "@/components/dashboard/sidebar-search";
import { DashboardSidebarFolders } from "@/components/dashboard/sidebar-folders";
import { loadProjectFolders, moveProjectsToFolder, projectFolder } from "@/lib/project-folders";
import { PageSkeleton, skeletonFor } from "@/components/dashboard/page-skeleton";
import { playEnter } from "@/lib/motion";
import { LibraryStorageMeter } from "@/components/dashboard/sidebar-usage";
import { loadMediaLibrary, mediaItems } from "@/lib/media-library";
import { loadTemplates, postTemplates } from "@/lib/post-templates";
import { loadVault, vaultItems } from "@/lib/vault";
import { allPosts, hydrateCalendar, loadError as calendarLoadError, loaded as calendarLoaded, setStatusFilter, statusFilter, waitingOf } from "@/components/calendar/store";
import { defaultCalendarView, isCalendarView } from "@/components/calendar/default-view";
import { loadOwnPreviews, ownPreviews, syncOwnPreviews } from "@/lib/post-previews";
import { useDeliveries } from "@/components/publish/deliveries";
import { hasFailed, isGoingOut } from "@/components/publish/publisher";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import { useAuth } from "@/context/auth";
import { refreshTeam, showInvite, teamInvites } from "@/lib/team";
import { beginSyncing } from "@/lib/sync-start";
import { activeWorkspaceId, firstNameFrom, loadWorkspaces, setWorkspaceOwnerName, sharedWorkspaces, switchWorkspace } from "@/lib/workspaces";
import { TeamInviteDialog } from "@/components/dashboard/team-invite";
import { fillMissingAvatars } from "@/lib/account-avatars";
import { loadSocialConnections, socialConnections } from "@/lib/social-connections";
import { dashboardRailLabels, dashboardTheme } from "@/lib/dashboard-theme";
import { analyticsSectionOf } from "@/components/dashboard/analytics-state";
import { parseTimestamp } from "@/components/dashboard/utils";
import { DashboardProjectThumbnail, createNewProject } from "@/components/dashboard/shared";
import { CALENDAR_COLOR_PRESETS, colorHex } from "@/components/calendar/utils";
import { projectRoute, useReturnHere } from "@/hooks/use-project-route";
import { track } from "@/lib/analytics";
import { DashboardCrumbsProvider, DashboardPageHeader, type DashboardCrumb } from "@/components/dashboard/page-header";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon, type PlaneIconName } from "@/components/dashboard/plane-icons";
import { listProjects, projectKey, projectsRevision, type ProjectInfo } from "@/projects";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import { isPhone } from "@/lib/phone";
import { planOfLevel } from "@/lib/plans";

import type { DashboardView, PostsTab } from "@/components/dashboard/types";

const DASHBOARD_VIEWS: readonly DashboardView[] = [
  "projects",
  "trash",
  "templates",
  "billing",
  "account",
  "settings",
  "storage",
  "mcp",
  "preferences",
  "help",
  "search",
  "notifications",
  "new-post",
  "bulk-tools",
  "calendar",
  "posts",
  "scheduled",
  "posted",
  "drafts",
  "failed",
  "connections",
  "workspace",
  "analytics",
  "analytics-posts",
  "analytics-platforms",
  "analytics-times",
  "vault",
  "plugs",
  "media",
  "agent",
];

const SECTION_PAGES: Partial<Record<DashboardView, { description: string }>> = {
  search: {
    description: msg("Search across your projects and posts."),
  },
};

const POST_LISTS: Partial<Record<DashboardView, PostsTab>> = {
  posts: "all",
  scheduled: "scheduled",
  posted: "posted",
  drafts: "draft",
  failed: "failed",
};

/** The List view by status, as rivals list their queue, drafts and sent posts. */
const POST_PAGES: readonly { view: DashboardView; tab: PostsTab; label: string; icon: PlaneIconName }[] = [
  { view: "scheduled", tab: "scheduled", label: msg("Scheduled"), icon: "clock" },
  { view: "drafts", tab: "draft", label: msg("Drafts"), icon: "draft" },
  { view: "posted", tab: "posted", label: msg("Posted"), icon: "check" },
  { view: "failed", tab: "failed", label: msg("Failed"), icon: "alert" },
];

const SETTINGS_VIEWS: readonly DashboardView[] = [
  "account",
  "workspace",
  "connections",
  "settings",
  "storage",
  "mcp",
  "billing",
  "help",
];

function parseView(value: string | string[] | undefined): DashboardView {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_VIEWS.find((v) => v === raw) ?? "calendar";
}

function isSettingsView(view: DashboardView): boolean {
  return SETTINGS_VIEWS.includes(view);
}

type DashboardRail = "work" | "agent" | "projects" | "library" | "analytics" | "plugs" | "settings";

const RAIL_LABELS: Record<DashboardRail, string> = {
  work: msg({ message: "Schedule", context: "noun" }),
  agent: msg("Assistant"),
  projects: msg("Projects"),
  library: msg("Library"),
  analytics: msg("Analytics"),
  plugs: msg("Plugs"),
  settings: msg("Settings"),
};

const RAIL_HOME: Record<DashboardRail, DashboardView> = {
  work: "calendar",
  agent: "agent",
  projects: "projects",
  library: "media",
  analytics: "analytics",
  plugs: "plugs",
  settings: "account",
};

const PAGES: Partial<Record<DashboardView, { label: string; icon: PlaneIconName }>> = {
  calendar: { label: msg("Calendar"), icon: "calendar" },
  notifications: { label: msg("Inbox"), icon: "inbox" },
  "new-post": { label: msg("New post"), icon: "draft" },
  "bulk-tools": { label: msg("Bulk tools"), icon: "layers" },
  agent: { label: msg("Assistant"), icon: "agent" },
  projects: { label: msg("All projects"), icon: "project" },
  trash: { label: msg("Trash"), icon: "trash" },
  media: { label: msg("Media"), icon: "video-file" },
  templates: { label: msg("Templates"), icon: "template" },
  vault: { label: msg("Vault"), icon: "lock" },
  plugs: { label: msg("Plugs"), icon: "plug" },
  analytics: { label: msg("Overview"), icon: "analytics" },
  "analytics-posts": { label: msg("Posts"), icon: "video-file" },
  "analytics-platforms": { label: msg("Platforms"), icon: "layers" },
  "analytics-times": { label: msg("Best times"), icon: "clock" },
  account: { label: msg("Profile"), icon: "user-circle" },
  settings: { label: msg("Preferences"), icon: "preferences" },
  connections: { label: msg("Connections"), icon: "link" },
  workspace: { label: msg("General"), icon: "workspace" },
  storage: { label: msg("Storage"), icon: "archive" },
  mcp: { label: "MCP & CLI", icon: "ai" },
  billing: { label: msg("Billing"), icon: "credit-card" },
  help: { label: msg("Help"), icon: "info" },
  search: { label: msg("Search"), icon: "search" },
};

function pageOf(view: DashboardView) {
  if (POST_LISTS[view]) return PAGES.calendar!;
  return PAGES[view] ?? { label: "plan.video", icon: "home" as const };
}

const OWN_HEADER = new Set<DashboardView>([
  "calendar",
  "posts",
  "scheduled",
  "posted",
  "drafts",
  "failed",
  "notifications",
  "new-post",
  "bulk-tools",
  "projects",
  "trash",
  "media",
  "templates",
  "vault",
  "analytics",
  "analytics-posts",
  "analytics-platforms",
  "analytics-times",
  "billing",
]);

function projectColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return CALENDAR_COLOR_PRESETS[hash % CALENDAR_COLOR_PRESETS.length]!;
}

function ProjectMark(props: { name: string; dir: string; cover: Blob | null }) {
  const color = () => colorHex(projectColor(props.name));
  return (
    <span
      aria-hidden="true"
      class="relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-md text-xxs font-medium leading-none ring-1 ring-inset ring-(--plane-border-subtle-1)"
      style={{ color: color(), "background-color": `color-mix(in srgb, ${color()} 16%, transparent)` }}
    >
      {[...props.name.trim()][0]?.toUpperCase() ?? "P"}
      <DashboardProjectThumbnail cover={props.cover} cacheKey={props.dir} />
    </span>
  );
}

function railFor(view: DashboardView): DashboardRail {
  if (isSettingsView(view)) return "settings";
  if (view === "agent") return "agent";
  if (view === "projects" || view === "trash") return "projects";
  if (view === "media" || view === "templates" || view === "vault") return "library";
  if (analyticsSectionOf(view)) return "analytics";
  if (view === "plugs") return "plugs";
  return "work";
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const auth = useAuth();

  createEffect(() => {
    const user = auth.user();
    const userId = user?.id;
    // A first workspace still named after its owner is renamed "Personal".
    if (user) setWorkspaceOwnerName(user.id, firstNameFrom(user.user_metadata));
    loadWorkspaces(auth.ownerId());
    beginSyncing(userId);
  });

  createEffect(() => {
    const raw = Array.isArray(params.invite) ? params.invite[0] : params.invite;
    if (!raw || !auth.user()?.id) return;
    setParams({ invite: undefined }, { replace: true });
    void refreshTeam().then(() => {
      if (teamInvites().some((invite) => invite.id === raw)) return showInvite(raw);
      const joined = sharedWorkspaces().find((workspace) => workspace.membership === raw);
      if (joined) return switchWorkspace(joined.id);
      toast.error(t("This invite isn't open"), {
        description: t("It may have been taken back, or it's for another email. Sign in with the email it was sent to."),
      });
    });
  });

  createEffect(() => {
    const userId = auth.user()?.id;
    if (!userId) return;
    loadSocialConnections(userId);
    fillMissingAvatars(userId, socialConnections());
  });

  onMount(() => {
    const previous = document.title;
    document.title = "plan.video";
    onCleanup(() => {
      document.title = previous;
    });
  });

  const view = (): DashboardView => parseView(params.dashboard);
  const setView = (next: DashboardView, options?: { replace: boolean }) => {
    // From a status page, Calendar shows every post again rather than the month with that status alone.
    if (next === "calendar" && (listTab() ?? "all") !== "all") setStatusFilter("all");
    setParams({ dashboard: next, date: undefined, time: undefined, view: undefined, back: undefined, folder: undefined }, options);
  };
  const openFolder = () => (view() === "projects" && typeof params.folder === "string" ? projectFolder(params.folder) : undefined);
  const showFolder = (id: string | undefined, options?: { replace: boolean }) => setParams({ dashboard: "projects", folder: id }, options);

  // Projects and their folders belong to a person, not a workspace.
  createEffect(() => loadProjectFolders(auth.user()?.id));

  createEffect(() => {
    const raw = Array.isArray(params.dashboard) ? params.dashboard[0] : params.dashboard;
    if (raw === "home") setView("calendar", { replace: true });
  });
  createEffect(() => {
    const tab = POST_LISTS[view()];
    if (!tab) return;
    setStatusFilter(tab);
    setParams({ dashboard: "calendar", view: "list", time: undefined }, { replace: true });
  });

  const openProfile = () => setView("account");

  onMount(() => void hydrateCalendar());

  createEffect(() => {
    if (auth.isGuest() && (view() === "account" || view() === "billing")) setView("settings", { replace: true });
  });

  useDeliveries(() => auth.user()?.id);

  createEffect(on([() => auth.user()?.id, activeWorkspaceId], () => void loadOwnPreviews()));
  let previewSync: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on([allPosts, calendarLoaded, ownPreviews], () => {
      if (!calendarLoaded() || !ownPreviews().length) return;
      clearTimeout(previewSync);
      // Read again when it fires: a workspace switch or failed load in between leaves no posts, which reads as all deleted.
      previewSync = setTimeout(() => {
        if (calendarLoaded() && !calendarLoadError()) void syncOwnPreviews(allPosts());
      }, 1500);
    }),
  );
  onCleanup(() => clearTimeout(previewSync));
  const failedCount = () => allPosts().filter((post) => hasFailed(post) && !isGoingOut(post)).length;
  const sendingBadge = () => (allPosts().some((post) => isGoingOut(post) && !waitingOf(post)) ? t("Sending") : undefined);
  const countOf = (tab: PostsTab) => {
    if (tab === "failed") return failedCount();
    if (tab === "posted" || tab === "all") return 0;
    return allPosts().filter((post) => post.status === tab).length;
  };

  createEffect(() => {
    if (rail() !== "library") return;
    const userId = auth.ownerId();
    void loadMediaLibrary();
    loadTemplates(userId);
    loadVault(userId);
  });
  const countBadge = (count: number) => (count ? count.toLocaleString(intlLocale()) : undefined);

  let pageBox: HTMLDivElement | undefined;
  createEffect(on(view, () => playEnter(pageBox), { defer: true }));

  const [drawerOpen, setDrawerOpen] = createSignal(false);
  createEffect(on(() => [params.dashboard, params.folder, params.view], () => setDrawerOpen(false), { defer: true }));

  const notifications = createNotifications(setView);
  const unreadNotices = () => notifications.unread().length;

  const workspaceSwitcher = () => <WorkspaceSwitcher onSettings={() => setView("workspace")} />;

  const rail = () => railFor(view());
  const openRail = (next: DashboardRail) => {
    if (next === "settings" && isSettingsView(view())) return;
    setView(next === "settings" && auth.isGuest() ? "settings" : RAIL_HOME[next]);
  };
  const onCalendar = () => view() === "calendar" || !!POST_LISTS[view()];
  // The URL leaves out the view picked in Preferences, so the list may be shown with no `view` param.
  const listTab = (): PostsTab | undefined => {
    const tab = POST_LISTS[view()];
    if (tab) return tab;
    if (view() !== "calendar") return undefined;
    const raw = typeof params.view === "string" ? params.view : undefined;
    return isPhone() || (isCalendarView(raw) ? raw : defaultCalendarView()) === "list" ? statusFilter() : undefined;
  };
  const onCalendarHome = () => onCalendar() && (listTab() ?? "all") === "all";

  const crumbs = (): DashboardCrumb[] => {
    const page = pageOf(view());
    const folder = openFolder();
    if (folder) return [{ label: t(page.label), icon: page.icon, onClick: () => showFolder(undefined) }, { label: folder.name, icon: "folder" }];
    return [{ label: t(page.label), icon: page.icon }];
  };

  // Menus and dialogs mount on <body>, so the theme goes on <html>, before first paint so light never flashes dark.
  const root = document.documentElement;
  root.classList.add("dashboard-theme");
  createRenderEffect(() => {
    root.dataset.dashboardTheme = dashboardTheme();
  });
  onCleanup(() => {
    root.classList.remove("dashboard-theme");
    delete root.dataset.dashboardTheme;
  });

  const navigate = useNavigate();
  const returnHere = useReturnHere();
  // A signal, not a resource: a refetching resource here would hold the router's transition to the editor,
  // which then mounts while still off the page.
  const [projectList, setProjectList] = createSignal<Awaited<ReturnType<typeof listProjects>>>([]);
  createEffect(
    on(projectsRevision, () => {
      let current = true;
      onCleanup(() => {
        current = false;
      });
      listProjects()
        .then((list) => current && setProjectList(list))
        .catch(() => current && setProjectList([]));
    }),
  );
  const sidebarProjects = () =>
    projectList()
      .filter((project) => !project.trashedAt)
      .sort((a, b) => parseTimestamp(b.lastOpenedAt) - parseTimestamp(a.lastOpenedAt))
      .slice(0, 6);

  let creatingProject = false;
  const openListedProject = (project: ProjectInfo) => {
    track("project_opened");
    navigate(projectRoute(projectKey(project)), { state: returnHere() });
  };
  const createFromSidebar = async () => {
    if (creatingProject) return;
    creatingProject = true;
    try {
      const project = await createNewProject();
      if (!project) return;
      const folder = openFolder();
      if (folder) moveProjectsToFolder([projectKey(project)], folder.id);
      await openListedProject(project);
    } finally {
      creatingProject = false;
    }
  };

  const PageLink = (props: { view: DashboardView; badge?: string; badgeAlert?: boolean }) => (
    <DashboardSidebarItem
      active={props.view === "calendar" ? onCalendarHome() : props.view === "projects" ? view() === "projects" && !openFolder() : view() === props.view}
      onClick={() => setView(props.view)}
      icon={pageOf(props.view).icon}
      label={t(pageOf(props.view).label)}
      badge={props.badge}
      badgeAlert={props.badgeAlert}
    />
  );

  return (
    <div
      class={cx("dashboard-shell flex w-full min-h-0 flex-col overflow-hidden", auth.isGuest() ? "h-full" : "h-dvh")}
      // Wide enough that the longest name ("Analytics") keeps room on both sides.
      style={{ "--rail-width": dashboardRailLabels() ? "4.75rem" : "3rem" }}
    >
      <header class="relative z-[27] flex min-h-10 w-full shrink-0 items-center bg-(--plane-canvas) px-3.5 max-md:h-12 max-md:gap-1 max-md:px-2">
        <button
          type="button"
          aria-label={t("Menu")}
          aria-expanded={drawerOpen()}
          class="grid size-9 shrink-0 place-items-center rounded-md text-(--plane-text-secondary) outline-none press focus-ring md:hidden"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <Menu class="size-5" />
        </button>
        <div class="flex min-w-0 flex-1 shrink-0">
          {/* On the rail's centre line: half the rail, less the header's 14px, the switcher's 4px and half the 28px badge. */}
          <div class="ml-[calc(var(--rail-width)/2-2rem)] flex min-w-0 max-md:ml-0">
            {workspaceSwitcher()}
          </div>
        </div>
        <div class="shrink-0">
          <DashboardSidebarSearch placeholder={t("Search")} onNavigate={setView} />
        </div>
        <div class="flex shrink-0 items-center justify-end gap-1 md:flex-1">
          <div class="contents max-md:hidden">
            <DashboardHelpMenu onHelp={() => setView("help")} />
          </div>
          {/* A guest's way to an account is on guest mode's frame instead. */}
          <Show when={!auth.isGuest()}>
            <DashboardIconRailItem
              icon="inbox"
              label={unreadNotices() ? t("{count, plural, other {Inbox, # unread}}", { count: unreadNotices() }) : t("Inbox")}
              showLabel={false}
              active={view() === "notifications"}
              onClick={() => setView("notifications")}
            >
              <Show when={unreadNotices() > 0}>
                <span
                  aria-hidden="true"
                  class="absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-(--plane-canvas)"
                  classList={{
                    "bg-(--plane-danger-text)": notifications.unread().some(needsAttention),
                    "bg-(--plane-accent-primary)": !notifications.unread().some(needsAttention),
                  }}
                />
              </Show>
            </DashboardIconRailItem>
            <DashboardSidebarUser onClick={openProfile} onConnections={() => setView("connections")} />
          </Show>
        </div>
      </header>

      <div class="relative flex min-h-0 flex-1 overflow-hidden max-md:flex-col-reverse">
        <nav
          aria-label={t("Apps")}
          class={cx(
            "z-[26] flex h-full w-(--rail-width) shrink-0 flex-col bg-(--plane-canvas) px-2 pt-2 pb-3 max-md:h-auto max-md:w-full max-md:flex-row max-md:justify-around max-md:gap-0 max-md:border-t max-md:border-(--plane-border-subtle) max-md:px-1 max-md:py-1.5",
            dashboardRailLabels() ? "gap-4" : "gap-2",
          )}
        >
          <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "work"} onClick={() => openRail("work")} icon="calendar" label={t(RAIL_LABELS.work)} />
          <div class="contents max-md:hidden">
            <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "projects"} onClick={() => openRail("projects")} icon="project" label={t("Projects")} />
          </div>
          <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "library"} onClick={() => openRail("library")} icon="layer-stack" label={t("Library")} />
          <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "agent"} onClick={() => openRail("agent")} icon="agent" label={t(RAIL_LABELS.agent)} />
          <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "plugs"} onClick={() => openRail("plugs")} icon="plug" label={t("Plugs")} />
          <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "analytics"} onClick={() => openRail("analytics")} icon="analytics" label={t("Analytics")} />
          <div class="min-h-0 flex-1 max-md:hidden" />
          <DashboardIconRailItem showLabel={dashboardRailLabels()} tooltip="right" active={rail() === "settings"} onClick={() => openRail("settings")} icon="settings" label={t("Settings")} />
        </nav>

        <div class="relative min-h-0 min-w-0 flex-grow overflow-hidden pr-2 pb-2 max-md:p-0">
          <div class="depth-frame relative flex size-full overflow-hidden rounded-xl border border-(--plane-border-subtle) max-md:rounded-none max-md:border-0">
            <Show when={drawerOpen()}>
              <button type="button" aria-label={t("Close")} class="absolute inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
            </Show>
            <aside
              class="flex h-full w-[250px] shrink-0 flex-col overflow-hidden border-r border-(--plane-border-subtle) bg-(--plane-surface-1) max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-[min(85vw,300px)] max-md:transition-[translate,visibility] max-md:duration-200"
              classList={{ "max-md:invisible max-md:-translate-x-full": !drawerOpen() }}
            >
              <div class="flex h-11 shrink-0 items-center gap-2 px-5">
                <h2 class="truncate text-[15px] leading-5 font-medium tracking-[-0.01em] text-(--plane-text-primary)">{t(RAIL_LABELS[rail()])}</h2>
                <Show when={rail() === "analytics"}>
                  <span class="shrink-0 rounded-md bg-(--plane-accent-subtle) px-1.5 py-0.5 text-xxs leading-[1.1] font-medium text-(--plane-accent-secondary)">
                    {t("Beta")}
                  </span>
                </Show>
              </div>
              <Show when={rail() === "work" || rail() === "projects"}>
                <div class="shrink-0 px-3 pt-1">
                  <Show
                    when={rail() === "work"}
                    fallback={
                      <PlaneButton
                        variant="secondary"
                        size="xl"
                        class="w-full justify-start gap-1.5"
                        onClick={() => void createFromSidebar()}
                      >
                        <PlaneIcon name="plus" class="size-4 text-(--plane-text-secondary)" />
                        <span class="truncate text-sm font-medium">{t("New project")}</span>
                      </PlaneButton>
                    }
                  >
                    <PlaneButton
                      variant="secondary"
                      size="xl"
                      aria-current={view() === "new-post" ? "page" : undefined}
                      class={cx("w-full justify-start gap-1.5", view() === "new-post" && "bg-(--plane-layer-2-active)")}
                      onClick={() => setView("new-post")}
                    >
                      <PlaneIcon name="edit" class="size-4 text-(--plane-text-secondary)" />
                      <span class="truncate text-sm font-medium">{t("New post")}</span>
                    </PlaneButton>
                  </Show>
                </div>
              </Show>
              <Show when={rail() === "agent"}>
                <div class="shrink-0 px-3 pt-1">
                  <Suspense>
                    <DashboardAssistantNewChat />
                  </Suspense>
                </div>
              </Show>
              <DashboardSidebarNav
                footer={
                  <>
                    <Show when={rail() === "library"}>
                      <LibraryStorageMeter onOpen={() => setView("storage")} />
                    </Show>
                  </>
                }
              >
                <Show when={rail() === "work"}>
                  <DashboardSidebarSection>
                    <PageLink view="calendar" badge={sendingBadge()} />
                    <PageLink view="bulk-tools" />
                  </DashboardSidebarSection>
                  <DashboardSidebarSection title={t("Posts")}>
                    <For each={POST_PAGES}>
                      {(page) => (
                        <Show when={page.tab !== "failed" || failedCount() > 0 || listTab() === "failed"}>
                          <DashboardSidebarItem
                            active={listTab() === page.tab}
                            onClick={() => setView(page.view)}
                            icon={page.icon}
                            label={t(page.label)}
                            badge={page.tab === "failed" ? countBadge(failedCount()) : undefined}
                            badgeAlert={page.tab === "failed"}
                            count={countOf(page.tab)}
                          />
                        </Show>
                      )}
                    </For>
                  </DashboardSidebarSection>
                  <Show when={onCalendar()}>
                    <Suspense>
                      <DashboardCalendarSidebar />
                    </Suspense>
                  </Show>
                </Show>
                <Show when={rail() === "projects"}>
                  <DashboardSidebarSection>
                    <PageLink view="projects" />
                    <PageLink view="trash" />
                  </DashboardSidebarSection>
                  <DashboardSidebarFolders
                    activeId={openFolder()?.id}
                    onOpen={showFolder}
                    onDeleted={(id) => params.folder === id && showFolder(undefined, { replace: true })}
                  />
                  <Show when={sidebarProjects().length > 0}>
                    <DashboardSidebarSection title={t("Recent")}>
                      <For each={sidebarProjects()}>
                        {(project) => (
                          <DashboardSidebarProjectItem label={project.displayName} mark={<ProjectMark name={project.displayName} dir={project.dir} cover={project.cover} />} onClick={() => void openListedProject(project)} />
                        )}
                      </For>
                    </DashboardSidebarSection>
                  </Show>
                </Show>
                <Show when={rail() === "library"}>
                  <DashboardSidebarSection>
                    <PageLink view="media" badge={countBadge(mediaItems().length)} />
                    <PageLink view="templates" badge={countBadge(postTemplates().length)} />
                    <PageLink view="vault" badge={countBadge(vaultItems().length)} />
                  </DashboardSidebarSection>
                </Show>
                <Show when={rail() === "analytics"}>
                  <DashboardSidebarSection>
                    <PageLink view="analytics" />
                    <PageLink view="analytics-posts" />
                    <PageLink view="analytics-platforms" />
                    <PageLink view="analytics-times" />
                  </DashboardSidebarSection>
                  <Suspense>
                    <DashboardAnalyticsAccounts />
                  </Suspense>
                </Show>
                <Show when={rail() === "agent"}>
                  <Suspense>
                    <DashboardAssistantChats />
                  </Suspense>
                </Show>
                <Show when={rail() === "plugs"}>
                  <DashboardSidebarSection title={t("Channels")}>
                    <Suspense>
                      <DashboardPlugChannels />
                    </Suspense>
                  </DashboardSidebarSection>
                </Show>
                <Show when={rail() === "settings"}>
                  <DashboardSidebarSection title={t("Account")}>
                    <Show when={!auth.isGuest()}>
                      <PageLink view="account" />
                    </Show>
                    <PageLink view="settings" />
                    <PageLink view="connections" />
                  </DashboardSidebarSection>
                  <DashboardSidebarSection title={t("Workspace")}>
                    <PageLink view="workspace" />
                    <PageLink view="storage" />
                    <Show when={!auth.isGuest()}>
                      <PageLink view="billing" />
                    </Show>
                  </DashboardSidebarSection>
                  <DashboardSidebarSection>
                    <PageLink view="help" />
                  </DashboardSidebarSection>
                </Show>
              </DashboardSidebarNav>
              <Show when={auth.isGuest() || !auth.isPro()}>
                <div class="flex h-12 shrink-0 items-center border-t border-(--plane-border-subtle) px-3">
                  <button
                    type="button"
                    class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none press hover:bg-(--plane-layer-transparent-hover) focus-ring"
                    onClick={() => (auth.isGuest() ? navigate("/signup") : setView("billing"))}
                  >
                    <span class="min-w-0 flex-1 truncate text-xs font-medium text-(--plane-text-secondary)">
                      {auth.isGuest() ? t("Guest mode") : t("{plan} plan", { plan: t(planOfLevel(auth.accessLevel()).name) })}
                    </span>
                    <span class="shrink-0 rounded-md bg-(--plane-accent-subtle) px-1.5 py-0.5 text-xxs leading-[1.1] font-medium text-(--plane-accent-secondary)">
                      {auth.isGuest() ? t("Sign up") : t("Upgrade")}
                    </span>
                  </button>
                </div>
              </Show>
            </aside>

            <main class="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-(--plane-surface-1)">
              <DashboardCrumbsProvider value={crumbs}>
                <Show when={!OWN_HEADER.has(view())}>
                  <DashboardPageHeader />
                </Show>
                <div ref={pageBox} class="flex min-h-0 flex-1 flex-col">
                  <Suspense
                    fallback={
                      <>
                        <Show when={OWN_HEADER.has(view())}>
                          <DashboardPageHeader />
                        </Show>
                        <PageSkeleton kind={skeletonFor(view(), typeof params.view === "string" ? params.view : undefined)} />
                      </>
                    }
                  >
                    <Switch>
                      <Match when={view() === "projects"}>
                        <DashboardProjectsView />
                      </Match>
                      <Match when={onCalendar()}>
                        <DashboardCalendarView />
                      </Match>
                      <Match when={view() === "new-post"}>
                        <DashboardNewPostView />
                      </Match>
                      <Match when={view() === "bulk-tools"}>
                        <DashboardBulkToolsView />
                      </Match>
                      <Match when={view() === "connections"}>
                        <DashboardConnectionsView />
                      </Match>
                      <Match when={view() === "workspace"}>
                        <DashboardWorkspaceView onOpen={setView} />
                      </Match>
                      <Match when={view() === "vault"}>
                        <DashboardVaultView />
                      </Match>
                      <Match when={view() === "templates"}>
                        <DashboardTemplatesView />
                      </Match>
                      <Match when={view() === "plugs"}>
                        <DashboardPlugsView />
                      </Match>
                      <Match when={view() === "agent"}>
                        <DashboardAgentView />
                      </Match>
                      <Match when={view() === "media"}>
                        <DashboardMediaView />
                      </Match>
                      <Match when={view() === "trash"}>
                        <DashboardTrashView />
                      </Match>
                      <Match when={view() === "billing"}>
                        <DashboardBillingView />
                      </Match>
                      <Match when={view() === "account"}>
                        <DashboardAccountView />
                      </Match>
                      <Match when={view() === "settings"}>
                        <DashboardSettingsView />
                      </Match>
                      <Match when={view() === "storage"}>
                        <DashboardStorageView />
                      </Match>
                      <Match when={view() === "mcp"}>
                        <DashboardMcpView />
                      </Match>
                      <Match when={view() === "help"}>
                        <DashboardHelpView />
                      </Match>
                      <Match when={analyticsSectionOf(view())}>
                        {(section) => <DashboardAnalyticsView section={section()} onSection={setView} />}
                      </Match>
                      <Match when={view() === "notifications"}>
                        <DashboardNotificationsView notifications={notifications} />
                      </Match>
                      <Match when={SECTION_PAGES[view()]}>
                        {(page) => <DashboardSectionView description={t(page().description)} />}
                      </Match>
                    </Switch>
                  </Suspense>
                </div>
              </DashboardCrumbsProvider>
              {/* The Assistant from any page; its own boundary, so the page never waits for it. */}
              <div class="contents max-md:hidden">
                <Suspense>
                  <AssistantLauncher page={pageOf(view()).label} hidden={view() === "agent"} onExpand={() => setView("agent")} />
                </Suspense>
              </div>
              <Show when={onCalendar()}>
                <button
                  type="button"
                  aria-label={t("New post")}
                  class="absolute right-4 bottom-4 z-20 grid size-14 place-items-center rounded-full bg-(--plane-accent-primary) text-white shadow-lg outline-none press focus-ring md:hidden"
                  onClick={() => setView("new-post")}
                >
                  <PlaneIcon name="plus" class="size-6" />
                </button>
              </Show>
            </main>
          </div>
        </div>
      </div>
      <TeamInviteDialog />
    </div>
  );
}
