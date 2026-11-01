/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo } from "solid-js";

import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { DashboardSidebarSection, dashboardNavItemClass } from "@/components/dashboard/sidebar";
import { AccountAvatar, namesRepeat } from "@/components/publish/account-avatar";
import { PlatformLogo } from "@/components/publish/controls";
import { useAuth } from "@/context/auth";
import { t } from "@/lib/i18n";
import { ANALYTICS_PLATFORMS, analyticsSources } from "@/lib/social-analytics";
import { accountLabel, loadSocialConnections, socialConnections } from "@/lib/social-connections";

import { analyticsHidden, setAnalyticsHidden } from "./analytics-state";

export function AnalyticsAccounts() {
  const auth = useAuth();
  createEffect(() => loadSocialConnections(auth.user()?.id));

  const sources = createMemo(() => analyticsSources(socialConnections(), { sample: auth.isGuest() }));
  const only = createMemo(() => {
    const shown = sources().filter((source) => !analyticsHidden().has(source.key));
    return shown.length === 1 && sources().length > 1 ? shown[0]!.key : null;
  });
  const pick = (key: string | null) =>
    setAnalyticsHidden(key ? new Set<string>(sources().filter((source) => source.key !== key).map((source) => source.key)) : new Set<string>());
  const name = (platform: string) => ANALYTICS_PLATFORMS.find((item) => item.id === platform)?.name ?? platform;
  const label = (source: { handle?: string; platform: string }) => accountLabel(source) || name(source.platform);
  const byNetwork = createMemo(() => namesRepeat(sources().map(label)));

  return (
    <DashboardSidebarSection title={t("Accounts")}>
      <div role="radiogroup" aria-label={t("Account")} class="flex flex-col gap-0.5">
        <button type="button" role="radio" aria-checked={!only()} class={dashboardNavItemClass(!only())} onClick={() => pick(null)}>
          <span class="flex min-w-0 items-center gap-2 py-px">
            <PlaneIcon name="analytics" class="size-4" />
            <span class="min-w-0 truncate text-sm leading-5 font-medium">{t("All accounts")}</span>
          </span>
        </button>
        <For each={sources()}>
          {(source) => (
            <button
              type="button"
              role="radio"
              aria-checked={only() === source.key}
              title={source.handle ? `${name(source.platform)}, ${label(source)}` : name(source.platform)}
              class={dashboardNavItemClass(only() === source.key)}
              onClick={() => pick(only() === source.key ? null : source.key)}
            >
              <span class="flex min-w-0 items-center gap-2 py-px">
                <Show
                  when={socialConnections().find((account) => account.id === source.account)}
                  fallback={<PlatformLogo id={source.platform} class="size-4 rounded-sm" bare />}
                >
                  {(account) => <AccountAvatar account={account()} logoOnly={byNetwork()} bare />}
                </Show>
                <span class="min-w-0 truncate text-sm leading-5 font-medium">{label(source)}</span>
              </span>
            </button>
          )}
        </For>
      </div>
    </DashboardSidebarSection>
  );
}
