/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What needs the user, worked out from their posts, plan, card and saved
// notices. A notice shows while what it's about holds. Which ones were read
// or cleared is saved on the account.

import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";

import { allPosts, loaded, setEventStatus, uploadProblem } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";
import { dateFromKey, localDateKey, platformName, shiftDay } from "@/components/calendar/utils";
import { usePostActions } from "@/components/publish/post-actions";
import { PUBLISHING_PLATFORMS, canPublish, deliveriesOf, hasFailed, isGoingOut, overPlan, retryLabel } from "@/components/publish/publisher";
import { atLocal } from "@/components/publish/save";
import { showUpgradeDialog } from "@/components/upgrade-dialog";
import { useAuth } from "@/context/auth";
import { accountSyncProblem, retryAccountSync } from "@/lib/account-sync";
import { postSyncProblem, retryPostSync, unsyncedPosts } from "@/lib/post-sync";
import { retryTeamSync, teamSyncProblem } from "@/lib/team-sync";
import { showInvite, teamInvites } from "@/lib/team";
import { notificationTick, queueAccountSync } from "@/lib/account-sync-bus";
import { LEVEL_OF_PLAN, billingAccount, openBillingPortal, type BillingInfo, type BillingSummary } from "@/lib/billing";
import { retryCloud } from "@/lib/cloud-storage";
import { TRASH_RETENTION_MS, type ProjectRecord } from "@/lib/db";
import { intlLocale, localized, msg, t } from "@/lib/i18n";
import { LINKEDIN_RENEW_AHEAD_MS, linkedinRenewable } from "@/lib/linkedin";
import { connectionsFor, loadSocialConnections } from "@/lib/social-connections";
import { formatBytes } from "@/lib/social-media";
import { planOfLevel } from "@/lib/plans";
import { activeScope } from "@/lib/workspaces";
import { isDesktop, listTrashedProjects, projectsRevision } from "@/projects";

import { formatTrashRemaining } from "./utils";
import type { DashboardView } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a post that went out stays listed. */
const SENT_KEPT_MS = 14 * DAY_MS;
/** How far ahead a post with no account to go out from is flagged. */
const ACCOUNT_AHEAD_MS = 3 * DAY_MS;
/** How long past its time a post that publishes from plan.video counts as missed. */
const MISSED_AFTER_MS = 10 * 60 * 1000;

/** "TikTok and Instagram": the networks of a post that plan.video doesn't post to. */
function listNetworks(platforms: readonly string[]) {
  const names = platforms.filter((id) => !PUBLISHING_PLATFORMS.includes(id)).map(platformName);
  return names.length > 1 ? t("{names} and {last}", { names: names.slice(0, -1).join(", "), last: names.at(-1) }) : (names[0] ?? t("these networks"));
}
const RENEWAL_AHEAD_MS = 7 * DAY_MS;
const CARD_AHEAD_MS = 30 * DAY_MS;
const TRASH_AHEAD_MS = 3 * DAY_MS;
/** The share of credits left that counts as running low. */
const CREDITS_LOW = 0.1;
/** The share of storage in use that warns, and that counts as full. */
const STORAGE_LOW = 0.8;
const STORAGE_FULL = 0.95;
/** Read and cleared notices remembered, newest last. */
const KEEP = 400;

export type NoticeTone = "error" | "warning" | "success" | "info";

export type NoticeAction = { label: string; run(): void };

export type Notice = {
  id: string;
  tone: NoticeTone;
  icon: string;
  title: string;
  /** What it's about, like a post's title. */
  subject?: string;
  body: string;
  /** When it happened. Without one, when it was first noticed here. */
  at?: number;
  actions: NoticeAction[];
  /**
   * Notices that tell one thing once per network, like a post going out to
   * several, share a group and show as one row: its title names them all.
   */
  group?: string;
  /** The group's title, given every network's name in one ("LinkedIn and X"). */
  groupTitle?(networks: string): string;
  /** The network a grouped notice is about, for the row's title. */
  network?: string;
  /** What the row says about this network when grouped, if more than that it's up. */
  note?: string;
};

export type ShownNotice = Notice & { at: number; read: boolean };

/** Errors and warnings stay under Needs attention until they're fixed or cleared. */
export const needsAttention = (notice: Notice) => notice.tone === "error" || notice.tone === "warning";

