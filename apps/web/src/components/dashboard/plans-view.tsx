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
import { billingAccount, keepPlan, openBillingPortal, setAccounts, startCheckout, type PaidPlan } from "@/lib/billing";
import { dashboardTheme } from "@/lib/dashboard-theme";
import { msg, t } from "@/lib/i18n";
import { PLANS, YEARLY_SAVING, formatPrice, planOfLevel, planPrice, priceNote, type Billing, type Plan } from "@/lib/plans";
import { connectedAccountCount } from "@/lib/social-connections";
import { Icon } from "@/components/ui/icon";
import { zonedFormat } from "@/lib/time-zone";

const BILLING_OPTIONS: readonly { id: Billing; label: string; badge?: string }[] = [
  { id: "monthly", label: msg("Monthly") },
  { id: "yearly", label: msg("Yearly"), badge: YEARLY_SAVING },
];

/** Same order as PLANS. */
const PLAN_COLORS: CardColor[] = ["sky", "lavender", "peach", "green"];

const LIST_ROWS = Math.max(...PLANS.map((plan) => plan.features.length));

const AGENCY = PLANS.find((plan) => plan.extraAccounts)!;
const INCLUDED = AGENCY.extraAccounts!.included;
/** Must match the pricing page's stepper and the billing service. */
const MOST_ACCOUNTS = 1000;

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

  const onAgency = () => auth.accessLevel() >= 4;
  const ownAccounts = () => INCLUDED + (summary()?.extraAccounts ?? auth.extraAccounts());
  const usedAccounts = () => {
    const id = auth.user()?.id;
    return id ? connectedAccountCount(id) : 0;
  };
  // Not below what's connected, so no account stops posting.
  const fewestAccounts = () => (onAgency() ? Math.max(INCLUDED, usedAccounts()) : INCLUDED);
  const [pickedAccounts, setPickedAccounts] = createSignal<number>();
  const accounts = () => Math.max(fewestAccounts(), pickedAccounts() ?? (onAgency() ? ownAccounts() : INCLUDED));
  const pickAccounts = (value: number) => setPickedAccounts(Math.min(MOST_ACCOUNTS, Math.max(fewestAccounts(), Math.round(value) || fewestAccounts())));
  const accountsFor = (plan: Plan) => (plan.extraAccounts ? accounts() : undefined);

  const go = async (id: string, run: () => Promise<unknown>) => {
    if (leaving()) return;
    setLeaving(id);
    try {
      await run();
    } finally {
      setLeaving(undefined);
    }
  };

  /** Stripe's confirm page moves one line only, so Agency with extra accounts is charged and confirmed here. */
  const chargedHere = (choice: Choice) => !!summary() && !!choice.plan.extraAccounts && (accounts() > INCLUDED || (summary()?.extraAccounts ?? 0) > 0);

  const updateAccounts = () =>
    void go(AGENCY.id, async () => {
      try {
        await setAccounts(accounts());
        toast.success(t("Social accounts updated"));
        setPickedAccounts(undefined);
        await refetch();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("Couldn't change your social accounts. Try again in a moment."));
      }
    });

  const choose = (choice: Choice, downgrade: boolean, current: boolean) => {
    if (choice.plan.id === "free") return void go("free", () => openBillingPortal("cancel"));
    if (current) return updateAccounts();
    if (downgrade || chargedHere(choice)) {
      setConfirming(choice);
      setChargeNow(!downgrade);
      setConfirmOpen(true);
      return;
    }
    void go(choice.plan.id, () => startCheckout(choice.plan.id as PaidPlan, choice.billing, accountsFor(choice.plan)));
  };

  const confirmSwitch = () => {
    const choice = confirming();
    if (!choice) return;
    void go("confirm", async () => {
      const done = await startCheckout(choice.plan.id as PaidPlan, choice.billing, accountsFor(choice.plan));
      if (!done) return;
      if (done.updated) toast.success(choice.plan.id === summary()?.plan ? t("Switched to yearly billing") : t("Switched to {plan}", { plan: t(choice.plan.name) }));
      setPickedAccounts(undefined);
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
            const samePlan = () => level === current() && (level === 1 || !currentBilling() || billing() === currentBilling());
            // On Agency, a different number of accounts is a change to make, not the current plan.
            const accountsChanged = () => !!plan.extraAccounts && samePlan() && !!summary() && accounts() !== ownAccounts();
            const isCurrent = () => samePlan() && !accountsChanged();
            const downgrade = () => level < current() || (level === current() && level > 1 && billing() === "monthly" && currentBilling() === "yearly");
            const starts = () => {
              const now = summary();
              if (!now) return undefined;
              if (level === 1) return now.cancelAtPeriodEnd ? now.currentPeriodEnd : undefined;
              return now.scheduled && now.scheduled.plan === plan.id && now.scheduled.billing === billing() ? now.scheduled.at : undefined;
            };
            const label = () => {
              if (accountsChanged()) return t("Update social accounts");
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
                filled={level > current() || accountsChanged()}
                disabled={disabled()}
                loading={waiting() && level <= current()}
                pending={leaving() === plan.id || (level === 1 && leaving() === "free")}
                onChoose={() => choose({ plan, billing: billing() }, downgrade(), accountsChanged())}
                accounts={
                  plan.extraAccounts
                    ? { value: accounts(), fewest: fewestAccounts(), own: samePlan() && summary() ? ownAccounts() : undefined, used: usedAccounts(), onChange: pickAccounts }
                    : undefined
                }
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
              const price = () => formatPrice(planPrice(choice().plan, choice().billing, accountsFor(choice().plan)));
              const movingUp = () => charged() && choice().plan.id !== summary()?.plan;
              return (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {movingUp() ? t("Switch to {plan}?", { plan: t(choice().plan.name) }) : charged() ? t("Switch to yearly billing?") : sameBilling() ? t("Switch to monthly billing?") : t("Switch to {plan}?", { plan: t(choice().plan.name) })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {movingUp()
                        ? choice().billing === "yearly"
                          ? t("You move to {plan} with {count} social accounts now, at {price}/mo, billed yearly. You're charged today, less what's left of {current}.", { plan: t(choice().plan.name), count: accounts(), price: price(), current: currentName() })
                          : t("You move to {plan} with {count} social accounts now, at {price}/mo. You're charged today, less what's left of {current}.", { plan: t(choice().plan.name), count: accounts(), price: price(), current: currentName() })
                        : charged()
                        ? t("Agency and your {count} extra social accounts move to yearly billing now. You're charged for the year today, less what's left of this month.", { count: accounts() - INCLUDED })
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
                      {movingUp() ? t("Upgrade to {plan}", { plan: t(choice().plan.name) }) : charged() ? t("Switch to yearly") : t("Switch on {date}", { date: renewal() ? DAY.format(renewal()!) : "" })}
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
  accounts?: { value: number; fewest: number; own?: number; used: number; onChange: (value: number) => void };
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
          <span class="text-[36px] leading-none font-normal tracking-[-0.03em] tabular-nums">{formatPrice(planPrice(props.plan, props.billing, props.accounts?.value))}</span>
          <span class="text-[13px] text-[#000]/55">{t("/mo")}</span>
        </p>
        <p class="mt-2 text-xs leading-4 text-[#000]/55">{priceNote(props.plan, props.billing, props.accounts?.value)}</p>

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

      <div class="flex flex-col justify-end pb-3" style={{ "grid-row": `${props.plan.features.length + 3} / -1` }}>
        <Show when={props.accounts}>{(accounts) => <AccountsStepper plan={props.plan} billing={props.billing} {...accounts()} />}</Show>
      </div>
    </article>
  );
}

function AccountsStepper(props: { plan: Plan; billing: Billing; value: number; fewest: number; own?: number; used: number; onChange: (value: number) => void }) {
  const button =
    "grid size-7 place-items-center rounded-md text-(--plane-text-secondary) press hover:text-(--plane-text-primary) disabled:pointer-events-none disabled:opacity-40 focus-ring";
  const id = `plan-accounts-${props.plan.id}`;

  return (
    <div class={`${LIST_LINE} mt-3 flex flex-col gap-2 border-t border-(--plane-border-subtle-1) pt-3`}>
      <div class="flex items-center justify-between gap-3">
        <label for={id} class="text-[13px] leading-5 text-(--plane-text-primary)">
          {t("Social accounts")}
        </label>
        <div class="flex items-center rounded-md bg-(--plane-layer-transparent-hover)">
          <button type="button" aria-label={t("Fewer accounts")} class={button} disabled={props.value <= props.fewest} onClick={() => props.onChange(props.value - 1)}>
            <Icon name="minus" />
          </button>
          <input
            id={id}
            type="number"
            inputmode="numeric"
            min={props.fewest}
            max={MOST_ACCOUNTS}
            value={props.value}
            onChange={(event) => {
              props.onChange(event.currentTarget.valueAsNumber);
              event.currentTarget.value = String(props.value);
            }}
            class="w-12 appearance-none bg-transparent text-center text-[13px] text-(--plane-text-primary) tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <button type="button" aria-label={t("More accounts")} class={button} disabled={props.value >= MOST_ACCOUNTS} onClick={() => props.onChange(props.value + 1)}>
            <Icon name="plus-add" />
          </button>
        </div>
      </div>
      <p class="text-xs leading-4 text-(--plane-text-tertiary)">
        <Show
          when={props.own !== undefined && props.value !== props.own}
          fallback={t("{count} included, then {price} a month each", { count: props.plan.extraAccounts!.included, price: formatPrice(props.plan.extraAccounts!.price) })}
        >
          {props.value > props.own!
            ? props.billing === "yearly"
              ? t("The {count} added are charged today for what's left of this year.", { count: props.value - props.own! })
              : t("The {count} added are charged today for what's left of this month.", { count: props.value - props.own! })
            : t("The {count} taken off are credited on your next bill.", { count: props.own! - props.value })}
        </Show>
        <Show when={props.fewest > props.plan.extraAccounts!.included && props.value === props.fewest}>
          {" "}
          {t("You have {count} accounts connected. Disconnect some to go lower.", { count: props.used })}
        </Show>
      </p>
    </div>
  );
}
