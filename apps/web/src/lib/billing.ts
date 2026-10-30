/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Paying for a plan, through services/billing and Stripe. Checkout and the
// billing portal are Stripe's own pages; the plan someone pays for lands on
// user_data.access_level, which context/auth.tsx follows live.

import { toast } from "somoto";

import { t } from "./i18n";
import type { Billing } from "./plans";
import { supabase } from "./supabase";

/** The paid plans, as the billing service names them. */
export type PaidPlan = "creator" | "pro" | "agency";

/** user_data.access_level for each paid plan. */
export const LEVEL_OF_PLAN: Record<PaidPlan, number> = { creator: 2, pro: 3, agency: 4 };

/** The plan being paid for. Amounts are in cents, times in ms. */
export type BillingSummary = {
  plan: PaidPlan;
  billingPeriod: "month" | "year";
  amount: number;
  currency: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  status: "active" | "trialing" | "past_due";
  /** Social accounts bought past the ones Agency includes; 0 on the other plans. */
  extraAccounts: number;
  /** A cheaper plan (or monthly instead of yearly) waiting for the renewal. */
  scheduled: ScheduledChange | null;
};

/** A switch that happens at the renewal rather than now. `at` is in ms. */
export type ScheduledChange = { plan: PaidPlan; billing: Billing; at: number };

/** A plan picked to buy. `accounts` is how many social accounts, for Agency with more than it includes. */
export type ChosenPlan = { plan: PaidPlan; billing: Billing; accounts?: number };

/** What came of a checkout that stayed on the page: a switch set for the renewal, or one charged already. */
export type CheckoutResult = { scheduled?: ScheduledChange; updated?: boolean };

export type BillingAddress = {
  legalName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type PaymentMethod = { brand: string; last4: string; expMonth: number; expYear: number };

export type BillingInfo = {
  email: string;
  address: BillingAddress | null;
  taxId: string | null;
  paymentMethod: PaymentMethod | null;
  billingPeriod: "month" | "year" | null;
};

export type RawInvoice = {
  id: string;
  status: string | null;
  total: number;
  currency: string;
  dueDate: number;
  hostedUrl: string | null;
};

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to manage your plan."));
  let response: Response;
  try {
    response = await fetch(`/api/billing/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(t("Couldn't reach billing. Try again in a moment."));
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || t("Payments aren't available right now. Try again in a moment."));
  return payload;
}

/** The plan being paid for and the details on the invoices; both null for someone who has never paid. */
export function billingAccount() {
  return call<{ summary: BillingSummary | null; info: BillingInfo | null }>("GET", "account");
}

export function listInvoices() {
  return call<RawInvoice[]>("GET", "invoices");
}

/**
 * Stripe Checkout for a plan, or Stripe's page confirming an upgrade for
 * someone already paying; both leave the page for Stripe, which comes back to
 * Billing, and resolve null. A downgrade isn't charged now: it's set for the
 * renewal, and resolves to when that is. Agency with extra accounts moving to
 * yearly is charged straight away and resolves `updated`. Errors are toasted
 * and resolve null.
 */
export async function startCheckout(plan: PaidPlan, billing: Billing, accounts?: number): Promise<CheckoutResult | null> {
  try {
    const answer = await call<{ url?: string } & CheckoutResult>("POST", "checkout", { plan, billing, accounts });
    if (answer.url) {
      window.location.href = answer.url;
      return null;
    }
    return { scheduled: answer.scheduled, updated: answer.updated };
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("Checkout failed"));
    return null;
  }
}

/**
 * Sets how many social accounts an Agency plan has, its 100 included. More are
 * charged now for what's left of the period, fewer are credited on the next bill.
 */
export function setAccounts(accounts: number) {
  return call<{ extraAccounts: number }>("POST", "accounts", { accounts });
}

/** Keeps the plan as it is: drops a switch waiting for the renewal, or the plan's end. */
export function keepPlan() {
  return call<{ kept: boolean }>("POST", "keep", {});
}

/**
 * Stripe's billing portal: `cancel` goes straight to ending the plan,
 * `payment` to changing the card.
 */
export async function openBillingPortal(flow?: "cancel" | "payment"): Promise<void> {
  try {
    const { url } = await call<{ url: string }>("POST", "portal", { flow });
    window.location.href = url;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("Failed to open billing portal"));
  }
}

const CHOSEN_KEY = "plan.video.chosen-plan";
// Long enough to sign in by email, short enough that a later visit doesn't open checkout out of nowhere.
const CHOSEN_MS = 30 * 60 * 1000;

/** Keeps the plan picked on the pricing page through the sign-in; null forgets it. */
export function rememberCheckout(chosen: ChosenPlan | null): void {
  try {
    if (chosen) localStorage.setItem(CHOSEN_KEY, JSON.stringify({ ...chosen, at: Date.now() }));
    else localStorage.removeItem(CHOSEN_KEY);
  } catch {
    // Signing in still works; it just lands on the dashboard.
  }
}

/**
 * The plan picked before signing in, once; null when there is none. Signing in
 * by email opens a second tab, and both see the sign-in, so they take turns:
 * only the first finds the plan.
 */
export function takeCheckout(): Promise<ChosenPlan | null> {
  if (!navigator.locks) return Promise.resolve(takeChosen());
  return navigator.locks.request(CHOSEN_KEY, takeChosen).catch(() => null);
}

function takeChosen(): ChosenPlan | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOSEN_KEY) ?? "null") as { plan?: unknown; billing?: unknown; accounts?: unknown; at?: unknown } | null;
    localStorage.removeItem(CHOSEN_KEY);
    if (typeof saved?.plan !== "string" || !(saved.plan in LEVEL_OF_PLAN)) return null;
    if (saved.billing !== "monthly" && saved.billing !== "yearly") return null;
    if (typeof saved.at !== "number" || Date.now() - saved.at > CHOSEN_MS) return null;
    return { plan: saved.plan as PaidPlan, billing: saved.billing, accounts: typeof saved.accounts === "number" ? saved.accounts : undefined };
  } catch {
    return null;
  }
}

/** Reads the plan from Stripe now, rather than waiting for its webhook. For coming back from checkout. */
export function syncPlan() {
  return call<{ level: number }>("POST", "sync", {});
}
