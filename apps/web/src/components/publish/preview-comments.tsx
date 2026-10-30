/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The comments on a shared post preview, as the public page and the owner's
// share panel both show them: open threads first, each with its replies, and
// resolved ones folded away at the end. Anyone with the link comments and
// replies without an account, under a name asked once and then kept in this
// browser. The owner and their team comment under their own, and resolve.

import ArrowUpLucide from "lucide-solid/icons/arrow-up";
import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount, type JSX } from "solid-js";
import { toast } from "somoto";

import { PlaneButton, planeButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { fieldControl } from "@/components/publish/controls";
import { cx } from "@/lib/cva";
import { intlLocale, localized, rich, t } from "@/lib/i18n";
import { addComment, reviewerName, setCommentResolved, setReviewerName, type PreviewComment } from "@/lib/post-previews";

const BODY_MAX = 2000;
const NAME_MAX = 80;

/** The composer's box, as the Assistant draws its own. */
const BOX =
  "flex flex-col rounded-lg border border-(--plane-border-strong) bg-(--plane-layer-1) shadow-(--plane-shadow-raised-100) transition-colors focus-within:border-(--plane-text-placeholder)";
/** Reply, Resolve and the like: quiet words under a thread. */
const ACTION = "rounded-sm text-xs leading-5 font-medium text-(--plane-text-tertiary) outline-none hover:text-(--plane-text-primary) focus-ring";

const RELATIVE = localized((locale) => new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }));

/** How long ago a comment was left, as of `now`; past a week, its day. */
function ago(at: string, now: number): string {
  const time = new Date(at).getTime();
  const seconds = Math.round((time - now) / 1000);
  if (seconds > -60) return t("just now");
  if (seconds > -3600) return RELATIVE().format(Math.round(seconds / 60), "minute");
  if (seconds > -86_400) return RELATIVE().format(Math.round(seconds / 3600), "hour");
  if (seconds > -7 * 86_400) return RELATIVE().format(Math.round(seconds / 86_400), "day");
  return new Date(time).toLocaleDateString(intlLocale(), { month: "short", day: "numeric" });
}

type Thread = { comment: PreviewComment; replies: PreviewComment[] };

type ThreadsProps = {
  previewId: string;
  comments: readonly PreviewComment[];
  isOwner: boolean;
  /** The owner comments under the name on their account. */
  ownerName?: string;
  onChanged(): void | Promise<void>;
  /** Shown while there are none. */
  fallback?: JSX.Element;
  class?: string;
};

/**
 * The threads, oldest first, then the resolved ones under a fold. Drawn by
 * id, so a refresh that brings the same threads back leaves an open reply
 * and what's written in it alone.
 */
