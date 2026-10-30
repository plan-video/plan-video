/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { t } from "@/lib/i18n";
import { CHANGELOG_URL, DOCS_URL, ROADMAP_URL, SUPPORT_URL } from "@/lib/site-links";
import { site } from "@/lib/site";

import {
  DashboardLabelValue,
  DashboardDividedStack,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";

type DashboardHelpExternalRowProps = {
  label: string;
  href: string;
};

function DashboardHelpExternalRow(props: DashboardHelpExternalRowProps) {
  return (
    <div class="flex h-4 w-full items-center gap-4 rounded-md text-xs text-foreground outline-none focus-ring">
      <span class="min-w-0 flex-1 truncate text-left">
        {props.label}
      </span>
      <a href={props.href} target="_blank" class="rounded-sm press focus-ring">
        <Icon name="external-link" class="text-foreground" />
      </a>
    </div>
  );
}

type DashboardHelpUserIdRowProps = {
  value: string;
  onCopy: () => void;
};

function DashboardHelpUserIdRow(props: DashboardHelpUserIdRowProps) {
  return (
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
      <DashboardLabelValue
        label={t("User id")}
        value={props.value}
        valueClass="truncate text-xs"
      />
      <Button variant="secondary" onClick={props.onCopy}>
        {t("Copy")}
      </Button>
    </div>
  );
}

export function DashboardHelpView() {
  const auth = useAuth();
  const userId = () => auth.user()?.id ?? "";

  const copyUserId = async () => {
    const id = userId();
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      toast(t("Copied!"), { description: t("The user id has been copied to your clipboard.") });
    } catch (error) {
      toast(t("Failed to copy"), { description: error instanceof Error ? error.message : t("Unknown error") });
    }
  };

  return (
    <DashboardScrollView>
      <DashboardSurfaceSection title={t("Resources")}>
        <DashboardDividedStack>
          {/* The site's pages, where the site is there (lib/site.ts). */}
          <Show when={site}>
            <DashboardHelpExternalRow label={t("Docs")} href={DOCS_URL} />
            <DashboardHelpExternalRow label={t("What's new")} href={CHANGELOG_URL} />
            <DashboardHelpExternalRow label={t("Roadmap")} href={ROADMAP_URL} />
          </Show>
          <DashboardHelpExternalRow
            label={t("Discord community")}
            href="https://discord.gg/4C3g9FZsyr"
          />
        </DashboardDividedStack>
      </DashboardSurfaceSection>

      <DashboardSurfaceSection title={t("Support")}>
        <DashboardDividedStack>
          <Show when={userId()}>
            <DashboardHelpUserIdRow value={userId()} onCopy={copyUserId} />
          </Show>
          <Show when={site}>
            <DashboardHelpExternalRow label={t("Report a bug")} href={`${SUPPORT_URL}?kind=bug`} />
            <DashboardHelpExternalRow label={t("Request a feature")} href={`${SUPPORT_URL}?kind=feature`} />
            <DashboardHelpExternalRow label={t("Contact support")} href={`${SUPPORT_URL}?kind=other`} />
          </Show>
        </DashboardDividedStack>
      </DashboardSurfaceSection>

      {/* 
      <DashboardSurfaceSection title="Keyboard shortcuts">
        <DashboardInfoActionRow
          leading={<Icon name="keyboard-shortcut" class="size-6 text-foreground" />}
          title="View, search, and customize shortcuts."
          action={
            <Button variant="secondary">
              Open keyboard shortcuts...
            </Button>
          }
          layout="inline"
        />
      </DashboardSurfaceSection> 
      */}
    </DashboardScrollView>
  );
}

