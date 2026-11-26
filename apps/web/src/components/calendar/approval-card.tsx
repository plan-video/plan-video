/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Show, Switch, createSignal } from "solid-js";
import { toast } from "somoto";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { ago } from "@/components/publish/preview-comments";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { APPROVAL_LABELS, approvalOf, canApprove, type Approval } from "@/lib/approval-state";
import { askForApproval, decide, type Decision } from "@/lib/approvals";
import { askForAccount } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { previewLink, previewOf } from "@/lib/post-previews";
import { allPosts, timeHasPassed } from "./store";
import { fieldControlBase } from "./popup";
import { cn, formatDay } from "./utils";
import type { StoredEvent } from "./types";

const NOTE_MAX = 2000;

const ICONS: Record<Approval["state"], { name: string; class: string }> = {
  pending: { name: "clock", class: "text-meter-yellow" },
  changes: { name: "alert-warning", class: "text-destructive" },
  approved: { name: "circle-check", class: "text-meter-green" },
};

export function personName(user: { email?: string; user_metadata?: Record<string, unknown> } | null | undefined): string | undefined {
  const full = user?.user_metadata?.full_name;
  return (typeof full === "string" && full.trim()) || user?.email?.split("@")[0] || undefined;
}

export async function copyApprovalLink(id: string) {
  try {
    await navigator.clipboard.writeText(previewLink(id));
    toast.success(t("Link copied"), { description: t("Whoever has it can approve this post or ask for changes, without an account.") });
  } catch {
    toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
  }
}

