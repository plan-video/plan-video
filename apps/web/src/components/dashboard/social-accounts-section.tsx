/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Billing's social accounts: how many of the plan's are in use, across all
// workspaces, and on Agency how many it has, 100 included and $1 a month for
// each one more. Connections refuses a new account once they're all in use.

import { Show, createSignal } from "solid-js";
import { toast } from "somoto";

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/context/auth";
import { setAccounts, type BillingSummary } from "@/lib/billing";
import { t } from "@/lib/i18n";
import { PLANS, accountLimit, planOfLevel, planPrice, priceNote, type Billing } from "@/lib/plans";
import { connectedAccountCount } from "@/lib/social-connections";

import { DashboardInfoActionRow, DashboardSurfaceSection } from "./shared";

const AGENCY = PLANS.find((plan) => plan.extraAccounts)!;
const INCLUDED = AGENCY.extraAccounts!.included;
/** The most Agency goes to, as the pricing page's stepper and the billing service have it. */
const MOST = 1000;

export function DashboardSocialAccounts(props: {
  /** The plan being paid for; undefined until it's read, or on Free. */
  summary: BillingSummary | undefined;
  onChanged(): void;
  onUpgrade?(): void;
}) {
  const auth = useAuth();
  const used = () => {
    const id = auth.user()?.id;
    return id ? connectedAccountCount(id) : 0;
  };
  const sellsMore = () => auth.accessLevel() >= 4;
  // Stripe's count once it's read; until then the one on the account.
  const extra = () => props.summary?.extraAccounts ?? auth.extraAccounts();
  const most = () => accountLimit(auth.accessLevel(), extra());

  const [open, setOpen] = createSignal(false);
  const [count, setCount] = createSignal(INCLUDED);
  const [saving, setSaving] = createSignal(false);
  const current = () => INCLUDED + extra();
  // Not below what's connected, so no account stops posting.
  const lowest = () => Math.max(INCLUDED, used());
  const set = (value: number) => setCount(Math.min(MOST, Math.max(lowest(), Math.round(value) || lowest())));
  const billing = (): Billing => (props.summary?.billingPeriod === "year" ? "yearly" : "monthly");

  const save = async () => {
    if (saving()) return;
    setSaving(true);
    try {
      await setAccounts(count());
      toast.success(t("Social accounts updated"));
      props.onChanged();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Couldn't change your social accounts. Try again in a moment."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardSurfaceSection title={t("Social accounts")}>
      <DashboardInfoActionRow
        title={t("{used} of {count} in use", { used: used(), count: most() })}
        description={
          <Show
            when={sellsMore()}
            fallback={t("{plan} connects {count}, across all your workspaces. Agency connects {included}, then {price} a month each.", {
              plan: t(planOfLevel(auth.accessLevel()).name),
              count: most(),
              included: INCLUDED,
              price: `$${AGENCY.extraAccounts!.price}`,
            })}
          >
            {extra() > 0
              ? t("{included} with Agency and {extra} more at {price} a month each, across all your workspaces.", { included: INCLUDED, extra: extra(), price: `$${AGENCY.extraAccounts!.price}` })
              : t("{included} with Agency, across all your workspaces. Each one more is {price} a month.", { included: INCLUDED, price: `$${AGENCY.extraAccounts!.price}` })}
          </Show>
        }
        action={
          <Show
            when={sellsMore()}
            fallback={
              <Button variant="secondary" onClick={() => props.onUpgrade?.()}>
                {t("Upgrade")}
              </Button>
            }
          >
            <Button
              variant="secondary"
              disabled={!props.summary}
              onClick={() => {
                setCount(Math.max(current(), lowest()));
                setOpen(true);
              }}
            >
              {t("Change")}
            </Button>
          </Show>
        }
        layout="responsive-md"
      />

      <AlertDialog open={open()} onOpenChange={(next) => !saving() && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Social accounts")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Agency includes {included}. Each one more is {price} a month, billed with your plan.", { included: INCLUDED, price: `$${AGENCY.extraAccounts!.price}` })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div class="flex items-center justify-between gap-3 rounded-lg border border-(--plane-border-subtle) px-3 py-2">
            <label for="social-accounts-count" class="text-sm text-(--plane-text-primary)">
              {t("Social accounts")}
            </label>
            <div class="flex items-center rounded-md bg-(--plane-layer-transparent-hover)">
              <button
                type="button"
                aria-label={t("Fewer accounts")}
                class="grid size-7 place-items-center rounded-md text-(--plane-text-secondary) press hover:text-(--plane-text-primary) disabled:pointer-events-none disabled:opacity-40 focus-ring"
                disabled={count() <= lowest()}
                onClick={() => set(count() - 1)}
              >
                <Icon name="minus" />
              </button>
              <input
                id="social-accounts-count"
                type="number"
                inputmode="numeric"
                min={lowest()}
                max={MOST}
                value={count()}
                onChange={(event) => {
                  set(event.currentTarget.valueAsNumber);
                  event.currentTarget.value = String(count());
                }}
                class="w-12 appearance-none bg-transparent text-center text-sm text-(--plane-text-primary) tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
              <button
                type="button"
                aria-label={t("More accounts")}
                class="grid size-7 place-items-center rounded-md text-(--plane-text-secondary) press hover:text-(--plane-text-primary) disabled:pointer-events-none disabled:opacity-40 focus-ring"
                disabled={count() >= MOST}
                onClick={() => set(count() + 1)}
              >
                <Icon name="plus-add" />
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-1 text-xs leading-4 text-(--plane-text-tertiary)">
            <p>
              <span class="text-(--plane-text-primary) tabular-nums">${planPrice(AGENCY, billing(), count())}</span>
              {t("/mo")} · {priceNote(AGENCY, billing(), count())}
            </p>
            <Show when={count() > current()}>
              <p>
                {billing() === "yearly"
                  ? t("The {count} added are charged today for what's left of this year.", { count: count() - current() })
                  : t("The {count} added are charged today for what's left of this month.", { count: count() - current() })}
              </p>
            </Show>
            <Show when={count() < current()}>
              <p>{t("The {count} taken off are credited on your next bill.", { count: current() - count() })}</p>
            </Show>
            <Show when={lowest() > INCLUDED && count() === lowest()}>
              <p>{t("You have {count} accounts connected. Disconnect some to go lower.", { count: used() })}</p>
            </Show>
          </div>

          <AlertDialogFooter>
            <Button variant="secondary" disabled={saving()} onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button disabled={saving() || count() === current()} aria-busy={saving()} onClick={() => void save()}>
              {t("Save")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardSurfaceSection>
  );
}
