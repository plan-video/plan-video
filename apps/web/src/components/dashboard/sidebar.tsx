/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlaneIcon, type PlaneIconName } from "@/components/dashboard/plane-icons";
import { useAuth } from "@/context/auth";
import { CHANGELOG_URL, DOCS_URL, ROADMAP_URL } from "@/lib/site-links";
import { changelogUnread, markChangelogSeen, watchChangelog } from "@/lib/changelog-seen";
import { dashboardTheme, setDashboardTheme, type DashboardTheme } from "@/lib/dashboard-theme";
import { AvatarPhoto, useAvatar } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import { planOfLevel } from "@/lib/plans";
import { site } from "@/lib/site";

type DashboardSidebarItemProps = {
  icon: PlaneIconName;
  label: string;
  active?: boolean;
  badge?: string;
  badgeAlert?: boolean;
  /** A quiet count, as the account rows show theirs; `badge` wins when both are given. */
  count?: number;
  onClick?(): void;
  class?: string;
};

const NAV_ITEM =
  "group relative flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left outline-none focus-ring";
const NAV_ITEM_ACTIVE = "bg-(--plane-layer-transparent-active) text-(--plane-text-primary)";
const NAV_ITEM_IDLE =
  "text-(--plane-text-secondary) hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) active:bg-(--plane-layer-transparent-active)";

export function navIconClass(active: boolean) {
  return active ? "text-(--plane-text-primary)" : "text-(--plane-text-tertiary) group-hover:text-(--plane-text-secondary)";
}

export function dashboardNavItemClass(active: boolean) {
  return cx(NAV_ITEM, active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE);
}

