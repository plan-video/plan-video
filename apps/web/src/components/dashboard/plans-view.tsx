/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource, createSignal, type JSX } from "solid-js";
import { toast } from "somoto";

import { Segmented } from "@/components/publish/controls";
import { CARD_COLORS, CARD_DEEP, cardColor, type CardColor } from "@/lib/card-colors";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { billingAccount, keepPlan, openBillingPortal, startCheckout, type PaidPlan } from "@/lib/billing";
import { dashboardTheme } from "@/lib/dashboard-theme";
import { msg, t } from "@/lib/i18n";
import { PLANS, YEARLY_SAVING, planOfLevel, priceNote, type Billing, type Plan } from "@/lib/plans";
import { zonedFormat } from "@/lib/time-zone";

const BILLING_OPTIONS: readonly { id: Billing; label: string; badge?: string }[] = [
  { id: "monthly", label: msg("Monthly") },
  { id: "yearly", label: msg("Yearly"), badge: YEARLY_SAVING },
];

/** Same order as PLANS. */
const PLAN_COLORS: CardColor[] = ["sky", "lavender", "peach", "green"];

const LIST_ROWS = Math.max(...PLANS.map((plan) => plan.features.length));

const FULL_DATE = zonedFormat({ month: "long", day: "numeric", year: "numeric" });
const DAY = zonedFormat({ month: "long", day: "numeric" });

type Choice = { plan: Plan; billing: Billing };

