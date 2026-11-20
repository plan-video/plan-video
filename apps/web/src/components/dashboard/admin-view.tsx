/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createResource, type JSX } from "solid-js";

import { PlatformLogo } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import {
  NEAR,
  NETWORK_NAMES,
  agentSpend,
  attention,
  captionSpend,
  loadAgentUsage,
  loadReport,
  monthlyRevenue,
  networkSummaries,
  xSpend,
  type AdminReport,
  type AgentUsage,
  type Meter,
  type NetworkSummary,
} from "@/lib/admin";
import { intlLocale, t } from "@/lib/i18n";
import { planOfLevel } from "@/lib/plans";
import { formatBytes } from "@/lib/social-media";
import type { PlatformId } from "@/lib/social";

import { DashboardScrollView, DashboardSurfaceCard, DashboardSurfaceSection, DashboardTitledSection } from "./shared";

const count = (value: number) => new Intl.NumberFormat(intlLocale()).format(Math.round(value));
const usd = (value: number) => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "USD", maximumFractionDigits: value < 10 ? 2 : 0 }).format(value);
const time = (iso: string) => new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function Bar(props: { used: number; limit: number }) {
  const ratio = () => (props.limit > 0 ? props.used / props.limit : 0);
  return (
    <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span class={ratio() >= NEAR ? "bg-destructive" : "bg-primary"} style={{ width: `${Math.min(100, ratio() * 100)}%` }} />
    </div>
  );
}

function MeterRow(props: { meter: Meter }) {
  const value = () => (props.meter.unit === "percent" ? `${Math.round(props.meter.used)}%` : t("{used} of {limit}", { used: count(props.meter.used), limit: count(props.meter.limit) }));
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between gap-3 text-xs">
        <span class="min-w-0 truncate text-muted-foreground">{t(props.meter.label)}</span>
        <span class="shrink-0 text-foreground tabular-nums">{value()}</span>
      </div>
      <Bar used={props.meter.used} limit={props.meter.limit} />
    </div>
  );
}

function Row(props: { label: string; value: string; hint?: string }) {
  return (
    <div class="flex items-baseline justify-between gap-3 text-xs">
      <span class="min-w-0 text-muted-foreground">
        {props.label}
        <Show when={props.hint}>
          <span class="text-muted-foreground/70"> · {props.hint}</span>
        </Show>
      </span>
      <span class="shrink-0 text-foreground tabular-nums">{props.value}</span>
    </div>
  );
}

function NetworkCard(props: { network: NetworkSummary }) {
  const network = () => props.network;
  return (
    <DashboardSurfaceCard class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <PlatformLogo id={network().id as PlatformId} class="size-5" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{NETWORK_NAMES[network().id] ?? network().id}</span>
        <Show when={!network().configured}>
          <span class="shrink-0 text-xs text-muted-foreground">{t("Not set up")}</span>
        </Show>
      </div>
      <div class="flex flex-col gap-1">
        <Row label={t("Calls today")} value={count(network().calls)} />
        <Row label={t("Failed or no answer")} value={count(network().failed)} />
        <Row label={t("Refused for a limit")} value={count(network().limited)} />
        <Row label={t("Posts in 24 hours")} value={t("{sent} sent, {failed} failed", { sent: count(network().sent), failed: count(network().failedPosts) })} />
        <Row label={t("Waiting to send")} value={count(network().waiting)} />
      </div>
      <Show when={network().meters.length}>
        <div class="flex flex-col gap-2.5 border-t border-border-strong pt-3">
          <For each={network().meters}>{(meter) => <MeterRow meter={meter} />}</For>
        </div>
      </Show>
    </DashboardSurfaceCard>
  );
}

function CostsSection(props: { report: AdminReport; agent: AgentUsage | null }) {
  const x = () => xSpend(props.report);
  const captions = () => captionSpend(props.report);
  const fixed = () => props.report.costs.reduce((total, cost) => total + cost.usd, 0);
  const total = () => x() + captions() + fixed();
  const revenue = () => monthlyRevenue(props.report.plans);
  return (
    <DashboardSurfaceSection title={t("Costs this month")} description={t("Estimated from what plan.video counted, at each provider's list price. Check the providers' own dashboards for the bill.")}>
      <div class="flex flex-col gap-1">
        <Row label={t("X posts")} hint={t("{posts} posts, {links} with links", { posts: count(props.report.x_posts_month), links: count(props.report.x_links_month) })} value={usd(x())} />
        <Row label={t("Auto-captions")} hint={t("{hours} hours", { hours: (Number(props.report.caption_seconds_month) / 3600).toFixed(1) })} value={usd(captions())} />
        <For each={props.report.costs}>{(cost) => <Row label={cost.name} value={usd(cost.usd)} />}</For>
      </div>
      <div class="flex flex-col gap-1 border-t border-border-strong pt-3">
        <Row label={t("Total so far")} value={usd(total())} />
        <Row label={t("Paid plans, a month")} hint={t("if everyone paid monthly")} value={usd(revenue())} />
      </div>
      <Show when={!props.report.costs.length}>
        <p class="text-xs text-muted-foreground">{t("Add fixed costs such as the server with ADMIN_MONTHLY_COSTS in publisher.env, like Server=8,Database=25.")}</p>
      </Show>
      <div class="flex flex-col gap-2.5 border-t border-border-strong pt-3">
        <Show
          when={props.agent}
          fallback={<p class="text-xs text-muted-foreground">{t("The Assistant's spending isn't available: the Assistant service didn't answer.")}</p>}
        >
          {(agent) => (
            <>
              <MeterRow meter={{ label: t("Assistant, share of today's spending cap"), used: agent().budget ? (agent().spent / agent().budget) * 100 : 0, limit: 100, unit: "percent" }} />
              <Row label={t("Assistant today, in dollars")} hint={t("cap {cap}", { cap: usd((agent().budget / 1_000_000) * agent().usdPerMillion) })} value={usd(agentSpend(agent()))} />
            </>
          )}
        </Show>
      </div>
    </DashboardSurfaceSection>
  );
}