export function DashboardIconRailItem(props: {
  icon: PlaneIconName;
  label: string;
  active?: boolean;
  showLabel?: boolean;
  tooltip?: "bottom" | "right";
  onClick(): void;
  children?: JSX.Element;
}) {
  const showLabel = () => props.showLabel ?? true;
  return (
    <Tooltip placement={props.tooltip ?? "bottom"} disabled={showLabel()} openDelay={120}>
      <TooltipTrigger
        as="button"
        type="button"
        aria-label={showLabel() ? undefined : props.label}
        aria-current={props.active ? "page" : undefined}
        onClick={props.onClick}
        class="group flex flex-col items-center justify-center gap-0.5 rounded-md outline-none press focus-ring"
      >
      <span
        class={cx(
          "relative flex size-8 items-center justify-center rounded-md transition-colors",
          props.active
            ? "bg-(--plane-layer-transparent-active) text-(--plane-text-primary) max-md:bg-transparent max-md:text-(--plane-accent-primary)"
            : "text-(--plane-text-tertiary) group-hover:bg-(--plane-layer-transparent-hover) group-hover:text-(--plane-text-primary) max-md:text-(--plane-text-secondary)",
        )}
      >
        <PlaneIcon name={props.icon} class="size-5" />
        {props.children}
      </span>
      <Show when={showLabel()}>
        {/* CJK would break a name between any two characters; it wraps between words instead. */}
        <span
          class={cx(
            "text-center text-xxs leading-[1.1] font-medium [word-break:keep-all] transition-colors max-md:truncate",
            props.active ? "text-(--plane-text-primary) max-md:text-(--plane-accent-primary)" : "text-(--plane-text-tertiary) group-hover:text-(--plane-text-secondary) max-md:text-(--plane-text-secondary)",
          )}
        >
          {props.label}
        </span>
      </Show>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

const COMMUNITY_URL = "https://discord.gg/4C3g9FZsyr";

/** Empty without the site (lib/site.ts). */
const SITE_PAGES: { url: string; label: string; icon: PlaneIconName }[] = site
  ? [
      { url: DOCS_URL, label: msg("Docs"), icon: "docs" },
      { url: CHANGELOG_URL, label: msg("What's new"), icon: "changelog" },
      { url: ROADMAP_URL, label: msg("Roadmap"), icon: "roadmap" },
    ]
  : [];

const NEW_DOT = "size-2 rounded-full bg-(--plane-accent-primary)";

function SitePageItems() {
  return (
    <For each={SITE_PAGES}>
      {(page) => {
        const changelog = page.url === CHANGELOG_URL;
        return (
          <DropdownMenuItem
            tone="neutral"
            class="gap-2"
            onSelect={() => {
              if (changelog) markChangelogSeen();
              openExternal(page.url);
            }}
          >
            <PlaneIcon name={page.icon} class="size-3.5" />
            <span class="flex-1">{t(page.label)}</span>
            <Show when={changelog && changelogUnread()}>
              <span aria-hidden="true" class={NEW_DOT} />
            </Show>
            <PlaneIcon name="external" class="size-3.5 text-(--plane-text-placeholder)" />
          </DropdownMenuItem>
        );
      }}
    </For>
  );
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function DashboardHelpMenu(props: { onHelp(): void }) {
  watchChangelog();
  return (
    <DropdownMenu placement="bottom-end">
      <Tooltip placement="bottom" openDelay={120}>
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger
              {...triggerProps}
              as="button"
              type="button"
              aria-label={t("Help and docs")}
              class="relative flex size-8 items-center justify-center rounded-md text-(--plane-text-tertiary) outline-none press hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring data-expanded:bg-(--plane-layer-transparent-active) data-expanded:text-(--plane-text-primary)"
            >
              <PlaneIcon name="help" class="size-5" />
              <Show when={changelogUnread()}>
                <span aria-hidden="true" class={`absolute top-1.5 right-1.5 ring-2 ring-(--plane-canvas) ${NEW_DOT}`} />
              </Show>
            </DropdownMenuTrigger>
          )}
        />
        <TooltipContent>{t("Help and docs")}</TooltipContent>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-56 gap-0.5">
          <SitePageItems />
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={() => openExternal(COMMUNITY_URL)}>
            <PlaneIcon name="community" class="size-3.5" />
            <span class="flex-1">{t("Discord community")}</span>
            <PlaneIcon name="external" class="size-3.5 text-(--plane-text-placeholder)" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={() => props.onHelp()}>
            <PlaneIcon name="support" class="size-3.5" />
            <span class="flex-1">{t("Help and support")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

export function DashboardSidebarProjectItem(props: { label: string; mark: JSX.Element; onClick(): void }) {
  return (
    <button type="button" onClick={props.onClick} class={cx(NAV_ITEM, NAV_ITEM_IDLE)}>
      <span class="flex min-w-0 flex-grow items-center gap-2 py-px">
        {props.mark}
        <span class="min-w-0 truncate text-sm leading-5 font-medium">{props.label}</span>
      </span>
    </button>
  );
}

export function DashboardSidebarItem(props: DashboardSidebarItemProps) {
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
      class={cx(NAV_ITEM, props.active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE, props.class)}
    >
      <span class="flex min-w-0 items-center gap-2 py-px">
        <PlaneIcon name={props.icon} class={cx("size-4 transition-colors", navIconClass(!!props.active))} />
        <span class="min-w-0 truncate text-sm leading-5 font-medium">{props.label}</span>
      </span>
      <Show
        when={props.badge}
        fallback={
          <Show when={props.count}>
            {(count) => <span class="shrink-0 text-xxs font-medium tabular-nums text-(--plane-text-placeholder)">{count().toLocaleString(intlLocale())}</span>}
          </Show>
        }
      >
        <span
          class={cx(
            "shrink-0 rounded-md px-1.5 py-0.5 text-xxs leading-[1.1] font-medium tabular-nums",
            props.badgeAlert
              ? "bg-(--plane-danger-subtle) text-(--plane-danger-text)"
              : "bg-(--plane-layer-3) text-(--plane-text-tertiary)",
          )}
        >
          {props.badge}
        </span>
      </Show>
    </button>
  );
}

type DashboardSidebarNavProps = {
  children: JSX.Element;
  footer?: JSX.Element;
};

export function DashboardSidebarNav(props: DashboardSidebarNavProps) {
  return (
    <div class="relative z-[1] flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-0.5">
      {props.children}
      <div class="min-h-0 flex-1" />
      {props.footer}
    </div>
  );
}

type DashboardSidebarSectionProps = {
  title?: string;
  action?: JSX.Element;
  children: JSX.Element;
};

export function DashboardSidebarSection(props: DashboardSidebarSectionProps) {
  return (
    <div class="flex shrink-0 flex-col">
      <Show when={props.title}>
        <div class="flex h-7 w-full items-center justify-between gap-1 rounded-md pr-1 pl-2 text-(--plane-text-tertiary)">
          <p class="text-xs leading-4 font-medium whitespace-nowrap">{props.title}</p>
          {props.action}
        </div>
      </Show>
      <div class="flex flex-col gap-0.5">{props.children}</div>
    </div>
  );
}

const THEMES: { value: DashboardTheme; label: string; icon: PlaneIconName }[] = [
  { value: "dark", label: msg("Dark theme"), icon: "moon" },
  { value: "light", label: msg("Light theme"), icon: "sun" },
];

type DashboardSidebarUserProps = {
  onClick: () => void;
  onConnections: () => void;
};

export function DashboardSidebarUser(props: DashboardSidebarUserProps) {
  const auth = useAuth();
  const navigate = useNavigate();

  const displayName = () => {
    const user = auth.user();
    return user?.user_metadata?.full_name || user?.email || t("User");
  };

  const planLabel = () => t("{plan} plan", { plan: t(planOfLevel(auth.accessLevel()).name) });

  const initial = () => displayName().charAt(0).toUpperCase();
  const avatarUrl = useAvatar();

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as="button"
        type="button"
        aria-label={t("{name}, {plan}, account menu", { name: displayName(), plan: planLabel() })}
        class="flex size-8 items-center justify-center rounded-md outline-none press hover:bg-(--plane-layer-transparent-hover) focus-ring data-expanded:bg-(--plane-layer-transparent-active)"
      >
        <AvatarPhoto
          url={avatarUrl()}
          class="size-6 shrink-0 rounded-full object-cover"
          fallback={
            <div class="grid size-6 shrink-0 place-items-center rounded-full bg-(--plane-layer-3) text-xxs font-medium text-(--plane-text-primary)">
              {initial()}
            </div>
          }
        />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-60 gap-0.5 shadow-none">
          <div class="flex min-w-0 items-center gap-2.5 px-2 pt-1.5 pb-2">
            <AvatarPhoto
              url={avatarUrl()}
              class="size-8 shrink-0 rounded-full object-cover"
              fallback={
                <div class="grid size-8 shrink-0 place-items-center rounded-full bg-(--plane-layer-3) text-sm font-medium text-(--plane-text-primary)">
                  {initial()}
                </div>
              }
            />
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-sm leading-5 font-medium text-(--plane-text-primary)">{displayName()}</span>
              <span class="truncate text-xs leading-4 text-(--plane-text-tertiary)">{planLabel()}</span>
            </div>
          </div>
          <DropdownMenuSeparator class="my-1" />
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={props.onClick}>
            <PlaneIcon name="settings" class="size-3.5" />
            <span class="flex-1">{t("Settings")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={props.onConnections}>
            <PlaneIcon name="plug" class="size-3.5" />
            <span class="flex-1">{t("Connections")}</span>
          </DropdownMenuItem>
          {/* Its halves are radio items, so arrow keys reach them. */}
          <div class="flex h-8 items-center gap-2 pr-0.5 pl-2 text-[13px] text-(--plane-text-secondary)">
            {/* Keyed, since PlaneIcon picks its glyph once. */}
            <Show when={dashboardTheme()} keyed>
              {(theme) => <PlaneIcon name={theme === "light" ? "sun" : "moon"} class="size-3.5 text-muted-foreground" />}
            </Show>
            <span class="flex-1">{t("Theme")}</span>
            <DropdownMenuRadioGroup
              aria-label={t("Theme")}
              value={dashboardTheme()}
              onChange={(value) => setDashboardTheme(value as DashboardTheme)}
              class="flex rounded-[5px] border border-(--plane-border-subtle) p-px"
            >
              <For each={THEMES}>
                {(option) => (
                  <DropdownMenuRadioItem
                    value={option.value}
                    aria-label={t(option.label)}
                    title={t(option.label)}
                    // index.css sets every menu row's fill and ink, so the chosen half needs `!`.
                    class="h-6 w-7 justify-center p-0 text-(--plane-text-tertiary)! data-checked:bg-(--plane-layer-3)! data-checked:text-(--plane-text-primary)! data-highlighted:text-(--plane-text-primary)! [&>span:first-child]:hidden"
                  >
                    <PlaneIcon name={option.icon} class="size-3.5" />
                  </DropdownMenuRadioItem>
                )}
              </For>
            </DropdownMenuRadioGroup>
          </div>
          <DropdownMenuSeparator class="my-1" />
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={() => navigate("/")}>
            <PlaneIcon name="home" class="size-3.5" />
            <span class="flex-1">{t("Homepage")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={() => void auth.signOut()}>
            <PlaneIcon name="log-out" class="size-3.5" />
            <span class="flex-1">{t("Log out")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
