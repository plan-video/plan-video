/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The accounts posts can go out from, in the sidebar while the calendar is open.
// Picking one shows only the posts that go out from it.

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createMemo, type JSX } from "solid-js";

import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { DashboardSidebarSection, dashboardNavItemClass } from "@/components/dashboard/sidebar";
import { AccountAvatar, namesRepeat } from "@/components/publish/account-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/context/auth";
import { t } from "@/lib/i18n";
import { socialPlatform, type PlatformId } from "@/lib/social";
import { accountLabel, accountsFor, loadSocialConnections, socialConnections, type SocialConnection } from "@/lib/social-connections";
import { accountFilter, allPosts, setAccountFilter } from "./store";
import { PLATFORMS } from "./utils";

const PLATFORM_ORDER: readonly string[] = PLATFORMS.map((platform) => platform.id);

/** Connected accounts, a platform's together, in the order platforms are listed everywhere else. */
function connectedAccounts(): SocialConnection[] {
  return [...socialConnections()].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || a.connectedAt.localeCompare(b.connectedAt),
  );
}

export function CalendarAccounts() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  createEffect(() => loadSocialConnections(auth.user()?.id));

  const accounts = createMemo(connectedAccounts);
  const byNetwork = createMemo(() => namesRepeat(accounts().map(accountLabel)));
  const scheduled = createMemo(() => {
    const counts = new Map<string, number>();
    for (const post of allPosts()) {
      if (post.status !== "scheduled" || post.paused) continue;
      for (const platform of post.platforms) {
        for (const account of accountsFor(platform, post.accounts)) counts.set(account.id, (counts.get(account.id) ?? 0) + 1);
      }
    }
    return counts;
  });
  const openConnections = () => setParams({ dashboard: "connections", date: undefined, view: undefined });

  return (
    <DashboardSidebarSection
      title={t("Accounts")}
      action={
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            aria-label={t("Connect an account")}
            class="grid size-6 place-items-center rounded-md text-(--plane-text-placeholder) outline-none press hover:bg-accent hover:text-(--plane-text-primary) focus-ring"
            onClick={openConnections}
          >
            <PlaneIcon name="plus" class="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t("Connect an account")}</TooltipContent>
        </Tooltip>
      }
    >
      <Show
        when={accounts().length}
        fallback={
          <button type="button" class={dashboardNavItemClass(false)} onClick={openConnections}>
            <span class="flex min-w-0 items-center gap-1.5 py-px text-(--plane-text-tertiary)">
              <PlaneIcon name="link" class="size-4" />
              <span class="truncate text-sm leading-5 font-medium">{t("Connect an account")}</span>
            </span>
          </button>
        }
      >
        <div role="radiogroup" aria-label={t("Account")} class="flex flex-col gap-0.5">
          <AccountRow
            active={!accountFilter()}
            label={t("All accounts")}
            leading={<PlaneIcon name="calendar" class="size-4" />}
            onClick={() => setAccountFilter(null)}
          />
          <For each={accounts()}>
            {(account) => (
              <AccountRow
                active={accountFilter() === account.id}
                label={accountLabel(account)}
                title={`${socialPlatform(account.platform as PlatformId).name}, ${accountLabel(account)}`}
                count={scheduled().get(account.id)}
                leading={<AccountAvatar account={account} logoOnly={byNetwork()} bare />}
                onClick={() => setAccountFilter(accountFilter() === account.id ? null : account.id)}
              />
            )}
          </For>
        </div>
      </Show>
    </DashboardSidebarSection>
  );
}

function AccountRow(props: { active: boolean; label: string; title?: string; count?: number; leading: JSX.Element; onClick(): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      title={props.title}
      class={dashboardNavItemClass(props.active)}
      onClick={props.onClick}
    >
      <span class="flex min-w-0 items-center gap-1.5 py-px">
        {props.leading}
        <span class="min-w-0 truncate text-sm leading-5 font-medium">{props.label}</span>
      </span>
      <Show when={props.count}>
        {(count) => (
          <span class="shrink-0 text-xxs font-medium tabular-nums text-(--plane-text-placeholder)" title={t("{count, plural, one {# scheduled} other {# scheduled}}", { count: count() })}>
            {count()}
          </span>
        )}
      </Show>
    </button>
  );
}
