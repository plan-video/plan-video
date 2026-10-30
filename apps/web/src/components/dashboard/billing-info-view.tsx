/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource, type Accessor, type JSX } from "solid-js";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { SkeletonBar } from "@/components/dashboard/page-skeleton";
import { useAuth } from "@/context/auth";
import { billingAccount, openBillingPortal, type BillingAddress, type BillingInfo } from "@/lib/billing";

import { DashboardSocialAccounts } from "./social-accounts-section";
import { t } from "@/lib/i18n";

import {
  DashboardDividedStack,
  DashboardFreePlanDetails,
  DashboardInfoActionRow,
  DashboardProPlanDetails,
  DashboardPlanSummaryCard,
  DashboardSurfaceCard,
  DashboardSurfaceSection,
  type BillingSummarySource,
} from "./shared";

function capitalizeBrand(brand: string): string {
  if (!brand) return t("Card");
  return brand
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type DashboardBillingFreePlanCardProps = {
  onUpgrade?: () => void;
};

function DashboardBillingFreePlanCard(props: DashboardBillingFreePlanCardProps) {
  return (
    <DashboardSurfaceCard class="flex flex-col gap-4 md:flex-row md:items-center">
      <DashboardFreePlanDetails />

      <Button
        class="gap-0 pl-0 pr-2"
        onClick={props.onUpgrade}
      >
        <span class="grid h-7 w-6 place-items-center overflow-clip">
          <Icon name="upgrade" class="size-6" />
        </span>
        {t("Upgrade")}
      </Button>
    </DashboardSurfaceCard>
  );
}

type DashboardBillingCurrentPlanProps = {
  source: BillingSummarySource;
  onUpgrade?(): void;
};

function DashboardBillingCurrentPlan(props: DashboardBillingCurrentPlanProps) {
  const auth = useAuth();

  return (
    <section class="flex flex-col">
      <div class="flex h-9 items-center px-2">
        <h2 class="text-sm leading-5 font-medium text-foreground">
          {t("Current plan")}
        </h2>
      </div>

      <Show
        when={auth.isPro()}
        fallback={<DashboardBillingFreePlanCard onUpgrade={props.onUpgrade} />}
      >
        <DashboardPlanSummaryCard
          action={
            <Button variant="secondary" onClick={() => void openBillingPortal()}>
              {t("Manage plan")}
            </Button>
          }
        >
          <DashboardProPlanDetails source={props.source} />
        </DashboardPlanSummaryCard>
      </Show>

      <div class="flex h-11 items-center px-2 text-xs text-muted-foreground">
        <span>{t("Looking for enterprise features?")} </span>
        <a href="mailto:hello@plan.video" class="cursor-pointer text-primary hover:underline ml-0.5 focus-ring">
          {t("Contact sales")}
        </a>
      </div>
    </section>
  );
}

type DashboardBillingInfoRowProps = {
  title: string;
  actionLabel: string;
  flow?: "payment";
  loading: boolean;
  lines?: number;
  children: JSX.Element;
};

function DashboardBillingInfoRow(props: DashboardBillingInfoRowProps) {
  return (
    <DashboardInfoActionRow
      title={props.title}
      description={
        <Show when={!props.loading} fallback={<For each={Array.from({ length: props.lines ?? 1 })}>{(_, line) => <SkeletonBar class={line() ? "my-0.5 h-3 w-24" : "my-0.5 h-3 w-40"} />}</For>}>
          {props.children}
        </Show>
      }
      action={
        <Button variant="secondary" onClick={() => void openBillingPortal(props.flow)}>
          {props.actionLabel}
        </Button>
      }
      layout="responsive-md"
    />
  );
}

function addressLines(address: BillingAddress): string[] {
  const locality = [address.city, address.state, address.postalCode, address.country]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");

  return [address.legalName, address.line1, address.line2, locality].filter(Boolean);
}

type DashboardBillingInformationProps = {
  info: Accessor<BillingInfo | undefined>;
  loading: boolean;
};

function DashboardBillingInformation(props: DashboardBillingInformationProps) {
  const taxIdActionLabel = () => (props.info()?.taxId ? t("Update") : t("Add"));
  const paymentMethodText = () => {
    const pm = props.info()?.paymentMethod;
    if (!pm) return null;
    const exp = `${String(pm.expMonth).padStart(2, "0")}/${pm.expYear}`;
    return {
      summary: t("{brand} ending in {last4}", { brand: capitalizeBrand(pm.brand), last4: pm.last4 }),
      expires: t("Expires {date}", { date: exp }),
    };
  };
  const billingPeriodLabel = () => {
    const period = props.info()?.billingPeriod;
    if (period === "month") return t("Monthly");
    if (period === "year") return t("Yearly");
    return null;
  };

  return (
    <DashboardSurfaceSection title={t("Billing information")}>
      <DashboardDividedStack>
        <DashboardBillingInfoRow loading={props.loading} lines={2} title={t("Payment method")} actionLabel={t("Update")} flow="payment">
          <Show
            when={paymentMethodText()}
            fallback={<p>{t("No payment method on file")}</p>}
          >
            {(info) => (
              <>
                <p>{info().summary}</p>
                <p>{info().expires}</p>
              </>
            )}
          </Show>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow loading={props.loading} title={t("Billing period")} actionLabel={t("Update")}>
          <p>{billingPeriodLabel() ?? t("No active subscription")}</p>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow loading={props.loading} title={t("Billing email")} actionLabel={t("Update")}>
          <p>{props.info()?.email || t("Not provided")}</p>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow loading={props.loading} title={t("Tax ID")} actionLabel={taxIdActionLabel()}>
          <p>{props.info()?.taxId ?? t("Not provided")}</p>
        </DashboardBillingInfoRow>
        <DashboardBillingInfoRow loading={props.loading} title={t("Billing address")} actionLabel={t("Update")}>
          <Show
            when={props.info()?.address}
            fallback={<p>{t("No billing address on file")}</p>}
          >
            {(address) => (
              <For each={addressLines(address())}>
                {(line) => <p>{line}</p>}
              </For>
            )}
          </Show>
        </DashboardBillingInfoRow>
      </DashboardDividedStack>
    </DashboardSurfaceSection>
  );
}

type DashboardBillingInfoViewProps = {
  onUpgrade?(): void;
};

export function DashboardBillingInfoView(props: DashboardBillingInfoViewProps) {
  const auth = useAuth();

  const [account, { refetch }] = createResource(
    () => (auth.isPro() ? auth.accessLevel() : undefined),
    () => billingAccount().catch(() => null),
  );
  const loaded = () => account.state === "ready" || account.state === "refreshing";
  const summary = () => (loaded() ? account.latest?.summary ?? undefined : undefined);
  const info = (): BillingInfo | undefined => (loaded() ? account.latest?.info ?? undefined : undefined);

  return (
    <div class="flex flex-col gap-6">
      <DashboardBillingCurrentPlan source={{ loaded, summary }} onUpgrade={props.onUpgrade} />
      <DashboardSocialAccounts summary={summary()} onChanged={() => void refetch()} onUpgrade={props.onUpgrade} />
      <Show when={auth.isPro()}>
        <DashboardBillingInformation info={info} loading={!loaded()} />
      </Show>
    </div>
  );
}
