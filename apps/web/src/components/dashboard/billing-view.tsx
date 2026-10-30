/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Match, Show, Switch, createEffect, createSignal, on, onMount } from "solid-js";

import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { useAuth } from "@/context/auth";
import { syncPlan } from "@/lib/billing";
import { t } from "@/lib/i18n";
import { playEnter } from "@/lib/motion";

import { DashboardBillingInfoView } from "./billing-info-view";
import { DashboardInvoicesView } from "./invoices-view";
import { DashboardPlansView } from "./plans-view";

type BillingTab = "plans" | "billing" | "invoices";

type DashboardBillingTabButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

function DashboardBillingTabButton(props: DashboardBillingTabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      class="flex h-7 items-center rounded-md px-2 text-sm font-medium outline-none press focus-ring"
      classList={{
        "bg-(--plane-layer-transparent-active) text-(--plane-text-primary)": props.active,
        "text-(--plane-text-secondary) hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary)": !props.active,
      }}
    >
      <span class="cap-centered">{props.label}</span>
    </button>
  );
}

export function DashboardBillingView() {
  const auth = useAuth();
  const [tab, setTab] = createSignal<BillingTab>("plans");
  const activeTab = (): BillingTab => (auth.hasStripeCustomer() ? tab() : "plans");

  // Back from Stripe: read the new plan now rather than waiting for its webhook.
  // user_data then changes, and the app follows it.
  const [params] = useSearchParams();
  onMount(() => {
    if (params.checkout === "success") void syncPlan().catch(() => undefined);
  });

  // Each tab is a page of its own, so it comes in like one.
  let body: HTMLDivElement | undefined;
  createEffect(on(activeTab, () => playEnter(body), { defer: true }));

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardPageHeader
        nav={
          <Show when={auth.hasStripeCustomer()}>
            <div class="flex items-center gap-0.5" role="tablist" aria-label={t("Billing")}>
              <DashboardBillingTabButton label={t("Plans")} active={activeTab() === "plans"} onClick={() => setTab("plans")} />
              <DashboardBillingTabButton label={t("Billing")} active={activeTab() === "billing"} onClick={() => setTab("billing")} />
              <DashboardBillingTabButton label={t("Invoices")} active={activeTab() === "invoices"} onClick={() => setTab("invoices")} />
            </div>
          </Show>
        }
      />
      <div ref={body} class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-6 px-6 pb-6 pt-6">
          <Switch>
            <Match when={activeTab() === "plans"}>
              <DashboardPlansView />
            </Match>
            <Match when={activeTab() === "billing"}>
              <DashboardBillingInfoView onUpgrade={() => setTab("plans")} />
            </Match>
            <Match when={activeTab() === "invoices"}>
              <DashboardInvoicesView />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
