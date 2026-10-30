/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { featurePath } from "./site-links";
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

export type PlanCell = boolean | string;

export type ComparisonRow = { name: string; cells: PlanCell[]; href?: string; tag?: "Beta" | "Soon" };

/** The first group has no name. */
export type ComparisonGroup = { name?: string; rows: ComparisonRow[] };

const ALL: PlanCell[] = [true, true, true, true];
const PAID: PlanCell[] = [false, true, true, true];

export const COMPARISON: ComparisonGroup[] = [
  {
    rows: [
      { name: msg("Social accounts"), cells: ["3", "15", "40", msg("100, then $1 each")] },
      { name: msg("Scheduled posts"), cells: [msg("10 per account"), msg("Unlimited"), msg("Unlimited"), msg("Unlimited")] },
      { name: msg("Networks"), cells: [msg("8, all but X"), msg("All 9"), msg("All 9"), msg("All 9")], href: "/integrations" },
      // Must match X_POSTS_BY_LEVEL and X_LINK_POSTS_BY_LEVEL in services/publisher/plans.mjs.
      { name: msg("Posts to X a month"), cells: [false, msg("150, 10 with links"), msg("400, 25 with links"), msg("800, 40 with links")] },
      { name: msg("Multiple accounts per network"), cells: ALL },
      { name: msg("Storage"), cells: [msg("5 GB"), msg("50 GB"), msg("150 GB"), msg("250 GB")] },
      { name: msg("Video export"), cells: ["1080p", "4K", "4K", "4K"] },
      { name: msg("Auto-captions a month"), cells: [msg("15 minutes"), msg("10 hours"), msg("20 hours"), msg("40 hours")] },
    ],
  },
  {
    name: msg({ message: "Schedule", context: "menu heading over the scheduling features" }),
    rows: [
      { name: msg("Content calendar"), cells: ALL, href: featurePath("content-calendar") },
      { name: msg("Posts, carousels, stories and videos"), cells: ALL },
      { name: msg("Captions and media per network"), cells: ALL },
      { name: msg("Post previews"), cells: ALL, href: featurePath("cross-posting") },
      { name: msg("Posting queue"), cells: ALL, href: featurePath("posting-queue") },
      { name: msg("Repeating posts"), cells: ALL },
      { name: msg("Time zones"), cells: ALL },
      { name: msg("Media library"), cells: ALL },
      { name: msg("TikTok drafts"), cells: ALL },
      { name: msg("Plugs on Bluesky"), cells: ALL, href: featurePath("plugs") },
      { name: msg("Bulk and CSV scheduling"), cells: PAID, href: featurePath("bulk-scheduling") },
      { name: msg("Templates"), cells: PAID, href: featurePath("templates") },
      { name: msg("Saved captions and hashtags"), cells: PAID },
    ],
  },
  {
    name: msg({ message: "Edit", context: "menu heading over the video editing features" }),
    rows: [
      { name: msg("Timeline editor"), cells: ALL, href: featurePath("timeline-editor") },
      { name: msg("Infinite canvas"), cells: ALL },
      { name: msg("Keyframes and animations"), cells: ALL },
      { name: msg("Transitions"), cells: ALL },
      { name: msg("Effects, masks and blend modes"), cells: ALL },
      { name: msg("Audio mixer"), cells: ALL },
      { name: msg("Caption styles"), cells: ALL, href: featurePath("caption-styles") },
      { name: msg("Streamer layouts and killfeeds"), cells: ALL },
      { name: msg("Background removal"), cells: ALL },
      { name: msg("Sizes for every network"), cells: ALL },
      { name: msg("4K at 60 fps"), cells: PAID, href: `${featurePath("timeline-editor")}#export` },
      { name: msg("Trash, kept 30 days"), cells: ALL },
    ],
  },
  {
    name: msg("Analytics"),
    rows: [
      { name: msg("Views, likes and comments"), cells: ALL, tag: msg("Beta"), href: featurePath("analytics") },
      { name: msg("YouTube, TikTok and Meta apps"), cells: ALL },
      { name: msg("Each network and account apart"), cells: ALL },
      { name: msg("Followers per account"), cells: ALL },
      { name: msg("Charts by hour, day, week or month"), cells: ALL },
      { name: msg("Custom date ranges and comparisons"), cells: ALL },
      { name: msg("Every post ranked against your average"), cells: ALL },
      { name: msg("Best times to post"), cells: ALL, href: `${featurePath("analytics")}#best-times` },
      { name: msg("Best times straight into your queue"), cells: ALL, href: featurePath("posting-queue") },
    ],
  },
  {
    name: msg("Brands and clients"),
    rows: [
      { name: msg("Workspaces, one per brand"), cells: ALL, href: featurePath("workspaces") },
      { name: msg("Account groups"), cells: ALL },
      { name: msg("Client preview links"), cells: PAID, href: featurePath("collaboration") },
      { name: msg("Team members"), cells: [msg("Just you"), msg("Just you"), msg("Unlimited"), msg("Unlimited")], href: featurePath("collaboration") },
    ],
  },
  {
    name: msg("AI agents"),
    rows: [
      { name: msg("MCP server"), cells: ALL, href: featurePath("ai-agents") },
      { name: msg("Claude, Codex, Cursor and more"), cells: ALL },
      { name: msg("Schedule and publish posts"), cells: ALL },
    ],
  },
];
