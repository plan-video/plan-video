/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createResource } from "solid-js";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { cloudEnabled, cloudUsage, type CloudUsage } from "@/lib/cloud-storage";
import { intlLocale, msg, rich, t } from "@/lib/i18n";
import { formatBytes } from "@/lib/social-media";
import { isDesktop } from "@/projects";

import { DashboardScrollView, DashboardSurfaceSection } from "./shared";

const CREATOR_LIMIT = msg("50 GB");

const PARTS = [
  { id: "media", label: msg("Media"), hint: msg("Your media library"), tone: "bg-primary" },
  { id: "posts", label: msg("Posts"), hint: msg("Files for posts that haven't gone out yet"), tone: "bg-primary/65" },
  { id: "projects", label: msg("Projects"), hint: msg("Your editor projects"), tone: "bg-primary/40" },
] as const;

/** Whole gigabytes without a trailing ".0". */
function size(bytes: number) {
  const locale = intlLocale();
  const unit = (value: number, name: string) => new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short" }).format(value);
  if (bytes <= 0) return locale ? unit(0, "megabyte") : "0 MB";
  const gigabytes = Number((bytes / 1e9).toFixed(1));
  if (bytes >= 1e9) return locale ? unit(gigabytes, "gigabyte") : `${gigabytes} GB`;
  return formatBytes(bytes);
}

const share = (bytes: number, of: number) => (of > 0 ? Math.min(100, (bytes / of) * 100) : 0);

function UsageBar(props: { parts: { bytes: number; tone: string }[]; of: number; full?: boolean }) {
  return (
    <div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      <For each={props.parts}>
        {(part) => (
          <span
            class={props.full ? "bg-destructive" : part.tone}
            style={{ width: `${share(part.bytes, props.of)}%` }}
          />
        )}
      </For>
    </div>
  );
}

function UsageSummary(props: { used: number; limit: number; label: string }) {
  return (
    <div class="flex items-end justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <p class="text-[15px] leading-6 font-medium text-foreground tabular-nums">
          {rich("{used} <muted>of {limit}</muted>", {
            used: size(props.used),
            limit: size(props.limit),
            muted: (text) => <span class="text-sm text-muted-foreground">{text}</span>,
          })}
        </p>
        <p class="text-xs text-muted-foreground">{props.label}</p>
      </div>
      <p class="shrink-0 text-xs text-muted-foreground tabular-nums">{t("{size} available", { size: size(Math.max(0, props.limit - props.used)) })}</p>
    </div>
  );
}

function CloudUsageDetails(props: { usage: CloudUsage }) {
  const [, setParams] = useSearchParams();
  const free = () => props.usage.plan === "free";
  const planName = () => props.usage.plan.charAt(0).toUpperCase() + props.usage.plan.slice(1);
  const ratio = () => (props.usage.limit ? props.usage.used / props.usage.limit : 0);

  return (
    <>
      <UsageSummary
        used={props.usage.used}
        limit={props.usage.limit}
        label={t("{plan} plan", { plan: t(planName()) })}
      />
      <UsageBar
        of={props.usage.limit}
        full={ratio() >= 1}
        parts={PARTS.map((part) => ({ bytes: props.usage.parts[part.id], tone: part.tone }))}
      />
      <div class="flex flex-col gap-2 pt-1">
        <For each={PARTS}>
          {(part) => (
            <div class="flex items-center gap-2 text-xs">
              <span class={`size-2 shrink-0 rounded-full ${part.tone}`} />
              <span class="text-foreground">{t(part.label)}</span>
              <span class="min-w-0 flex-1 truncate text-muted-foreground">{t(part.hint)}</span>
              <span class="shrink-0 text-muted-foreground tabular-nums">{size(props.usage.parts[part.id])}</span>
            </div>
          )}
        </For>
      </div>
      <Show when={ratio() >= 0.9}>
        <p class="text-xs text-destructive">
          {ratio() >= 1
            ? t("Cloud storage is full. New files stay in this browser, and other browsers won't get them.")
            : t("Cloud storage is almost full.")}{" "}
          {t("Delete media or projects you're done with to make room.")}
        </p>
      </Show>
      <Show when={free()}>
        <div class="flex flex-col gap-3 border-t border-border-strong pt-3 sm:flex-row sm:items-center">
          <p class="min-w-0 flex-1 text-xs text-muted-foreground">{t("Creator comes with {limit} of cloud storage.", { limit: t(CREATOR_LIMIT) })}</p>
          <Button class="gap-0 pl-0 pr-2" onClick={() => setParams({ dashboard: "billing" }, { replace: true })}>
            <span class="grid h-7 w-6 place-items-center overflow-clip">
              <Icon name="upgrade" class="size-6" />
            </span>
            {t("Upgrade")}
          </Button>
        </div>
      </Show>
    </>
  );
}

function CloudStorageSection() {
  const [usage, { refetch }] = createResource(() => cloudEnabled || undefined, () => cloudUsage());

  return (
    <DashboardSurfaceSection
      title={t("Cloud storage")}
      description={t("Your media, posts and projects, in every browser you sign in to. Scheduled posts go out from here, so they still post if this browser is closed.")}
    >
      <Switch>
        <Match when={!cloudEnabled}>
          <p class="text-xs text-muted-foreground">
            {isDesktop()
              ? t("The desktop app keeps your projects on this computer, so nothing is stored in the cloud.")
              : t("Cloud storage is only on plan.video. It's off in local development.")}
          </p>
        </Match>
        <Match when={usage.error}>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p class="min-w-0 flex-1 text-xs text-muted-foreground">
              {usage.error instanceof Error && usage.error.message ? usage.error.message : t("Cloud storage isn't available right now.")}
            </p>
            <Button variant="secondary" onClick={() => void refetch()}>
              {t("Try again")}
            </Button>
          </div>
        </Match>
        <Match when={usage.state === "ready" && usage()}>{(current) => <CloudUsageDetails usage={current()} />}</Match>
        <Match when={usage.loading}>
          <div class="flex flex-col gap-3">
            <span class="h-6 w-40 animate-pulse rounded-md bg-accent" />
            <span class="h-2 w-full animate-pulse rounded-full bg-accent" />
          </div>
        </Match>
      </Switch>
    </DashboardSurfaceSection>
  );
}

export function DashboardStorageView() {
  return (
    <DashboardScrollView>
      <CloudStorageSection />
    </DashboardScrollView>
  );
}