/** Where the post stands with its approval, and the ways on: decide, ask again, or give it a new time. */
export function ApprovalCard(props: { post: StoredEvent; onEdit(): void }) {
  const auth = useAuth();
  const approval = () => approvalOf(props.post)!;
  const [busy, setBusy] = createSignal(false);
  const [writing, setWriting] = createSignal(false);
  const [note, setNote] = createSignal("");
  const link = () => previewOf(props.post.id)?.id;
  const when = () => (props.post.allDay ? formatDay(props.post.day) : `${formatDay(props.post.day)} · ${props.post.start}`);
  const passed = () => !props.post.recurrence && timeHasPassed(props.post);

  const headline = () => {
    const { state, by, via } = approval();
    if (state === "pending") return t(APPROVAL_LABELS.pending);
    if (!by) return t(APPROVAL_LABELS[state]);
    if (state === "changes") return t("{name} asked for changes", { name: by });
    return via === "link" ? t("Approved by {name} through the link", { name: by }) : t("Approved by {name}", { name: by });
  };

  const detail = () => {
    const { state, by, at } = approval();
    const since = ago(at, Date.now());
    if (state === "pending") {
      const asked = by ? t("{name} asked {when}.", { name: by, when: since }) : t("Asked {when}.", { when: since });
      const next = passed()
        ? t("Its time has passed: once it's approved, give it a new time.")
        : props.post.recurrence
          ? t("Its runs go out once it's approved.")
          : t("It goes out {when} once it's approved.", { when: when() });
      return `${asked} ${next}`;
    }
    if (state === "approved" && props.post.status === "draft" && passed()) return t("Its time passed while it waited. Give it a new time.");
    return since;
  };

  const run = async (decision: Decision) => {
    if (auth.isGuest()) return askForAccount({ reason: "approval" });
    const words = note().trim();
    if (decision === "changes" && !words) return;
    setBusy(true);
    try {
      const failed = await decide(props.post.id, decision, words);
      if (failed) {
        toast.error(t(failed));
        return;
      }
      setWriting(false);
      setNote("");
      const now = allPosts().find((post) => post.id === props.post.id);
      if (decision === "changes") toast(t("Changes requested"), { description: t("It's back in drafts until it's approved.") });
      else
        toast.success(t("Approved"), {
          description: now?.status === "scheduled" ? (now.recurrence ? t("Its runs go out at their times.") : t("It goes out {when}.", { when: when() })) : t("Its time has passed. Give it a new time."),
        });
    } finally {
      setBusy(false);
    }
  };

  const askAgain = async () => {
    if (auth.isGuest()) return askForAccount({ reason: "approval" });
    setBusy(true);
    try {
      const asked = await askForApproval(props.post.id, personName(auth.user()));
      if ("error" in asked) toast.error(t(asked.error));
      else toast.success(t("Sent for approval"), { action: { label: t("Copy link"), onClick: () => void copyApprovalLink(asked.previewId) } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("Approval")} class="flex flex-col gap-2.5 rounded-lg border border-border-strong bg-accent/40 p-3">
      <div class="flex items-start gap-2">
        <Icon name={ICONS[approval().state].name} class={cn("-my-px size-5 shrink-0", ICONS[approval().state].class)} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 text-xs leading-5">
          <p class="font-medium text-foreground">{headline()}</p>
          <p class="text-muted-foreground">{detail()}</p>
        </div>
      </div>
      <Show when={approval().state === "changes" && approval().note}>
        {(words) => <p class="whitespace-pre-wrap break-words rounded-md bg-background/60 px-2.5 py-2 text-[13px] leading-5 text-foreground select-text">{words()}</p>}
      </Show>
      <Show when={writing()}>
        <textarea
          rows={3}
          maxLength={NOTE_MAX}
          aria-label={t("What should change?")}
          placeholder={t("What should change?")}
          class={cn(fieldControlBase, "resize-none py-1.5 leading-5")}
          value={note()}
          ref={(element) => queueMicrotask(() => element.focus())}
          onInput={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run("changes");
            if (event.key === "Escape") setWriting(false);
          }}
        />
      </Show>
      <Show
        when={
          writing() ||
          (approval().state !== "approved" && canApprove()) ||
          approval().state === "changes" ||
          (approval().state === "pending" && link()) ||
          (approval().state === "approved" && props.post.status === "draft" && passed())
        }
      >
      <div class="flex flex-wrap items-center gap-1.5">
        <Switch>
          <Match when={writing()}>
            <Button variant="ghost" class="ml-auto" disabled={busy()} onClick={() => setWriting(false)}>
              {t("Cancel")}
            </Button>
            <Button disabled={busy() || !note().trim()} onClick={() => void run("changes")}>
              {t("Request changes")}
            </Button>
          </Match>
          <Match when={approval().state !== "approved" && canApprove()}>
            <Show when={link()}>
              {(id) => (
                <Button variant="ghost" class="mr-auto gap-1 pl-1" onClick={() => void copyApprovalLink(id())}>
                  <Icon name="link" class="size-5" />
                  {t("Copy link")}
                </Button>
              )}
            </Show>
            <Show when={approval().state === "pending"}>
              <Button variant="secondary" class={link() ? undefined : "ml-auto"} disabled={busy()} onClick={() => setWriting(true)}>
                {t("Request changes")}
              </Button>
            </Show>
            <Button class={!link() && approval().state !== "pending" ? "ml-auto" : undefined} disabled={busy()} onClick={() => void run("approved")}>
              {t("Approve")}
            </Button>
          </Match>
          <Match when={approval().state === "changes"}>
            <Button variant="secondary" class="ml-auto" disabled={busy()} onClick={() => props.onEdit()}>
              {t("Edit")}
            </Button>
            <Button disabled={busy()} onClick={() => void askAgain()}>
              {t("Ask again")}
            </Button>
          </Match>
          <Match when={approval().state === "pending" && link()}>
            {(id) => (
              <Button variant="ghost" class="gap-1 pl-1" onClick={() => void copyApprovalLink(id())}>
                <Icon name="link" class="size-5" />
                {t("Copy link")}
              </Button>
            )}
          </Match>
          <Match when={approval().state === "approved" && props.post.status === "draft" && passed()}>
            <Button class="ml-auto" onClick={() => props.onEdit()}>
              {t("Pick a time")}
            </Button>
          </Match>
        </Switch>
      </div>
      </Show>
    </section>
  );
}
