/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createEffect, createResource, onMount, type JSX } from "solid-js";

import { hydrateCalendar, scheduledLimitHere, waitingByAccount } from "@/components/calendar/store";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { cloudEnabled, cloudUsage } from "@/lib/cloud-storage";
import { intlLocale, t } from "@/lib/i18n";
import { accountsLimit, planOfLevel } from "@/lib/plans";
import { publisherUsage, type PublisherUsage } from "@/lib/publishing";
import { accountLabel, connectedAccountCount, loadSocialConnections, socialConnections, type SocialConnection } from "@/lib/social-connections";
import { formatBytes } from "@/lib/social-media";
import { supabase } from "@/lib/supabase";
import { activeScope } from "@/lib/workspaces";

import { DashboardScrollView, DashboardSurfaceSection } from "./shared";

const DAY_MS = 24 * 60 * 60_000;

const count = (value: number) => new Intl.NumberFormat(intlLocale()).format(value);

function duration(seconds: number) {
  const unit = (value: number, name: string) => new Intl.NumberFormat(intlLocale(), { style: "unit", unit: name, unitDisplay: "short", maximumFractionDigits: 1 }).format(value);
  return seconds < 3600 ? unit(Math.floor(seconds / 60), "minute") : unit(Math.floor(seconds / 360) / 10, "hour");
}