export function DashboardPlansView() {
  const auth = useAuth();
  const [billing, setBilling] = createSignal<Billing>("monthly");
  // Which button is busy, so a second click doesn't start another checkout.
  const [leaving, setLeaving] = createSignal<string>();
  // Kept while the dialog fades out, so its words don't empty.
  const [confirming, setConfirming] = createSignal<Choice>();
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  // Frozen as asked, so the words hold while the dialog closes.
  const [chargeNow, setChargeNow] = createSignal(false);

  const [account, { refetch }] = createResource(
    () => (auth.accessLevel() > 1 ? auth.accessLevel() : undefined),
    () => billingAccount().catch(() => null),
  );
  // Read through `latest`, so the cards stay on screen while it's read again.
  const loaded = () => account.state === "ready" || account.state === "refreshing";
  const summary = () => (auth.accessLevel() > 1 && loaded() ? account.latest?.summary ?? undefined : undefined);
  const waiting = () => auth.accessLevel() > 1 && !loaded();
  const currentBilling = (): Billing | undefined => {
    const period = summary()?.billingPeriod;
    return period === "year" ? "yearly" : period === "month" ? "monthly" : undefined;
  };
  const currentName = () => t(planOfLevel(auth.accessLevel()).name);
  const renewal = () => summary()?.currentPeriodEnd;

  const go = async (id: string, run: () => Promise<unknown>) => {
    if (leaving()) return;
    setLeaving(id);
    try {
      await run();
    } finally {
      setLeaving(undefined);
    }
  };

  /** Stripe's confirm page can't move both lines (Agency extras to yearly), so it's charged and confirmed here. */
  const chargedHere = (choice: Choice) =>
    choice.plan.id === "agency" && summary()?.plan === "agency" && (summary()?.extraAccounts ?? 0) > 0 && choice.billing === "yearly" && currentBilling() === "monthly";

  const choose = (choice: Choice, downgrade: boolean) => {
    if (choice.plan.id === "free") return void go("free", () => openBillingPortal("cancel"));
    if (downgrade || chargedHere(choice)) {
      setConfirming(choice);
      setChargeNow(!downgrade);
      setConfirmOpen(true);
      return;
    }
    void go(choice.plan.id, () => startCheckout(choice.plan.id as PaidPlan, choice.billing));
  };

  const confirmSwitch = () => {
    const choice = confirming();
    if (!choice) return;
    void go("confirm", async () => {
      const done = await startCheckout(choice.plan.id as PaidPlan, choice.billing);
      if (!done) return;
      if (done.updated) toast.success(t("Switched to yearly billing"));
      await refetch();
      setConfirmOpen(false);
    });
  };

  const keep = () =>
    void go("keep", async () => {
      try {
        await keepPlan();
        await refetch();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("Couldn't keep your plan. Try again in a moment."));
      }
    });

  const pending = (): { text: string; keep: string } | undefined => {
    const now = summary();
    if (!now) return undefined;
    if (now.scheduled) {
      const date = FULL_DATE.format(now.scheduled.at);
      if (now.scheduled.plan === now.plan) return { text: t("Switches to monthly billing on {date}.", { date }), keep: t("Keep yearly billing") };
      const next = PLANS.find((plan) => plan.id === now.scheduled!.plan);
      return { text: t("Switches to {plan} on {date}.", { plan: t(next?.name ?? now.scheduled.plan), date }), keep: t("Keep {plan}", { plan: currentName() }) };
    }
    if (now.cancelAtPeriodEnd) return { text: t("Your plan ends on {date}.", { date: FULL_DATE.format(now.currentPeriodEnd) }), keep: t("Keep it") };
    return undefined;
  };

  return (
    <div class="@container flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented label={t("Billing")} options={BILLING_OPTIONS} value={billing()} onChange={setBilling} class="w-fit" />
        <Show when={pending()}>
          {(line) => (
            <>
              <span class="flex-1" />
              <span class="text-xs text-muted-foreground">
                {line().text}{" "}
                <button type="button" class="text-primary hover:underline focus-ring disabled:opacity-50" disabled={!!leaving()} onClick={keep}>
                  {line().keep}
                </button>
              </span>
            </>
          )}
        </Show>
      </div>

      <div class="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
        <For each={PLANS}>
          {(plan, index) => {
            const level = index() + 1;
            const color = PLAN_COLORS[index()]!;
            const current = () => auth.accessLevel();
            const isCurrent = () => level === current() && (level === 1 || !currentBilling() || billing() === currentBilling());
            const downgrade = () => level < current() || (level === current() && level > 1 && billing() === "monthly" && currentBilling() === "yearly");
            const starts = () => {
              const now = summary();
              if (!now) return undefined;
              if (level === 1) return now.cancelAtPeriodEnd ? now.currentPeriodEnd : undefined;
              return now.scheduled && now.scheduled.plan === plan.id && now.scheduled.billing === billing() ? now.scheduled.at : undefined;
            };
            const label = () => {
              if (isCurrent()) return t("Current plan");
              const at = starts();
              if (at !== undefined) return t("Starts {date}", { date: DAY.format(at) });
              if (level === current()) return billing() === "yearly" ? t("Switch to yearly") : t("Switch to monthly");
              if (level === 1) return t("Downgrade to Free");
              const name = t(plan.name);
              return level > current() ? t("Upgrade to {plan}", { plan: name }) : t("Downgrade to {plan}", { plan: name });
            };
            const disabled = () => isCurrent() || starts() !== undefined || !!leaving() || (downgrade() && level > 1 && !renewal());

            return (
              <PlanCard
                plan={plan}
                color={color}
                billing={billing()}
                label={label()}
                filled={level > current()}
                disabled={disabled()}
                loading={waiting() && level <= current()}
                pending={leaving() === plan.id || (level === 1 && leaving() === "free")}
                onChoose={() => choose({ plan, billing: billing() }, downgrade())}
              />
            );
          }}
        </For>
      </div>

      <AlertDialog open={confirmOpen()} onOpenChange={(open) => !leaving() && setConfirmOpen(open)}>
        <AlertDialogContent>
          <Show when={confirming()}>
            {(choice) => {
              const sameBilling = () => choice().plan.id === summary()?.plan;
              const charged = chargeNow;
              const date = () => (renewal() ? FULL_DATE.format(renewal()!) : "");
              const price = () => `$${choice().plan.price[choice().billing]}`;
              return (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {charged() ? t("Switch to yearly billing?") : sameBilling() ? t("Switch to monthly billing?") : t("Switch to {plan}?", { plan: t(choice().plan.name) })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {charged()
                        ? t("Agency and your {count} extra social accounts move to yearly billing now. You're charged for the year today, less what's left of this month.", { count: summary()?.extraAccounts ?? 0 })
                        : sameBilling()
                        ? t("You keep yearly billing until {date}. {plan} then costs {price}/mo, billed monthly.", { date: date(), plan: t(choice().plan.name), price: price() })
                        : choice().billing === "yearly"
                          ? t("You keep {current} until {date}. {plan} starts then at {price}/mo, billed yearly.", { current: currentName(), date: date(), plan: t(choice().plan.name), price: price() })
                          : t("You keep {current} until {date}. {plan} starts then at {price}/mo.", { current: currentName(), date: date(), plan: t(choice().plan.name), price: price() })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button variant="secondary" disabled={!!leaving()} onClick={() => setConfirmOpen(false)}>
                      {t("Cancel")}
                    </Button>
                    <Button disabled={!!leaving()} aria-busy={leaving() === "confirm"} onClick={confirmSwitch}>
                      {charged() ? t("Switch to yearly") : t("Switch on {date}", { date: renewal() ? DAY.format(renewal()!) : "" })}
                    </Button>
                  </AlertDialogFooter>
                </>
              );
            }}
          </Show>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Check(props: { class?: string }) {
  return (
    <svg viewBox="0 0 16 16" class={`size-3.5 shrink-0 ${props.class ?? ""}`} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

const LIST_LINE = "px-4";

function PlanCard(props: {
  plan: Plan;
  color: CardColor;
  billing: Billing;
  label: string;
  filled: boolean;
  disabled: boolean;
  loading: boolean;
  pending: boolean;
  onChoose: () => void;
}) {
  const ink = (): JSX.CSSProperties => ({ "--plan-ink": dashboardTheme() === "light" ? CARD_DEEP[props.color] : CARD_COLORS[props.color] });

  return (
    // One grid row each for the colour, the list heading, every line of the longest list and the end, so lines sit level across cards.
    <article
      class="grid grid-rows-subgrid gap-y-0 rounded-xl border border-(--plane-border-subtle-1) bg-(--plane-layer-1) p-1.5"
      style={{ ...ink(), "grid-row": `span ${LIST_ROWS + 3}` }}
    >
      <div class="flex flex-col rounded-lg p-4 text-[#0a0a0a]" style={cardColor(props.color)}>
        <div class="flex h-6 items-center justify-between gap-3">
          <h2 class="text-[15px] leading-6 font-medium">{t(props.plan.name)}</h2>
          <Show when={props.plan.popular}>
            <span class="rounded-[5px] bg-[#000]/[0.08] px-1.5 text-[11px] leading-5 text-[#000]/70">{t("Popular")}</span>
          </Show>
        </div>
        <p class="mt-0.5 min-h-10 text-[13px] leading-5 text-[#000]/65">{t(props.plan.text)}</p>

        <p class="mt-5 flex items-baseline gap-1">
          <span class="text-[36px] leading-none font-normal tracking-[-0.03em] tabular-nums">${props.plan.price[props.billing]}</span>
          <span class="text-[13px] text-[#000]/55">{t("/mo")}</span>
        </p>
        <p class="mt-2 text-xs leading-4 text-[#000]/55">{priceNote(props.plan, props.billing)}</p>

        <div class="mt-auto pt-5">
          <button
            type="button"
            class="press inline-flex h-8 w-full items-center justify-center rounded-md px-2 text-[13px] font-medium transition-colors focus-ring disabled:pointer-events-none"
            classList={{
              "bg-[#0a0a0a] text-[#fff] hover:bg-[#000]/80 disabled:bg-[#000]/45": props.filled && !props.loading,
              "bg-[#000]/[0.08] text-[#0a0a0a] hover:bg-[#000]/[0.14] disabled:text-[#000]/45": !props.filled || props.loading,
              "animate-pulse motion-reduce:animate-none": props.loading,
            }}
            disabled={props.disabled || props.loading}
            aria-busy={props.pending || props.loading}
            onClick={props.onChoose}
          >
            <span class="truncate" classList={{ invisible: props.loading }}>
              {props.label}
            </span>
          </button>
        </div>
      </div>

      <ul class="contents">
        <li class={`${LIST_LINE} pt-4 pb-1 text-xs leading-5 text-(--plane-text-tertiary)`}>
          {props.plan.builds ? t("Everything in {plan}, plus:", { plan: t(props.plan.builds) }) : t("Includes:")}
        </li>
        <For each={props.plan.features}>
          {(feature) => (
            <li class={`${LIST_LINE} flex items-start gap-2 py-1 text-[13px] leading-5 text-pretty text-(--plane-text-secondary)`}>
              <Check class="mt-[3px] text-(--plan-ink)" />
              {t(feature)}
            </li>
          )}
        </For>
      </ul>

      <div class="pb-3" style={{ "grid-row": `${props.plan.features.length + 3} / -1` }} />
    </article>
  );
}
