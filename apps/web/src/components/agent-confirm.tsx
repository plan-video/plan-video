/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Asking the signed-in person before an agent's call goes ahead (see
// lib/agent-confirm): the words both the Agent tab's card and this dialog
// use, and the dialog for agents connected at plan.video/mcp, which can open
// over any page of the tab. It waits for Allow or Don't allow, or until the
// call has to answer, and a call nobody answered doesn't run.

import { For, Show, createSignal } from "solid-js";
import { TIKTOK_BRANDED_POLICY, TIKTOK_MUSIC_USAGE } from "@plan.video/dapi";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { recurrenceLabel } from "@/components/calendar/utils";
import { localized, msg, rich, t } from "@/lib/i18n";
import { PLATFORM_IDS, socialPlatform, type PlatformId } from "@/lib/social";

import type { ConfirmRequest } from "@/lib/agent-confirm";
import { REPLY_DELAYS } from "@/lib/thread";

const TITLES = {
  schedule_post: msg("Schedule this post?"),
  copy_post: msg("Schedule this post?"),
  update_post: msg("Save the changes to this post?"),
  publish_post: msg("Publish this post now?"),
  delete_post: msg("Delete this post?"),
} as const;

/** What the person is asked, as a question naming the call. */
export const confirmTitle = (request: ConfirmRequest) => t(TITLES[request.tool]);

/** Why it asks: what happens once they say yes. */
export function confirmDetail(request: ConfirmRequest): string {
  if (request.tool === "publish_post") return t("It goes out right away, and can't be taken back from here.");
  if (request.tool === "delete_post") return t("It comes off your calendar for good.");
  if (request.soon) return t("It goes out in a few minutes.");
  if (request.tiktok) return t("It goes to your TikTok profile.");
  return t("It goes out on its own at the time shown.");
}

/** The yes and no in the Agent tab, where the agent is the person's own. */
export function confirmButtons(request: ConfirmRequest): { yes: string; no: string } {
  if (request.tool === "publish_post") return { yes: t("Publish"), no: t("Don't publish") };
  if (request.tool === "delete_post") return { yes: t("Delete"), no: t("Keep it") };
  if (request.tool === "update_post") return { yes: t("Save"), no: t("Don't save") };
  return { yes: t("Schedule"), no: t("Don't schedule") };
}

const platformName = (id: string) => ((PLATFORM_IDS as readonly string[]).includes(id) ? socialPlatform(id as PlatformId).name : id);

const dayFormat = localized((locale) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }), "en-GB");

/** Where and when it goes out, on one line: "TikTok @name, Bluesky @name, Fri 17 Oct, 14:05". */
export function confirmWhere(request: ConfirmRequest): string {
  const channels = request.channels.map((account) => {
    const name = platformName(account.platform);
    return account.handle ? `${name} @${account.handle}` : name;
  });
  const day = request.day && /^\d{4}-\d{2}-\d{2}$/.test(request.day) ? dayFormat().format(new Date(`${request.day}T00:00:00Z`)) : request.day;
  const when = day ? (request.time ? `${day}, ${request.time}` : day) : null;
  return [...new Set(channels)].concat(when ?? []).join(", ");
}

const TIKTOK_PRIVACY: Record<string, string> = { public: msg("Everyone"), friends: msg("Friends"), followers: msg("Followers"), private: msg("Only me") };
const YOUTUBE_PRIVACY: Record<string, string> = { public: msg("Public"), unlisted: msg("Unlisted"), private: msg("Private") };

/** The rest of what goes out, one labelled line each: link, files, repeat, YouTube and TikTok choices, and words a network gets of its own. */
export function confirmFacts(request: ConfirmRequest): { label: string; value: string }[] {
  const details = request.details;
  if (!details) return [];
  const facts: { label: string; value: string }[] = [];
  if (details.link.trim()) facts.push({ label: t("Link"), value: details.link });
  if (details.files.length || details.filesElsewhere) {
    const more = details.filesElsewhere ? [t("{count, plural, one {# more file in cloud storage} other {# more files in cloud storage}}", { count: details.filesElsewhere })] : [];
    facts.push({ label: t("Media"), value: [...details.files, ...more].join(", ") });
  }
  if (details.repeat) facts.push({ label: t("Repeat"), value: recurrenceLabel(details.repeat.recurrence, request.day ?? undefined, details.repeat.end) ?? "" });
  if (details.youtube) {
    const { title, privacy, madeForKids, tags } = details.youtube;
    const parts = [title, YOUTUBE_PRIVACY[privacy] ? t(YOUTUBE_PRIVACY[privacy]) : privacy, ...(madeForKids ? [t("Made for kids")] : [])];
    if (tags.length) parts.push(`${t("Tags")}: ${tags.join(", ")}`);
    facts.push({ label: "YouTube", value: parts.join(" · ") });
  }
  if (details.tiktokPrivacy) {
    const privacy = TIKTOK_PRIVACY[details.tiktokPrivacy] ? t(TIKTOK_PRIVACY[details.tiktokPrivacy]) : details.tiktokPrivacy;
    facts.push({ label: "TikTok", value: `${t("Who can watch")}: ${privacy}` });
  }
  for (const own of details.captions) facts.push({ label: t("Words for {network}", { network: platformName(own.platform) }), value: own.text });
  (details.thread ?? []).forEach((reply, index) => {
    const wait = REPLY_DELAYS.find((item) => item.minutes === reply.delay);
    const parts = [reply.text.trim(), wait ? t(wait.label) : t("{count, plural, one {# minute} other {# minutes}}", { count: reply.delay })];
    if (reply.files) parts.push(`${t("Media")}: ${reply.files}`);
    facts.push({ label: t("Follow-up {number}", { number: index + 1 }), value: parts.filter(Boolean).join(" · ") });
  });
  return facts;
}

