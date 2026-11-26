/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import CheckLucide from "lucide-solid/icons/check";
import ClockLucide from "lucide-solid/icons/clock";
import UndoLucide from "lucide-solid/icons/undo-2";
import { Match, Show, Switch, createSignal, createUniqueId } from "solid-js";
import { toast } from "somoto";

import { PlaneButton } from "@/components/dashboard/plane-button";
import { fieldControl } from "@/components/publish/controls";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { reviewPreview, reviewerName, setReviewerName, type SharedPreview } from "@/lib/post-previews";
import { momentOf } from "@/lib/time-zone";

const NAME_MAX = 80;
const NOTE_MAX = 2000;

const CARD = "flex flex-col gap-3 rounded-lg border border-(--plane-border-subtle) bg-(--plane-layer-1) p-3.5 shadow-(--plane-shadow-raised-100)";
const BADGE = "grid size-7 shrink-0 place-items-center rounded-full";
const LINK = "self-start rounded-sm text-xs leading-5 font-medium text-(--plane-text-tertiary) outline-none hover:text-(--plane-text-primary) focus-ring";

/** Whether the post's time is still ahead. A series always has runs ahead of it. */
function timeAhead(preview: SharedPreview): boolean {
  const { day, start, allDay, timeZone } = preview.snapshot;
  const at = momentOf(day, allDay ? "00:00" : start, timeZone ?? undefined);
  return !at || at.getTime() > Date.now();
}