function CapsSection(props: { report: AdminReport }) {
  const cap = (table: Record<string, number>, level: number) => table[String(level)] ?? 0;
  return (
    <DashboardSurfaceSection title={t("Closest to their X caps")} description={t("Posts each owner sent to X in the last 30 days, against their plan's cap.")}>
      <Show when={props.report.x_owners.length} fallback={<p class="text-xs text-muted-foreground">{t("Nobody has posted to X in the last 30 days.")}</p>}>
        <For each={props.report.x_owners}>
          {(owner) => (
            <div class="flex flex-col gap-1.5">
              <div class="flex items-baseline justify-between gap-3 text-xs">
                <span class="min-w-0 truncate text-muted-foreground">
                  <span class="font-mono">{owner.user_id.slice(0, 8)}</span> · {t(planOfLevel(owner.level).name)}
                </span>
                <span class="shrink-0 text-foreground tabular-nums">
                  {t("{posts} of {cap} posts, {links} of {linkCap} with links", {
                    posts: count(owner.posts),
                    cap: count(cap(props.report.caps.xPostsByLevel, owner.level)),
                    links: count(owner.links),
                    linkCap: count(cap(props.report.caps.xLinksByLevel, owner.level)),
                  })}
                </span>
              </div>
              <Bar used={owner.posts} limit={cap(props.report.caps.xPostsByLevel, owner.level)} />
            </div>
          )}
        </For>
      </Show>
    </DashboardSurfaceSection>
  );
}

function PeopleSection(props: { report: AdminReport }) {
  return (
    <DashboardSurfaceSection title={t("People")}>
      <div class="flex flex-col gap-1">
        <Row label={t("Accounts")} value={count(props.report.people)} />
        <Row label={t("New this week")} value={count(props.report.people_week)} />
        <For each={[1, 2, 3, 4]}>{(level) => <Row label={t(planOfLevel(level).name)} value={count(props.report.plans[String(level)] ?? 0)} />}</For>
      </div>
      <div class="flex flex-col gap-1 border-t border-border-strong pt-3">
        <Row label={t("Database size")} value={formatBytes(Number(props.report.database_bytes))} />
        <Row label={t("YouTube uploads today")} value={count(props.report.youtube_uploads_today)} />
      </div>
    </DashboardSurfaceSection>
  );
}

function Report(props: { report: AdminReport; agent: AgentUsage | null; refresh: JSX.Element }) {
  const networks = () => networkSummaries(props.report);
  const warnings = () => attention(props.report, networks(), props.agent);
  return (
    <>
      <DashboardTitledSection title={t("Needs attention")} description={t("Updated {time}.", { time: time(props.report.at) })} action={props.refresh}>
        <DashboardSurfaceCard class="flex flex-col gap-2">
          <Show when={warnings().length} fallback={<p class="text-xs text-muted-foreground">{t("Nothing is near a limit, late or failing.")}</p>}>
            <For each={warnings()}>{(warning) => <p class="text-xs text-destructive">{warning}</p>}</For>
          </Show>
        </DashboardSurfaceCard>
      </DashboardTitledSection>
      <DashboardTitledSection
        title={t("Networks")}
        description={t("Calls plan.video made to each network today, and the limits they report. YouTube's day starts at midnight Pacific time; the others' at midnight UTC.")}
      >
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <For each={networks()}>{(network) => <NetworkCard network={network} />}</For>
        </div>
      </DashboardTitledSection>
      <CostsSection report={props.report} agent={props.agent} />
      <CapsSection report={props.report} />
      <PeopleSection report={props.report} />
    </>
  );
}

export function DashboardAdminView() {
  const [data, { refetch }] = createResource(async () => {
    const [report, agent] = await Promise.all([loadReport(), loadAgentUsage()]);
    return { report, agent };
  });
  const refresh = (
    <Button variant="secondary" disabled={data.loading} onClick={() => void refetch()}>
      {t("Refresh")}
    </Button>
  );

  return (
    <DashboardScrollView>
      <Switch>
        <Match when={data.error}>
          <DashboardSurfaceCard class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p class="min-w-0 flex-1 text-xs text-muted-foreground">{data.error instanceof Error && data.error.message ? data.error.message : t("The admin page isn't available right now.")}</p>
            {refresh}
          </DashboardSurfaceCard>
        </Match>
        <Match when={data.latest}>{(current) => <Report report={current().report} agent={current().agent} refresh={refresh} />}</Match>
        <Match when={data.loading}>
          <div class="flex flex-col gap-3">
            <span class="h-6 w-40 animate-pulse rounded-md bg-accent" />
            <span class="h-40 w-full animate-pulse rounded-lg bg-accent" />
          </div>
        </Match>
      </Switch>
    </DashboardScrollView>
  );
}