/** The post as it would go out, all of it: where and when, the caption, and every fact besides. Nothing is cut short. */
export function ConfirmPost(props: { request: ConfirmRequest; class?: string; muted: string; text: string }) {
  return (
    <div class={props.class}>
      <span class={`break-words ${props.muted}`}>{confirmWhere(props.request)}</span>
      <Show when={props.request.caption.trim()}>
        <p class={`break-words whitespace-pre-wrap ${props.text}`}>{props.request.caption}</p>
      </Show>
      <Show when={confirmFacts(props.request).length}>
        <dl class="flex flex-col gap-1">
          <For each={confirmFacts(props.request)}>
            {(fact) => (
              <div class="flex flex-col">
                <dt class={props.muted}>{fact.label}</dt>
                <dd class={`break-words whitespace-pre-wrap ${props.text}`}>{fact.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
    </div>
  );
}

/** TikTok's terms, as New post shows them above Post. Saying yes to a profile post accepts them. */
export function TikTokConsent(props: { branded: boolean; class?: string }) {
  const link = (href: string) => (text: string) => (
    <a class="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-ring" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
  return (
    <p class={props.class}>
      {props.branded
        ? rich("By posting, you agree to TikTok's <policy>Branded Content Policy</policy> and <music>Music Usage Confirmation</music>.", {
            policy: link(TIKTOK_BRANDED_POLICY),
            music: link(TIKTOK_MUSIC_USAGE),
          })
        : rich("By posting, you agree to TikTok's <music>Music Usage Confirmation</music>.", { music: link(TIKTOK_MUSIC_USAGE) })}
    </p>
  );
}

// --- the connector's dialog -----------------------------------------------

type Pending = { request: ConfirmRequest; answer: (yes: boolean) => void };

const [pending, setPending] = createSignal<Pending | null>(null);
/** The last request, so the dialog keeps its words while it closes. */
const [shown, setShown] = createSignal<ConfirmRequest | null>(null);

/** While the tab is in the background: a notification when they're already allowed, else the tab's title says it waits. Returns what takes it away. */
function callAttention(request: ConfirmRequest): () => void {
  if (document.visibilityState !== "hidden") return () => {};
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const notice = new Notification(confirmTitle(request), { body: t("An agent you connected is asking."), tag: "plan-video-agent-confirm" });
      notice.onclick = () => {
        window.focus();
        notice.close();
      };
      return () => notice.close();
    } catch {
      // Some browsers only make notifications from a service worker; the title still says it.
    }
  }
  const original = document.title;
  const marked = `${t("Waiting for your go-ahead")} · ${original}`;
  document.title = marked;
  const restore = () => {
    if (document.title === marked) document.title = original;
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") restore();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    restore();
  };
}

/**
 * Shows `request` and resolves to the person's answer: Allow is true; Don't
 * allow, closing the dialog, or no answer within `waitMs` is false. A newer
 * request answers the one before it with a no.
 */
export function askInTab(request: ConfirmRequest, waitMs: number): Promise<boolean> {
  if (waitMs <= 0) return Promise.resolve(false);
  pending()?.answer(false);
  return new Promise((resolve) => {
    let settled = false;
    const quiet = callAttention(request);
    const answer = (yes: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      quiet();
      if (pending()?.answer === answer) setPending(null);
      resolve(yes);
    };
    const timer = setTimeout(() => answer(false), waitMs);
    setShown(request);
    setPending({ request, answer });
  });
}

/** Mounted once for signed-in tabs that answer the connector. Draws nothing until a call asks. */
export function AgentConfirmDialog() {
  const deleting = () => shown()?.tool === "delete_post";
  return (
    <AlertDialog open={!!pending()} onOpenChange={(open) => !open && pending()?.answer(false)}>
      <AlertDialogContent class="sm:max-w-md">
        <Show when={shown()}>
          {(request) => (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmTitle(request())}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("An agent you connected is asking.")} {confirmDetail(request())}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ConfirmPost
                request={request()}
                class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-lg border px-3 py-2.5"
                muted="text-xs text-muted-foreground"
                text="text-sm text-foreground"
              />
              <Show when={request().tiktok}>{(tiktok) => <TikTokConsent branded={tiktok().branded} class="text-xs text-muted-foreground" />}</Show>
              <AlertDialogFooter>
                <Button variant="secondary" onClick={() => pending()?.answer(false)}>
                  {t("Don't allow")}
                </Button>
                <Button variant={deleting() ? "destructive" : "default"} onClick={() => pending()?.answer(true)}>
                  {t("Allow")}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </Show>
      </AlertDialogContent>
    </AlertDialog>
  );
}
