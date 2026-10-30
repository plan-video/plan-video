/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Separator } from "@/components/ui/separator";
import { cx } from "@/lib/cva";
import { intlLocale, t } from "@/lib/i18n";
import { useAuth } from "@/context/auth";
import {
  TOPUP_CREDIT_TIERS,
  getTopupPrice,
  startTopupCheckout,
} from "@/lib/checkout";

import {
  DashboardFeatureRow,
  DashboardLabelValue,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";
import type { TopupCredits } from "@plan.video/api-contract";

function DashboardProPlanFeatures() {
  return (
    <>
      <DashboardFeatureRow label={t("Analyze & transcribe footage")} />
      <DashboardFeatureRow label={t("Generate video, images & voice")} />
      <DashboardFeatureRow label={t("Auto generated subtitles")} />
      <DashboardFeatureRow label={t("Top up credits anytime")} />
    </>
  );
}

function formatCredits(value: number): string {
  return value.toLocaleString(intlLocale());
}

function parseTierCredits(tier: TopupCredits): number {
  return parseInt(tier.replace("_", ""), 10);
}

function formatPercent(used: number, total: number): string {
  if (total <= 0) return t("{percent}% used", { percent: 0 });
  const percent = Math.min(100, Math.max(0, (used / total) * 100));
  return t("{percent}% used", { percent: Number(percent.toFixed(1)) });
}

function progressWidth(used: number, total: number): string {
  if (total <= 0) return "0%";
  const percent = Math.min(100, Math.max(0, (used / total) * 100));
  return `${percent}%`;
}

type DashboardProgressSectionProps = {
  label: string;
  valueLabel: string;
  used: number;
  total: number;
  footerLabel: string;
};

function DashboardProgressSection(props: DashboardProgressSectionProps) {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2 text-xs">
        <p class="min-w-0 flex-1 text-foreground">{props.label}</p>
        <p class="shrink-0 text-right text-muted-foreground">{props.valueLabel}</p>
      </div>

      <div class="py-2">
        <div class="h-3 w-full overflow-hidden rounded-full bg-input">
          <div
            class="h-full rounded-full bg-primary"
            style={{ width: progressWidth(props.used, props.total) }}
          />
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs   text-muted-foreground">
        <p class="min-w-0 flex-1">{props.footerLabel}</p>
        <p class="shrink-0 text-right">{formatPercent(props.used, props.total)}</p>
      </div>
    </div>
  );
}

function DashboardAiCreditsTopUpSection() {
  const [selected, setSelected] = createSignal<TopupCredits>();
  const [loading, setLoading] = createSignal(false);

  const handleCheckout = async () => {
    const tier = selected();
    if (!tier || loading()) return;
    setLoading(true);
    try {
      await startTopupCheckout(tier);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardSurfaceSection title={t("Top up")}>
      <div class="flex flex-col gap-4 sm:flex-row">
        <p class="min-w-0 flex-1 text-muted-foreground text-xs">
          {t("Add credits to your account at any time when your balance runs out.")}
        </p>
        <Button
          onClick={handleCheckout}
          disabled={loading() || !selected()}
          variant="secondary"
        >
          {t("Checkout")}
        </Button>
      </div>

      <Separator />

      <div role="radiogroup" class="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <For each={TOPUP_CREDIT_TIERS}>
          {(tier) => {
            const isSelected = () => selected() === tier;
            return (
              <div
                role="radio"
                tabIndex={0}
                aria-checked={isSelected()}
                onClick={() => setSelected(tier)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(tier);
                  }
                }}
                class={cx(
                  "flex flex-col gap-0.5 rounded-md border p-3 outline-none depth-card focus-ring",
                  isSelected() ? "border-primary" : "border-input hover:border-(--border-input)",
                )}
              >
                <span class="text-xs text-foreground">
                  {t("{count, plural, other {{credits} credits}}", { count: parseTierCredits(tier), credits: formatCredits(parseTierCredits(tier)) })}
                </span>
                <span class="text-xs text-muted-foreground">
                  ${getTopupPrice(tier)}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </DashboardSurfaceSection>
  );
}

function DashboardAiCreditsNeedMoreSection() {
  const [, setParams] = useSearchParams();
  const goToBilling = () =>
    setParams({ dashboard: "billing" }, { replace: true });

  return (
    <DashboardSurfaceSection title={t("Need more?")}>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
        <DashboardLabelValue
          label={t("Keep creating without interruptions")}
          value={t("Flexible credit tiers, top ups on demand, and the full Pro experience.")}
        />
        <Button class="gap-0 pl-0 pr-2" onClick={goToBilling}>
          <span class="grid h-7 w-6 place-items-center overflow-clip">
            <Icon name="upgrade" class="size-6" />
          </span>
          {t("Go Pro")}
        </Button>
      </div>

      <Separator />

      <div class="flex flex-col gap-2">
        <p class="text-muted-foreground text-xs">
          {t("Everything in Free, plus:")}
        </p>
        <DashboardProPlanFeatures />
      </div>
    </DashboardSurfaceSection>
  );
}

export function DashboardAiCreditsView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const goToBilling = () =>
    setParams({ dashboard: "billing" }, { replace: true });

  const isPro = () => auth.isPro();
  const total = () => auth.creditLimit();
  const remaining = () => auth.remainingCredits();
  const used = () => Math.max(0, total() - remaining());

  const resetLabel = () => {
    const reset = auth.nextCreditReset();
    if (!reset) return t("Resets monthly");
    const days = Math.max(0, Math.ceil((reset.getTime() - Date.now()) / 86_400_000));
    const date = reset.toLocaleDateString(intlLocale(), { month: "long", day: "numeric" });
    return t("Resets in {days, plural, one {# day} other {# days}} - {date}", { days, date });
  };
  const creditLimitLabel = () =>
    isPro()
      ? t("{count, plural, other {{credits} credits/mo}}", { count: total(), credits: formatCredits(total()) })
      : t("{count, plural, other {{credits} trial credits}}", { count: total(), credits: formatCredits(total()) });
  const creditUsageLabel = () =>
    `${formatCredits(used())} / ${formatCredits(total())}`;

  return (
    <DashboardScrollView>
      <DashboardSurfaceSection title={t("AI credits")}>
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
          <DashboardLabelValue label={t("Credit subscription")} value={creditLimitLabel()} />
          <Show when={!isPro()}>
            <Button variant="secondary" onClick={goToBilling}>
              {t("Upgrade plan")}
            </Button>
          </Show>
        </div>

        <Separator />

        <DashboardProgressSection
          label={t("Usage")}
          valueLabel={creditUsageLabel()}
          used={used()}
          total={total()}
          footerLabel={isPro() ? resetLabel() : t("One time only")}
        />
      </DashboardSurfaceSection>

      <Show when={isPro()}>
        <DashboardAiCreditsTopUpSection />
      </Show>
      <Show when={!isPro()}>
        <DashboardAiCreditsNeedMoreSection />
      </Show>
    </DashboardScrollView>
  );
}