/** On the shared page: where the post stands, and for whoever has the link, approving it or asking for changes. */
export function ApprovalPanel(props: { previewId: string; preview: SharedPreview; when: string; suggestedName: string; onChanged(): Promise<void> }) {
  const approval = () => props.preview.approval ?? undefined;
  const status = () => props.preview.status ?? props.preview.snapshot.status;
  const open = () => status() !== "posted";
  const canReview = () => props.preview.canReview !== false && open();
  const [writing, setWriting] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [name, setName] = createSignal(reviewerName() || props.suggestedName);
  const [busy, setBusy] = createSignal(false);
  const nameId = createUniqueId();

  const decide = async (decision: "approved" | "changes") => {
    const who = name().trim().slice(0, NAME_MAX);
    if (!who || busy() || (decision === "changes" && !note().trim())) return;
    setBusy(true);
    try {
      const done = await reviewPreview(props.previewId, decision, who, decision === "changes" ? note() : undefined);
      if ("error" in done) {
        toast.error(t("Couldn't save that"), { description: t(done.error) });
        return;
      }
      setReviewerName(who);
      setWriting(false);
      setNote("");
      await props.onChanged();
      if (decision === "changes") toast.success(t("Changes requested"), { description: t("The team sees your note and sends the post back once it's changed.") });
      else
        toast.success(t("Approved"), {
          description: done.status === "scheduled" ? t("It goes out {when}.", { when: props.when }) : t("Its time has passed, so the team will give it a new one."),
        });
    } finally {
      setBusy(false);
    }
  };

  const nameField = () => (
    <Show when={!reviewerName()}>
      <div class="flex flex-col gap-1">
        <label for={nameId} class="text-xs leading-4 font-medium text-(--plane-text-secondary)">
          {t("Your name")}
        </label>
        <input
          id={nameId}
          class={cx(fieldControl, "text-[13px] select-text")}
          placeholder={t("Your name")}
          autocomplete="name"
          maxLength={NAME_MAX}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </div>
    </Show>
  );

  const changesForm = () => (
    <div class="flex flex-col gap-2">
      {nameField()}
      <textarea
        rows={3}
        maxLength={NOTE_MAX}
        aria-label={t("What should change?")}
        placeholder={t("What should change?")}
        class={cx(fieldControl, "h-auto resize-none py-2 text-[13px] leading-5 select-text")}
        value={note()}
        ref={(element) => queueMicrotask(() => element.focus())}
        onInput={(event) => setNote(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void decide("changes");
          if (event.key === "Escape") setWriting(false);
        }}
      />
      <div class="flex justify-end gap-1.5">
        <PlaneButton variant="ghost" size="lg" disabled={busy()} onClick={() => setWriting(false)}>
          {t("Cancel")}
        </PlaneButton>
        <PlaneButton size="lg" class="px-3" disabled={busy() || !note().trim() || !name().trim()} onClick={() => void decide("changes")}>
          {t("Send")}
        </PlaneButton>
      </div>
    </div>
  );

  return (
    <Show when={approval()}>
      {(current) => (
        <section aria-label={t("Approval")} class={CARD}>
          <Switch>
            <Match when={current().state === "pending"}>
              <div class="flex items-start gap-2.5">
                <span class={cx(BADGE, "bg-(--plane-layer-3) text-meter-yellow")}>
                  <ClockLucide class="size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <h2 class="text-[13px] leading-5 font-medium text-(--plane-text-primary)">{canReview() ? t("Waiting for your approval") : t("Waiting for approval")}</h2>
                  <p class="text-xs leading-5 text-(--plane-text-tertiary)">
                    {canReview()
                      ? timeAhead(props.preview)
                        ? t("It goes out {when} once you approve it.", { when: props.when })
                        : t("Its planned time has passed. Once you approve it, the team gives it a new one.")
                      : t("The workspace's owner and admins, or whoever they sent the link to, approve it.")}
                  </p>
                </div>
              </div>
              <Show when={canReview()}>
                <Show
                  when={writing()}
                  fallback={
                    <>
                      {nameField()}
                      <div class="grid grid-cols-2 gap-1.5">
                        <PlaneButton variant="secondary" size="lg" disabled={busy()} onClick={() => setWriting(true)}>
                          {t("Request changes")}
                        </PlaneButton>
                        <PlaneButton size="lg" disabled={busy() || !name().trim()} onClick={() => void decide("approved")}>
                          {t("Approve")}
                        </PlaneButton>
                      </div>
                    </>
                  }
                >
                  {changesForm()}
                </Show>
              </Show>
            </Match>
            <Match when={current().state === "changes"}>
              <div class="flex items-start gap-2.5">
                <span class={cx(BADGE, "bg-(--plane-layer-3) text-destructive")}>
                  <UndoLucide class="size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <h2 class="text-[13px] leading-5 font-medium text-(--plane-text-primary)">
                    {current().by ? t("{name} asked for changes", { name: current().by }) : t("Changes requested")}
                  </h2>
                  <p class="text-xs leading-5 text-(--plane-text-tertiary)">{t("The team is changing it. It comes back here once it's ready.")}</p>
                </div>
              </div>
              <Show when={current().note}>
                {(words) => <p class="whitespace-pre-wrap break-words rounded-md bg-(--plane-layer-2) px-3 py-2 text-[13px] leading-5 text-(--plane-text-primary) select-text">{words()}</p>}
              </Show>
              <Show when={canReview()}>
                {nameField()}
                <PlaneButton variant="secondary" size="lg" disabled={busy() || !name().trim()} onClick={() => void decide("approved")}>
                  {t("Approve it as it is")}
                </PlaneButton>
              </Show>
            </Match>
            <Match when={current().state === "approved"}>
              <div class="flex items-start gap-2.5">
                <span class={cx(BADGE, "bg-meter-green/15 text-meter-green")}>
                  <CheckLucide class="size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <h2 class="text-[13px] leading-5 font-medium text-(--plane-text-primary)">
                    {current().by ? t("Approved by {name}", { name: current().by }) : t("Approved")}
                  </h2>
                  <p class="text-xs leading-5 text-(--plane-text-tertiary)">
                    {status() === "scheduled"
                      ? t("It goes out {when}.", { when: props.when })
                      : status() === "posted"
                        ? t("It went out.")
                        : t("Its planned time passed, so the team gives it a new one.")}
                  </p>
                </div>
              </div>
              <Show when={canReview()}>
                <Show when={writing()} fallback={<button type="button" class={LINK} onClick={() => setWriting(true)}>{t("Changed your mind? Request changes")}</button>}>
                  {changesForm()}
                </Show>
              </Show>
            </Match>
          </Switch>
        </section>
      )}
    </Show>
  );
}