type Saved = { read: string[]; cleared: string[]; seen: Record<string, number> };

const EMPTY: Saved = { read: [], cleared: [], seen: {} };

const storageKey = (userId: string) => `plan.video.notifications.${userId}`;

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function readSaved(userId: string): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "{}") as Partial<Saved>;
    const seen = Object.entries(parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {});
    return {
      read: strings(parsed.read),
      cleared: strings(parsed.cleared),
      seen: Object.fromEntries(seen.filter(([, at]) => typeof at === "number")),
    };
  } catch {
    return EMPTY;
  }
}

const newest = (seen: Record<string, number>) =>
  Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, KEEP));

/** When the post goes out. All-day posts count from the start of their day. */
const momentOf = (post: StoredEvent) => atLocal(post.day, post.allDay ? "00:00" : post.start)?.getTime() ?? 0;

// Day keys name a calendar day, so they format in UTC whatever the zone.
const DAY_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }));
const DATE_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }));
const MONTH_FORMAT = localized((locale) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }));

function dayName(key: string) {
  const today = localDateKey(new Date());
  if (key === today) return t("today");
  if (key === shiftDay(today, 1)) return t("tomorrow");
  if (key === shiftDay(today, -1)) return t("yesterday");
  return DAY_FORMAT().format(dateFromKey(key));
}

const whenOf = (post: StoredEvent) => (post.allDay ? dayName(post.day) : t("{day} at {time}", { day: dayName(post.day), time: post.start }));