export function CommentThreads(props: ThreadsProps) {
  const threads = createMemo(() => {
    const replies = new Map<string, PreviewComment[]>();
    for (const comment of props.comments) {
      if (comment.parentId) replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment]);
    }
    const byId = new Map<string, Thread>();
    for (const comment of props.comments) {
      if (!comment.parentId) byId.set(comment.id, { comment, replies: replies.get(comment.id) ?? [] });
    }
    return byId;
  });
  const ids = (resolved: boolean) => [...threads().values()].filter((thread) => !!thread.comment.resolvedAt === resolved).map((thread) => thread.comment.id);
  const open = createMemo(() => ids(false));
  const resolved = createMemo(() => ids(true));
  const [showResolved, setShowResolved] = createSignal(false);

  // "5 min ago" moves on while the page stays open.
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));

  const thread = (id: string) => (
    <Show when={threads().get(id)}>
      {(current) => (
        <ThreadView
          previewId={props.previewId}
          thread={current()}
          now={now()}
          isOwner={props.isOwner}
          ownerName={props.ownerName}
          onChanged={props.onChanged}
        />
      )}
    </Show>
  );

  return (
    <Show
      when={threads().size}
      fallback={props.fallback ?? <p class="text-xs text-(--plane-text-tertiary)">{t("No comments yet.")}</p>}
    >
      <div class={cx("flex flex-col", props.class)}>
        <div class="flex flex-col divide-y divide-(--plane-border-subtle)">
          <For each={open()}>{(id) => thread(id)}</For>
        </div>
        <Show when={resolved().length}>
          <div class={cx("flex flex-col", open().length && "border-t border-(--plane-border-subtle) pt-2")}>
            <button
              type="button"
              aria-expanded={showResolved()}
              class={cx(ACTION, "flex h-8 items-center gap-1 self-start")}
              onClick={() => setShowResolved(!showResolved())}
            >
              <PlaneIcon name="chevron-right" class={cx("size-3.5 transition-transform", showResolved() && "rotate-90")} />
              {t("Resolved")}
              <span class="tabular-nums text-(--plane-text-placeholder)">{resolved().length}</span>
            </button>
            <Show when={showResolved()}>
              <div class="flex flex-col divide-y divide-(--plane-border-subtle)">
                <For each={resolved()}>{(id) => thread(id)}</For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** A name's first letter on a round tile; the post's own side in the brand's blue. */
function Initial(props: { name: string; author: boolean; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={cx(
        "grid size-6 shrink-0 place-items-center rounded-full text-[11px] leading-none font-semibold",
        props.author ? "bg-(--plane-accent-subtle) text-(--plane-accent-secondary)" : "bg-(--plane-layer-3) text-(--plane-text-secondary)",
        props.class,
      )}
    >
      {[...props.name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function CommentRow(props: { comment: PreviewComment; now: number }) {
  return (
    <div class="flex gap-2.5">
      <Initial name={props.comment.name} author={props.comment.byOwner} />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p class="flex min-w-0 items-center gap-1.5 leading-6">
          <span class="truncate text-[13px] font-medium text-(--plane-text-primary)">{props.comment.name}</span>
          <Show when={props.comment.byOwner}>
            <span class="shrink-0 rounded-md bg-(--plane-accent-subtle) px-1.5 py-0.5 text-xxs leading-[1.1] font-medium text-(--plane-accent-secondary)">
              {t("Author")}
            </span>
          </Show>
          <time
            class="shrink-0 text-xs text-(--plane-text-tertiary)"
            dateTime={props.comment.createdAt}
            title={new Date(props.comment.createdAt).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" })}
          >
            {ago(props.comment.createdAt, props.now)}
          </time>
        </p>
        <p class="whitespace-pre-wrap break-words text-[13px] leading-5 text-(--plane-text-primary) select-text">{props.comment.body}</p>
      </div>
    </div>
  );
}

function ThreadView(props: {
  previewId: string;
  thread: Thread;
  now: number;
  isOwner: boolean;
  ownerName?: string;
  onChanged(): void | Promise<void>;
}) {
  const [replying, setReplying] = createSignal(false);
  const resolved = () => !!props.thread.comment.resolvedAt;

  const toggleResolved = async () => {
    const error = await setCommentResolved(props.thread.comment.id, !resolved());
    if (error) toast.error(t(error));
    else await props.onChanged();
  };

  return (
    <article class="flex flex-col gap-3 py-3.5 first:pt-0" classList={{ "opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100": resolved() }}>
      <CommentRow comment={props.thread.comment} now={props.now} />
      <For each={props.thread.replies}>
        {(reply) => (
          <div class="pl-[34px]">
            <CommentRow comment={reply} now={props.now} />
          </div>
        )}
      </For>
      <Show when={!replying() && (!resolved() || props.isOwner)}>
        <div class="-mt-1 flex items-center gap-3 pl-[34px]">
          <Show when={!resolved()}>
            <button type="button" class={ACTION} onClick={() => setReplying(true)}>
              {t("Reply")}
            </button>
          </Show>
          <Show when={props.isOwner}>
            <button type="button" class={ACTION} onClick={() => void toggleResolved()}>
              {resolved() ? t("Reopen") : t("Resolve")}
            </button>
          </Show>
        </div>
      </Show>
      <Show when={replying() && !resolved()}>
        <div class="pl-[34px]">
          <CommentComposer
            previewId={props.previewId}
            parentId={props.thread.comment.id}
            ownerName={props.isOwner ? props.ownerName : undefined}
            autofocus
            onPosted={props.onChanged}
            onCancel={() => setReplying(false)}
          />
        </div>
      </Show>
    </article>
  );
}

/**
 * Writing a comment, or a reply under `parentId`. Someone without an account
 * gives their name first, once: it's kept in this browser and shown under the
 * box, where they can change it.
 */
export function CommentComposer(props: {
  previewId: string;
  parentId?: string;
  /** The owner comments under the name on their account. */
  ownerName?: string;
  /** Filled into the name field, for someone signed in to another account. */
  suggestedName?: string;
  autofocus?: boolean;
  onPosted(): void | Promise<void>;
  onCancel?(): void;
  class?: string;
}) {
  const [body, setBody] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const asking = () => !props.ownerName && (renaming() || !reviewerName());
  let field: HTMLTextAreaElement | undefined;

  const post = async () => {
    const text = body().trim();
    const who = props.ownerName || reviewerName();
    if (!text || !who || busy()) return;
    setBusy(true);
    try {
      const error = await addComment(props.previewId, who, text, props.parentId);
      if (error) {
        toast.error(t("Could not post the comment"), { description: t(error) });
        return;
      }
      setBody("");
      await props.onPosted();
      props.onCancel?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={!asking()}
      fallback={
        <NameStep
          initial={reviewerName() || props.suggestedName || ""}
          autofocus={props.autofocus || renaming()}
          class={props.class}
          onCancel={renaming() ? () => setRenaming(false) : props.onCancel}
          onDone={(name) => {
            setReviewerName(name);
            setRenaming(false);
            // The box takes the place of the question: carry on writing there.
            queueMicrotask(() => field?.focus());
          }}
        />
      }
    >
      <div class={cx(BOX, props.class)}>
        <textarea
          ref={(element) => {
            field = element;
            if (props.autofocus) queueMicrotask(() => element.focus());
          }}
          rows={2}
          class={cx(
            "w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-5 text-(--plane-text-primary) outline-none placeholder:text-(--plane-text-placeholder) select-text",
            props.parentId ? "min-h-12" : "min-h-16",
          )}
          placeholder={props.parentId ? t("Write a reply") : t("Add a comment")}
          aria-label={props.parentId ? t("Reply") : t("Comment")}
          maxLength={BODY_MAX}
          value={body()}
          onInput={(event) => setBody(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void post();
            } else if (event.key === "Escape" && props.onCancel && !body().trim()) {
              props.onCancel();
            }
          }}
        />
        <div class="flex min-w-0 items-center gap-2 p-2 pt-0">
          {/* Said once, under the main box: a reply is under the same name. */}
          <Show when={!props.ownerName && !props.parentId}>
            <p class="flex min-w-0 items-center gap-1 pl-1 text-xs text-(--plane-text-tertiary)">
              <span class="truncate">
                {rich("Commenting as {name}", { name: <span class="font-medium text-(--plane-text-secondary)">{reviewerName()}</span> })}
              </span>
              <span aria-hidden="true">·</span>
              <button type="button" class={ACTION} onClick={() => setRenaming(true)}>
                {t("Change")}
              </button>
            </p>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <Show when={props.onCancel}>
              <PlaneButton variant="ghost" size="lg" onClick={() => props.onCancel?.()}>
                {t("Cancel")}
              </PlaneButton>
            </Show>
            {/* The Assistant's send button. */}
            <button
              type="button"
              aria-label={props.parentId ? t("Reply") : t("Comment")}
              title={props.parentId ? t("Reply") : t("Comment")}
              disabled={!body().trim() || busy()}
              class={planeButton({ variant: "primary", size: "lg", class: "w-7 px-0" })}
              onClick={() => void post()}
            >
              <ArrowUpLucide class="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

/** Asked before someone without an account first comments: their name, nothing else. */
function NameStep(props: { initial: string; autofocus?: boolean; class?: string; onDone(name: string): void; onCancel?(): void }) {
  const [value, setValue] = createSignal(props.initial);
  const id = createUniqueId();
  let input!: HTMLInputElement;
  onMount(() => {
    if (props.autofocus) input.focus();
  });

  const done = () => {
    const name = value().trim().slice(0, NAME_MAX);
    if (name) props.onDone(name);
  };

  return (
    <form
      class={cx(BOX, "gap-2.5 p-3", props.class)}
      onSubmit={(event) => {
        event.preventDefault();
        done();
      }}
    >
      <div class="flex flex-col gap-0.5">
        <label for={id} class="text-[13px] leading-5 font-medium text-(--plane-text-primary)">
          {t("Who's commenting?")}
        </label>
        <p class="text-xs leading-4 text-(--plane-text-tertiary)">{t("No account needed. Your name shows next to your comments.")}</p>
      </div>
      <div class="flex items-center gap-1.5">
        <input
          id={id}
          ref={input}
          class={cx(fieldControl, "text-[13px] select-text")}
          placeholder={t("Your name")}
          autocomplete="name"
          maxLength={NAME_MAX}
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" && props.onCancel) props.onCancel();
          }}
        />
        <Show when={props.onCancel}>
          <PlaneButton variant="ghost" size="lg" onClick={() => props.onCancel?.()}>
            {t("Cancel")}
          </PlaneButton>
        </Show>
        <PlaneButton type="submit" size="lg" class="px-2.5" disabled={!value().trim()}>
          {t("Continue")}
        </PlaneButton>
      </div>
    </form>
  );
}

/** The share panel's: the box, then the threads under it. */
export function PreviewComments(props: Omit<ThreadsProps, "fallback">) {
  return (
    <div class={cx("flex flex-col gap-3", props.class)}>
      <CommentComposer previewId={props.previewId} ownerName={props.isOwner ? props.ownerName : undefined} onPosted={props.onChanged} />
      <CommentThreads
        previewId={props.previewId}
        comments={props.comments}
        isOwner={props.isOwner}
        ownerName={props.ownerName}
        onChanged={props.onChanged}
      />
    </div>
  );
}
