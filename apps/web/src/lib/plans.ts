/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { msg, t } from "./i18n";

export type Billing = "monthly" | "yearly";

export type Plan = {
  /** As the billing service names it; the access level is the index in PLANS plus one. */
  id: "free" | "creator" | "pro" | "agency";
  name: string;
  text: string;
  /** Dollars a month, for each billing period. */
  price: Record<Billing, number>;
  builds?: string;
  /**
   * Every plan lists the same things in the same order, so the pricing page sets them side
   * by side: accounts and storage, posts, networks, posting and the editor, then the rest.
   */
  features: string[];
  popular?: boolean;
  /** Across all workspaces. services/publisher/accounts.mjs must match. */
  accounts: number;
  extraAccounts?: { included: number; price: number };
};

/** Networks only paid plans can connect: X charges for posting through its API. */
export const PAID_NETWORKS: ReadonlySet<string> = new Set(["x"]);

export const FREE_SCHEDULED_PER_ACCOUNT = 10;

const [scheduledLimit, setScheduledLimit] = createSignal<number | undefined>();

/** Undefined means no limit: a paid plan, or a plan not known yet. context/auth.tsx sets it. */
export { scheduledLimit, setScheduledLimit };

const [accountsLimit, setAccountsLimit] = createSignal<number | undefined>();

/** Undefined until the plan is known. context/auth.tsx sets it. */
export { accountsLimit, setAccountsLimit };

export const YEARLY_PERCENT = "20%";

export const YEARLY_SAVING = msg("(-20% off)");

export const PLANS: Plan[] = [
  {
    id: "free",
    name: msg("Free"),
    text: msg("For trying it out."),
    price: { monthly: 0, yearly: 0 },
    accounts: 3,
    features: [
      msg("3 social accounts"),
      msg("5 GB storage"),
      msg("10 scheduled posts per account"),
      msg("Every network but X"),
      msg("Posts, carousels, stories and videos"),
      msg("Built-in video editor, 1080p export"),
      msg("Multiple accounts per network"),
    ],
  },
  {
    id: "creator",
    name: msg("Creator"),
    text: msg("For creators who post every day."),
    price: { monthly: 19, yearly: 15 },
    accounts: 15,
    builds: msg("Free"),
    features: [
      msg("15 social accounts"),
      msg("50 GB storage"),
      msg("Unlimited posts per month"),
      msg("All 9 networks, X included"),
      msg("Bulk and CSV scheduling"),
      msg("4K video export"),
      msg("Templates and saved captions"),
      msg("Client preview links"),
    ],
  },
  {
    id: "pro",
    name: msg("Pro"),
    text: msg("For running several brands."),
    price: { monthly: 39, yearly: 31 },
    accounts: 40,
    builds: msg("Creator"),
    features: [msg("40 social accounts"), msg("150 GB storage"), msg("Unlimited posts per month"), msg("Unlimited team members")],
    popular: true,
  },
  {
    id: "agency",
    name: msg("Agency"),
    text: msg("For agencies and clients."),
    price: { monthly: 79, yearly: 63 },
    accounts: 100,
    builds: msg("Pro"),
    features: [msg("100 social accounts, then $1 each"), msg("250 GB storage"), msg("Unlimited posts per month"), msg("Unlimited team members")],
    extraAccounts: { included: 100, price: 1 },
  },
];

/** The plan for a user_data.access_level: 1 Free, 2 Creator, 3 Pro, 4 Agency. */
export function planOfLevel(level: number): Plan {
  return PLANS[Math.min(PLANS.length, Math.max(1, Math.trunc(level) || 1)) - 1];
}

export function accountLimit(level: number, extra = 0): number {
  return planOfLevel(level).accounts + Math.max(0, Math.trunc(extra) || 0);
}

/** Accounts past the included ones cost the same billed monthly or yearly. */
export function planPrice(plan: Plan, billing: Billing, accounts?: number): number {
  const extra = plan.extraAccounts;
  const added = extra && accounts ? Math.max(0, accounts - extra.included) * extra.price : 0;
  return plan.price[billing] + added;
}

export function priceNote(plan: Plan, billing: Billing, accounts?: number): string {
  const price = planPrice(plan, billing, accounts);
  if (!price) return t("Free forever, no card needed");
  return billing === "yearly" ? t("{price} billed yearly", { price: `$${price * 12}` }) : t("Billed monthly");
}