function bytes(value: number) {
  return value >= 1e9 ? new Intl.NumberFormat(intlLocale(), { style: "unit", unit: "gigabyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(value / 1e9) : formatBytes(value);
}

function freesUp(iso: string) {
  const at = new Date(iso);
  if (at.getTime() - Date.now() < DAY_MS) return t("One frees up at {time}", { time: new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" }).format(at) });
  return t("One frees up on {date}", { date: new Intl.DateTimeFormat(intlLocale(), { weekday: "short", month: "short", day: "numeric" }).format(at) });
}

/** UTC months, as services/transcribe keys caption_usage. */
const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

function nextMonth() {
  const now = new Date();
  return new Intl.DateTimeFormat(intlLocale(), { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
}

async function captionSeconds(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.from("caption_usage").select("seconds").eq("user_id", userId).eq("month", thisMonth()).maybeSingle();
  if (error) throw error;
  return Number(data?.seconds ?? 0);
}

function Bar(props: { used: number; most: number }) {
  const share = () => (props.most > 0 ? Math.min(100, (props.used / props.most) * 100) : 0);
  return (
    <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span class={props.used >= props.most ? "bg-destructive" : "bg-primary"} style={{ width: `${share()}%` }} />
    </div>
  );
}

function UsageRow(props: { label: JSX.Element; hint?: string; used: number; most: number; value?: string; note?: string | null }) {
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-3 text-xs">
        <span class="flex min-w-0 items-center gap-2">
          <span class={props.hint ? "shrink-0 text-foreground" : "min-w-0 truncate text-foreground"}>{props.label}</span>
          <Show when={props.hint}>
            <span class="min-w-0 truncate text-muted-foreground">{props.hint}</span>
          </Show>
        </span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{props.value ?? t("{used} of {limit}", { used: count(props.used), limit: count(props.most) })}</span>
      </div>
      <Bar used={props.used} most={props.most} />
      <Show when={props.note}>
        <p class={props.used >= props.most ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{props.note}</p>
      </Show>
    </div>
  );
}

function UpgradeRow(props: { text: string }) {
  const [, setParams] = useSearchParams();
  return (
    <div class="flex flex-col gap-3 border-t border-border-strong pt-3 sm:flex-row sm:items-center">
      <p class="min-w-0 flex-1 text-xs text-muted-foreground">{props.text}</p>
      <Button class="gap-0 pl-0 pr-2" onClick={() => setParams({ dashboard: "billing" })}>
        <span class="grid h-7 w-6 place-items-center overflow-clip">
          <Icon name="upgrade" class="size-6" />
        </span>
        {t("Upgrade")}
      </Button>
    </div>
  );
}

function AccountName(props: { account: SocialConnection }) {
  return (
    <span class="flex min-w-0 items-center gap-2 text-foreground">
      <AccountAvatar account={props.account} class="size-4" />
      <span class="min-w-0 truncate">{accountLabel(props.account) || props.account.platform}</span>
    </span>
  );
}

function ScheduledSection(props: { free: boolean }) {
  onMount(() => void hydrateCalendar());
  const limit = scheduledLimitHere;
  const waiting = () => waitingByAccount();

  return (
    <DashboardSurfaceSection
      title={t("Scheduled posts")}
      description={
        limit() !== undefined
          ? t("Each account can have {count} scheduled posts waiting at a time. When one goes out, there's room for another.", { count: limit()! })
          : activeScope()
            ? t("This workspace is on its owner's plan.")
            : t("Your plan has no limit on scheduled posts.")
      }
    >
      <Show
        when={limit()}
        fallback={
          <For each={socialConnections()} fallback={<p class="text-xs text-muted-foreground">{t("Connect an account in Connections to start scheduling.")}</p>}>
            {(account) => (
              <div class="flex items-center justify-between gap-3 text-xs">
                <AccountName account={account} />
                <span class="shrink-0 text-muted-foreground tabular-nums">{t("{count} waiting", { count: count(waiting().get(account.id) ?? 0) })}</span>
              </div>
            )}
          </For>
        }
      >
        {(most) => (
          <>
            <For each={socialConnections()} fallback={<p class="text-xs text-muted-foreground">{t("Connect an account in Connections to start scheduling.")}</p>}>
              {(account) => (
                <UsageRow
                  label={<AccountName account={account} />}
                  used={waiting().get(account.id) ?? 0}
                  most={most()}
                  note={(waiting().get(account.id) ?? 0) >= most() ? t("Full. Schedule more once one goes out, or use Post now.") : null}
                />
              )}
            </For>
            <Show when={props.free}>
              <UpgradeRow text={t("Creator has no limit on scheduled posts, and can post to X.")} />
            </Show>
          </>
        )}
      </Show>
    </DashboardSurfaceSection>
  );
}

function NetworksSection(props: { usage: PublisherUsage }) {
  const usage = () => props.usage;
  const note = (counted: { used: number; most: number; freesAt: string | null }) => (counted.most && counted.used >= counted.most && counted.freesAt ? freesUp(counted.freesAt) : null);
  return (
    <>
      <UsageRow label="YouTube" hint={t("uploads, last 24 hours")} used={usage().youtube.used} most={usage().youtube.most} note={note(usage().youtube)} />
      <Show
        when={usage().x.posts.most > 0}
        fallback={
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="text-foreground">X</span>
            <span class="text-muted-foreground">{t("Needs a paid plan")}</span>
          </div>
        }
      >
        <UsageRow label="X" hint={t("posts, last 30 days")} used={usage().x.posts.used} most={usage().x.posts.most} note={note(usage().x.posts)} />
        <UsageRow label="X" hint={t("posts with a link, last 30 days")} used={usage().x.links.used} most={usage().x.links.most} note={note(usage().x.links)} />
        <UsageRow label="X" hint={t("posts, last 24 hours")} used={usage().x.today.used} most={usage().x.today.most} note={note(usage().x.today)} />
      </Show>
    </>
  );
}

export function DashboardUsageView() {
  const auth = useAuth();
  const userId = () => auth.user()?.id;
  createEffect(() => loadSocialConnections(userId()));

  const plan = () => planOfLevel(auth.accessLevel());
  const free = () => auth.accessLevel() <= 1;
  const [network, { refetch }] = createResource(userId, () => publisherUsage());
  const [captions] = createResource(userId, (id) => captionSeconds(id).catch(() => null));
  const [storage] = createResource(() => cloudEnabled || undefined, () => cloudUsage().catch(() => null));

  return (
    <DashboardScrollView>
        <ScheduledSection free={free()} />

        <DashboardSurfaceSection title={t("Posting limits")} description={t("YouTube and X limit how often plan.video can post for you. These count every workspace you own.")}>
          <Switch>
            <Match when={network.error}>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <p class="min-w-0 flex-1 text-xs text-muted-foreground">{network.error instanceof Error && network.error.message ? network.error.message : t("Usage isn't available right now.")}</p>
                <Button variant="secondary" onClick={() => void refetch()}>
                  {t("Try again")}
                </Button>
              </div>
            </Match>
            <Match when={network.latest}>{(usage) => <NetworksSection usage={usage()} />}</Match>
            <Match when={network.loading}>
              <span class="h-6 w-full animate-pulse rounded-md bg-accent" />
            </Match>
          </Switch>
        </DashboardSurfaceSection>

        <DashboardSurfaceSection title={t("{plan} plan", { plan: t(plan().name) })}>
          <Show when={userId()}>
            {(id) => (
              <Show when={accountsLimit()}>
                {(most) => <UsageRow label={t("Social accounts")} hint={t("all workspaces")} used={connectedAccountCount(id())} most={most()} />}
              </Show>
            )}
          </Show>
          <Show when={storage.latest}>
            {(current) => (
              <UsageRow
                label={t("Cloud storage")}
                used={current().used}
                most={current().limit}
                value={t("{used} of {limit}", { used: bytes(current().used), limit: bytes(current().limit) })}
              />
            )}
          </Show>
          <Show when={captions.latest !== undefined && captions.latest !== null}>
            <UsageRow
              label={t("Auto-captions")}
              hint={t("this month")}
              used={captions.latest ?? 0}
              most={plan().captionHours * 3600}
              value={t("{used} of {limit}", { used: duration(captions.latest ?? 0), limit: duration(plan().captionHours * 3600) })}
              note={t("Resets on {date}", { date: nextMonth() })}
            />
          </Show>
        </DashboardSurfaceSection>
    </DashboardScrollView>
  );
}