const cardBrand = (brand: string) =>
  brand ? brand.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : t("Card");

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(intlLocale(), { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

type Billing = {
  summary: BillingSummary | null;
  info: BillingInfo | null;
};

/** The notices for the signed-in user, kept up to date. Make one per dashboard. */
export function createNotifications(open: (view: DashboardView) => void) {
  const auth = useAuth();
  const { edit, send, openCalendar, upgrade } = usePostActions();

  const [now, setNow] = createSignal(Date.now());
  const [storage, setStorage] = createSignal<StorageEstimate>();
  const measure = () => navigator.storage?.estimate?.().then(setStorage, () => undefined);

  onMount(() => {
    void measure();
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const remeasure = setInterval(() => void measure(), 5 * 60_000);
    const refresh = () => {
      setNow(Date.now());
      void measure();
    };
    window.addEventListener("focus", refresh);
    onCleanup(() => {
      clearInterval(tick);
      clearInterval(remeasure);
      window.removeEventListener("focus", refresh);
    });
  });

  const userId = createMemo(() => auth.user()?.id);
  createEffect(() => loadSocialConnections(userId()));

  // Signals rather than resources, so a fetch doesn't suspend the dashboard.
  const [billing, setBilling] = createSignal<Billing>();
  const proUserId = createMemo(() => (auth.isPro() ? userId() : undefined));
  createEffect(
    on(
      proUserId,
      (userId) => {
        setBilling(undefined);
        if (!userId) return;
        let current = true;
        void billingAccount()
          .catch(() => ({ summary: null, info: null }))
          .then((account) => current && setBilling(account));
        onCleanup(() => (current = false));
      },
    ),
  );

  const [trashed, setTrashed] = createSignal<ProjectRecord[]>([]);
  createEffect(
    on(projectsRevision, () => {
      if (isDesktop()) return;
      let current = true;
      void listTrashedProjects().then((list) => current && setTrashed(list), () => undefined);
      onCleanup(() => (current = false));
    }),
  );

  const postNotices = (time: number): Notice[] => {
    if (!loaded()) return [];
    return allPosts().flatMap((post) => {
      const list: Notice[] = [];
      const subject = post.title || t("Untitled post");
      const due = momentOf(post);
      const reopen = { label: t("Edit post"), run: () => edit(post, post.status !== "posted") };

      for (const { platform, delivery } of deliveriesOf(post)) {
        const at = Date.parse(delivery.at);
        const network = platformName(platform);
        if (delivery.state === "failed" && hasFailed(post) && !isGoingOut(post)) {
          list.push({
            id: `post-failed:${post.id}:${platform}:${delivery.at}`,
            tone: "error",
            icon: "alert-warning",
            title: t("Didn't post to {network}", { network }),
            subject,
            body: t(delivery.error || msg("It didn't go out.")),
            at,
            actions: overPlan(delivery)
              ? [{ label: t("Upgrade"), run: upgrade }, { label: retryLabel(delivery), run: () => void send(post) }]
              : [{ label: retryLabel(delivery), run: () => void send(post) }, reopen],
          });
        } else if (delivery.state === "sent" && time - at < SENT_KEPT_MS) {
          list.push({
            id: `post-sent:${post.id}:${platform}:${delivery.at}`,
            tone: "success",
            icon: "circle-check",
            title: t("Posted to {network}", { network }),
            subject,
            body:
              platform === "tiktok"
                ? t("It's up as Only me. Choose who sees it in TikTok.")
                : platform === "youtube"
                  ? t("It's on your channel. YouTube may still be processing it.")
                  : t("It's up."),
            at,
            actions: [{ label: t("Show on calendar"), run: () => openCalendar(post) }],
            group: `post-sent:${post.id}`,
            groupTitle: (networks) => t("Posted to {network}", { network: networks }),
            network,
            note:
              platform === "tiktok"
                ? t("It's up as Only me. Choose who sees it in TikTok.")
                : platform === "youtube"
                  ? t("YouTube may still be processing it.")
                  : undefined,
          });
        }
      }

      const upload = post.status === "scheduled" && !isGoingOut(post) ? uploadProblem(post.id) : undefined;
      if (upload) {
        list.push({
          id: `post-upload:${post.id}`,
          tone: "error",
          icon: "alert-warning",
          title: t("A post's file didn't upload"),
          subject,
          body: t("{problem} Until it uploads, the post can't go out with it.", { problem: upload }),
          actions: [{ label: t("Try again"), run: retryCloud }, reopen],
        });
      }

      if (post.status !== "scheduled" || post.recurrence) return list;
      // The publisher sends a post within a minute of its time; one still waiting a while after missed it.
      if (due < time - MISSED_AFTER_MS || (due < time && !canPublish(post))) {
        if (deliveriesOf(post).length) return list;
        list.push({
          id: `post-due:${post.id}:${post.day}:${post.allDay ? "all-day" : post.start}`,
          tone: "warning",
          icon: "clock",
          title: canPublish(post) ? t("A scheduled post didn't go out") : t("A scheduled post is waiting"),
          subject,
          body: canPublish(post)
            ? t("It was set for {when}. Post it now, or pick a new time.", { when: whenOf(post) })
            : t("It was set for {when}. plan.video can't post to {networks} for you yet, so post it there, then mark it as posted.", {
                when: whenOf(post),
                networks: listNetworks(post.platforms),
              }),
          at: due,
          actions: [
            canPublish(post)
              ? { label: t("Post now"), run: () => void send(post) }
              : { label: t("Mark as posted"), run: () => setEventStatus(post.id, "posted") },
            { label: t("Reschedule"), run: () => edit(post, true) },
          ],
        });
      } else if (due - time < ACCOUNT_AHEAD_MS) {
        for (const platform of post.platforms) {
          if (!PUBLISHING_PLATFORMS.includes(platform) || connectionsFor(platform).length) continue;
          const network = platformName(platform);
          list.push({
            id: `post-account:${post.id}:${platform}:${post.day}:${post.start}`,
            tone: "warning",
            icon: "link",
            title: t("Connect {network} before this goes out", { network }),
            subject,
            body: t("It's set for {when}, and it needs a {network} account to post from.", { when: whenOf(post), network }),
            at: due - ACCOUNT_AHEAD_MS,
            actions: [{ label: t("Open Connections"), run: () => open("connections") }],
          });
        }
      }
      return list;
    });
  };

  const creditNotices = (): Notice[] => {
    const limit = auth.creditLimit();
    const left = auth.remainingCredits();
    if (!auth.hasUserData() || limit <= 0 || left > limit * CREDITS_LOW) return [];
    const pro = auth.isPro();
    const reset = pro ? auth.nextCreditReset() : null;
    const cycle = reset ? localDateKey(reset) : pro ? "pro" : "free";
    const action = { label: pro ? t("Buy credits") : t("Upgrade to Pro"), run: showUpgradeDialog };
    if (left <= 0) {
      return [
        {
          id: `credits-out:${cycle}`,
          tone: "error",
          icon: "upgrade",
          title: t("You're out of AI credits"),
          body: reset
            ? t("They refill on {date}. Buy more to keep using AI tools before then.", { date: DATE_FORMAT().format(reset) })
            : pro
              ? t("Buy more to keep using AI tools.")
              : t("Pro comes with a fresh set of credits every month."),
          actions: [action],
        },
      ];
    }
    const counts = { count: left, left: left.toLocaleString(intlLocale()), limit: limit.toLocaleString(intlLocale()) };
    return [
      {
        id: `credits-low:${cycle}`,
        tone: "warning",
        icon: "upgrade",
        title: t("AI credits are running low"),
        body: reset
          ? t("{count, plural, other {{left} of {limit} left.}} They refill on {date}.", { ...counts, date: DATE_FORMAT().format(reset) })
          : pro
            ? t("{count, plural, other {{left} of {limit} left.}}", counts)
            : t("{count, plural, other {{left} of {limit} left.}} Pro comes with a fresh set every month.", counts),
        actions: [action],
      },
    ];
  };

  const billingNotices = (time: number): Notice[] => {
    const data = billing();
    if (!data) return [];
    const list: Notice[] = [];
    const renews = data.summary?.currentPeriodEnd;
    const plan = data.summary ? t(planOfLevel(LEVEL_OF_PLAN[data.summary.plan]).name) : t("your plan");
    if (data.summary?.status === "past_due") {
      list.push({
        id: `payment-failed:${renews}`,
        tone: "error",
        icon: "billing",
        title: t("Your last payment didn't go through"),
        body: t("Stripe will try your card again. Update it to keep {plan}.", { plan }),
        actions: [{ label: t("Update card"), run: () => void openBillingPortal("payment") }],
      });
    }
    if (data.summary && !data.summary.cancelAtPeriodEnd && renews && renews > time && renews - time < RENEWAL_AHEAD_MS) {
      list.push({
        id: `renews:${renews}`,
        tone: "info",
        icon: "billing",
        title: t("{plan} renews on {date}", { plan, date: DATE_FORMAT().format(renews) }),
        body: t("{amount} for the next {period, select, month {month} year {year} other {{period}}} goes on your card on file.", {
          amount: money(data.summary.amount, data.summary.currency),
          period: data.summary.billingPeriod,
        }),
        at: renews - RENEWAL_AHEAD_MS,
        actions: [{ label: t("Manage plan"), run: () => void openBillingPortal() }],
      });
    }

    const card = data.info?.paymentMethod;
    if (card) {
      const ends = new Date(card.expYear, card.expMonth, 1).getTime();
      const name = t("{brand} ending in {last4}", { brand: cardBrand(card.brand), last4: card.last4 });
      const month = MONTH_FORMAT().format(new Date(card.expYear, card.expMonth - 1, 1));
      const key = `${card.last4}:${card.expMonth}-${card.expYear}`;
      const update = { label: t("Update card"), run: () => void openBillingPortal("payment") };
      if (ends <= time) {
        list.push({
          id: `card-expired:${key}`,
          tone: "error",
          icon: "billing",
          title: t("Your card has expired"),
          body: t("{card} expired at the end of {month}. Add a new one to keep {plan}.", { card: name, month, plan }),
          at: ends,
          actions: [update],
        });
      } else if (ends - time < CARD_AHEAD_MS) {
        list.push({
          id: `card-expiring:${key}`,
          tone: "warning",
          icon: "billing",
          title: t("Your card expires soon"),
          body: t("{card} expires at the end of {month}. Update it to keep {plan} renewing.", { card: name, month, plan }),
          at: ends - CARD_AHEAD_MS,
          actions: [update],
        });
      }
    }
    return list;
  };

  const storageNotices = (): Notice[] => {
    const { usage = 0, quota = 0 } = storage() ?? {};
    const share = quota ? usage / quota : 0;
    if (share < STORAGE_LOW) return [];
    const full = share >= STORAGE_FULL;
    const sizes = { used: formatBytes(usage), quota: formatBytes(quota) };
    const room = isDesktop()
      ? t("{used} of the {quota} plan.video can use is in use.", sizes)
      : t("{used} of the {quota} this browser gives plan.video is in use.", sizes);
    return [
      {
        // A notice for each further 5%, so clearing one still warns as it fills.
        id: full ? "storage-full" : `storage-low:${Math.floor(share * 20)}`,
        tone: full ? "error" : "warning",
        icon: "alert-warning",
        title: full ? t("Storage is full") : t("Storage is almost full"),
        body: `${room} ${
          full ? t("Free up space to save new media and projects.") : t("Clear out media and projects you're done with to keep room for new ones.")
        }`,
        actions: [
          { label: t("Open Media"), run: () => open("media") },
          ...(isDesktop() ? [] : [{ label: t("Open Trash"), run: () => open("trash") }]),
        ],
      },
    ];
  };

  const trashNotices = (time: number): Notice[] =>
    trashed().flatMap((project) => {
      const trashedAt = Date.parse(project.trashedAt ?? "");
      const gone = trashedAt + TRASH_RETENTION_MS;
      if (!Number.isFinite(trashedAt) || gone - time > TRASH_AHEAD_MS) return [];
      return [
        {
          id: `trash:${project.dir}:${project.trashedAt}`,
          tone: "warning",
          icon: "trash",
          title: t("A project is deleted for good soon"),
          subject: project.displayName,
          body: t("{remaining}. Restore it from Trash to keep it.", { remaining: formatTrashRemaining(project.trashedAt!, time) }),
          at: gone - TRASH_AHEAD_MS,
          actions: [{ label: t("Open Trash"), run: () => open("trash") }],
        },
      ];
    });

  /** LinkedIn logins last 60 days and can't be renewed without the member, so ask a week ahead. */
  const connectionNotices = (time: number): Notice[] =>
    connectionsFor("linkedin").flatMap((account) => {
      const expiresAt = account.linkedin?.expiresAt;
      if (!expiresAt || linkedinRenewable(account.linkedin!) || expiresAt - time > LINKEDIN_RENEW_AHEAD_MS) return [];
      const gone = expiresAt <= time;
      return [
        {
          id: `linkedin-login:${account.id}:${expiresAt}`,
          tone: gone ? "error" : "warning",
          icon: "link",
          title: gone ? t("LinkedIn login ran out") : t("LinkedIn login runs out soon"),
          subject: account.handle,
          body: gone
            ? t("Posts can't go to LinkedIn until you reconnect it.")
            : t("It runs out on {date}. Reconnect it to keep posting.", { date: DATE_FORMAT().format(new Date(expiresAt)) }),
          at: expiresAt - LINKEDIN_RENEW_AHEAD_MS,
          actions: [{ label: t("Open Connections"), run: () => open("connections") }],
        },
      ];
    });

  /** Changes made here aren't reaching the account, which is what the publisher sends from. */
  const syncNotices = (): Notice[] => [...ownSyncNotices(), ...teamSyncNotices()];

  /** The open workspace's scheduled posts changed here that the server doesn't have: the publisher sends from the server's. */
  const waitingPosts = () => allPosts().filter((post) => post.status === "scheduled" && unsyncedPosts().has(post.id)).length;

  /** Changes made in a shared workspace aren't reaching its owner's account, which its posts go out from. */
  const teamSyncNotices = (): Notice[] => {
    const problem = teamSyncProblem() ?? (activeScope() ? postSyncProblem() : null);
    if (!problem) return [];
    const waiting = activeScope() ? waitingPosts() : 0;
    return [
      {
        id: `team-sync:${problem.since}`,
        tone: waiting ? "error" : "warning",
        icon: "alert-warning",
        title: t("Changes aren't reaching this workspace"),
        body: t(
          "{problem}, so {count, plural, =0 {changes made here stay in this browser for now} =1 {a scheduled post changed here won't go out as it shows} other {# scheduled posts changed here won't go out as they show}}. plan.video keeps trying.",
          { problem: problem.message, count: waiting },
        ),
        at: problem.since,
        actions: [
          {
            label: t("Try again"),
            run: () => {
              retryTeamSync();
              retryPostSync();
            },
          },
        ],
      },
    ];
  };

  const ownSyncNotices = (): Notice[] => {
    const problem = (activeScope() ? null : postSyncProblem()) ?? accountSyncProblem();
    if (!problem) return [];
    const waiting = activeScope() ? 0 : waitingPosts();
    return [
      {
        id: `account-sync:${problem.since}`,
        tone: waiting ? "error" : "warning",
        icon: "alert-warning",
        title: t("Changes aren't reaching your account"),
        body: t(
          "{problem}, so {count, plural, =0 {changes made here stay in this browser for now} =1 {a scheduled post changed here won't go out as it shows} other {# scheduled posts changed here won't go out as they show}}. plan.video keeps trying.",
          { problem: problem.message, count: waiting },
        ),
        at: problem.since,
        actions: [
          {
            label: t("Try again"),
            run: () => {
              retryAccountSync();
              retryPostSync();
            },
          },
        ],
      },
    ];
  };

  /** Someone asked the person into a workspace of theirs. */
  const inviteNotices = (): Notice[] =>
    teamInvites().map((invite) => ({
      id: `team-invite:${invite.id}`,
      tone: "info",
      icon: "link",
      title: t("Invite to {workspace}", { workspace: invite.look.name }),
      body: t("{name} asked you into {workspace} as {role, select, admin {an admin} other {a member}}.", {
        name: invite.invitedBy || invite.ownerName || invite.ownerEmail,
        workspace: invite.look.name,
        role: invite.role,
      }),
      at: Date.parse(invite.invitedAt) || undefined,
      actions: [{ label: t("View invite"), run: () => showInvite(invite.id) }],
    }));

  const notices = createMemo<Notice[]>(() => {
    const time = now();
    return [
      ...syncNotices(),
      ...inviteNotices(),
      ...postNotices(time),
      ...connectionNotices(time),
      ...creditNotices(),
      ...billingNotices(time),
      ...storageNotices(),
      ...trashNotices(time),
    ];
  });

  const [saved, setSaved] = createSignal<Saved>(EMPTY);
  createEffect(() => {
    notificationTick();
    const id = userId();
    setSaved(id ? readSaved(id) : EMPTY);
  });

  const save = (change: (current: Saved) => Saved) => {
    const next = change(saved());
    setSaved(next);
    const id = userId();
    if (!id) return;
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(next));
    } catch {
      // Storage full or blocked: the change holds until the page reloads.
      return;
    }
    queueAccountSync();
  };

  createEffect(() => {
    const seen = saved().seen;
    const fresh = notices().filter((notice) => notice.at === undefined && seen[notice.id] === undefined);
    if (!fresh.length || !userId()) return;
    const at = Date.now();
    save((current) => ({ ...current, seen: newest({ ...current.seen, ...Object.fromEntries(fresh.map((notice) => [notice.id, at])) }) }));
  });

  const list = createMemo<ShownNotice[]>(() => {
    const { read, cleared, seen } = saved();
    const isRead = new Set(read);
    const isCleared = new Set(cleared);
    return notices()
      .filter((notice) => !isCleared.has(notice.id))
      .map((notice) => ({ ...notice, at: notice.at ?? seen[notice.id] ?? now(), read: isRead.has(notice.id) }))
      .sort((a, b) => b.at - a.at);
  });
  const unread = createMemo(() => list().filter((notice) => !notice.read));
  /** Cleared notices whose cause still holds, so they'd show again if restored. */
  const cleared = createMemo(() => {
    const isCleared = new Set(saved().cleared);
    return notices().filter((notice) => isCleared.has(notice.id)).map((notice) => notice.id);
  });

  const markRead = (ids: readonly string[]) => {
    const known = new Set(saved().read);
    const fresh = ids.filter((id) => !known.has(id));
    if (fresh.length) save((current) => ({ ...current, read: [...current.read, ...fresh].slice(-KEEP) }));
  };

  return {
    list,
    unread,
    now,
    markRead,
    cleared,
    clear: (ids: readonly string[]) => {
      const clearing = new Set(ids);
      save((current) => ({ ...current, cleared: [...current.cleared.filter((item) => !clearing.has(item)), ...ids].slice(-KEEP) }));
    },
    restore: (ids: readonly string[]) => {
      const restoring = new Set(ids);
      save((current) => ({ ...current, cleared: current.cleared.filter((item) => !restoring.has(item)) }));
    },
  };
}

export type Notifications = ReturnType<typeof createNotifications>;
