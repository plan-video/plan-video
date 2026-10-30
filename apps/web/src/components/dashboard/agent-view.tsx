/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Assistant: a chat that writes and schedules posts. The sidebar starts a new
// chat or opens an earlier one, and the middle is the chat. A new chat opens
// with one line, the message box and a few things to start with in the middle
// of the page; once something is sent, the box moves to the bottom. The
// channels it writes for are picked in the box. The same chat, drawn compact,
// is the panel that opens from the corner of every dashboard page
// (./assistant-panel), where the box stays at the bottom.

import { useSearchParams } from "@solidjs/router";
import { For, Index, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import ArrowUpLucide from "lucide-solid/icons/arrow-up";
import AtSignLucide from "lucide-solid/icons/at-sign";
import CheckLucide from "lucide-solid/icons/check";
import ChevronDownLucide from "lucide-solid/icons/chevron-down";
import CircleAlertLucide from "lucide-solid/icons/circle-alert";
import CopyLucide from "lucide-solid/icons/copy";
import ImagePlusLucide from "lucide-solid/icons/image-plus";
import RefreshCwLucide from "lucide-solid/icons/refresh-cw";
import SquareLucide from "lucide-solid/icons/square";
import ThumbsDownLucide from "lucide-solid/icons/thumbs-down";
import ThumbsUpLucide from "lucide-solid/icons/thumbs-up";
import XLucide from "lucide-solid/icons/x";

import { Markdown } from "@/agent-chat/markdown";
import { confirmButtons, confirmDetail, ConfirmPost, confirmTitle, TikTokConsent } from "@/components/agent-confirm";
import { Conversation, Shimmer } from "@/ai-editor/elements";
import { PlaneButton, planeButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { DashboardSidebarSection, dashboardNavItemClass } from "@/components/dashboard/sidebar";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { MediaPicker } from "@/components/publish/media-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/auth";
import {
  agentChat,
  chatItems,
  confirmAgentAction,
  deleteAgentChat,
  draftMedia,
  draftText,
  loadAgentChats,
  newAgentChat,
  openAgentChat,
  pickedChannels,
  rateAnswer,
  regenerateLast,
  retryAgent,
  sendToAgent,
  setDraftMedia,
  setDraftText,
  stopAgent,
  toggleChannel,
  type AnswerPart,
  type ChatItem,
  type Confirmation,
} from "@/lib/agent-chat";
import { toolLabel, type StepStatus } from "@/lib/agent-tools";
import { cx } from "@/lib/cva";
import { askForAccount } from "@/lib/guest";
import { msg, t } from "@/lib/i18n";
import { loadMediaLibrary, mediaItems, type MediaItem } from "@/lib/media-library";
import { PLATFORM_IDS, type PlatformId } from "@/lib/social";
import { accountLabel, loadSocialConnections, socialConnections } from "@/lib/social-connections";

/** Posts go out with one file each; a few cover a short series. */
const MAX_MEDIA = 4;
const MAX_INPUT_HEIGHT = 200;
/** The chat, the message box and the new chat's title share one column. */
const COLUMN = "mx-auto w-full max-w-[42rem]";

const ICON_BUTTON =
  "grid size-7 place-items-center rounded-md text-(--plane-text-tertiary) outline-none press hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring disabled:pointer-events-none disabled:opacity-40";

function useAgent() {
  const auth = useAuth();
  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
    loadAgentChats(auth.user());
  });
}

/** Connected accounts, in the order the networks are listed elsewhere. */
function channels() {
  const order = (platform: string) => {
    const index = (PLATFORM_IDS as readonly string[]).indexOf(platform as PlatformId);
    return index === -1 ? PLATFORM_IDS.length : index;
  };
  return [...socialConnections()].sort((a, b) => order(a.platform) - order(b.platform) || a.handle.localeCompare(b.handle));
}

/**
 * What a new chat offers to start with: a short name, and the message it puts
 * in the box. It fills the box rather than sending, so media can go with it.
 */
const STARTERS: readonly { label: string; prompt: string }[] = [
  { label: msg("Plan a week of posts"), prompt: msg("Write a week of posts about our launch, one a day at 18:00") },
  { label: msg("Schedule a video"), prompt: msg("Post this to TikTok on my best days over the next two weeks") },
  { label: msg("Find my best times"), prompt: msg("Which days and times do my posts do best?") },
  { label: msg("Cross-post to YouTube"), prompt: msg("Post my last TikTok to YouTube tomorrow at 9:00") },
];

function Title(props: { compact?: boolean }) {
  return (
    <h1
      class={cx(
        "text-center font-medium tracking-[-0.02em] text-(--plane-text-primary)",
        props.compact ? "text-[17px] leading-6" : "text-[24px] leading-8",
      )}
    >
      {t("What should we post?")}
    </h1>
  );
}

function Starters(props: { onPick(text: string): void }) {
  return (
    <div class="flex flex-wrap justify-center gap-2">
      <For each={STARTERS}>
        {(starter) => (
          <button
            type="button"
            class="h-8 rounded-full border border-(--plane-border-subtle-1) bg-(--plane-surface-1) px-3.5 text-[13px] leading-5 text-(--plane-text-secondary) outline-none press hover:border-(--plane-border-strong) hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring"
            onClick={() => props.onPick(t(starter.prompt))}
          >
            {t(starter.label)}
          </button>
        )}
      </For>
    </div>
  );
}

/** Assistant text, at the dashboard's base size (index.css .assistant-prose). Nothing in it loads from elsewhere. */
function Prose(props: { text: string }) {
  return (
    <div class="assistant-prose text-(--plane-text-primary)">
      <Markdown text={props.text} local />
    </div>
  );
}

/** A step as shown: a tool call, or the model working out what to do next. */
type StepView = { name: string; status: StepStatus | "thinking" };

/** The mark at the start of a step. Each state has its own shape, so it reads without colour. */
function StepMark(props: { status: StepView["status"] }) {
  return (
    <Switch>
      <Match when={props.status === "done"}>
        <span class="grid size-4 shrink-0 place-items-center rounded-full bg-(--plane-layer-3) text-(--plane-text-secondary)">
          <CheckLucide class="size-2.5" stroke-width={3} aria-hidden="true" />
        </span>
      </Match>
      <Match when={props.status === "error"}>
        <span class="grid size-4 shrink-0 place-items-center rounded-full bg-(--plane-danger-subtle) text-(--plane-danger-text)">
          <XLucide class="size-2.5" stroke-width={3} aria-hidden="true" />
        </span>
      </Match>
      <Match when={props.status === "running"}>
        <span class="size-4 shrink-0 animate-spin rounded-full border-[1.5px] border-(--plane-border-strong) border-t-(--plane-accent-primary) motion-reduce:animate-none" />
      </Match>
      <Match when={props.status === "waiting"}>
        <span class="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] border-(--plane-accent-primary)">
          <span class="size-1.5 rounded-full bg-(--plane-accent-primary)" />
        </span>
      </Match>
      <Match when={props.status === "thinking"}>
        <span class="grid size-4 shrink-0 place-items-center">
          <span class="size-1.5 animate-pulse rounded-full bg-(--plane-text-tertiary) motion-reduce:animate-none" />
        </span>
      </Match>
    </Switch>
  );
}

/** A run of steps, each mark joined to the next by a short rule, so they read as one sequence. */
function Steps(props: { steps: readonly StepView[] }) {
  return (
    <ol class="flex flex-col" aria-label={t("What the Assistant did")}>
      <For each={props.steps}>
        {(step, index) => {
          const moving = () => step.status === "running" || step.status === "thinking";
          return (
            <li class="relative flex h-6 items-center gap-2.5 text-[12px] leading-5">
              <StepMark status={step.status} />
              <Show when={index() < props.steps.length - 1}>
                <span aria-hidden="true" class="absolute top-5 left-[7.5px] h-2 w-px bg-(--plane-border-subtle)" />
              </Show>
              <Show
                when={moving()}
                fallback={
                  <span
                    class={cx(
                      "min-w-0 truncate",
                      step.status === "error" && "text-(--plane-danger-text)",
                      step.status === "waiting" && "text-(--plane-text-secondary)",
                      step.status === "done" && "text-(--plane-text-tertiary)",
                    )}
                  >
                    {t(toolLabel(step.name, step.status as StepStatus))}
                  </span>
                }
              >
                <span class="min-w-0 truncate">
                  <Shimmer>{step.status === "thinking" ? t("Thinking") : t(toolLabel(step.name, "running"))}</Shimmer>
                </span>
              </Show>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/** Asks before a post is published, deleted, sent within minutes or put on a TikTok profile. None of them runs until the person says yes here. */
function ConfirmCard(props: { confirm: Confirmation }) {
  const removing = () => props.confirm.tool === "delete_post";
  const buttons = () => confirmButtons(props.confirm);
  return (
    <div role="group" aria-label={confirmTitle(props.confirm)} class="flex flex-col gap-3 rounded-lg border border-(--plane-border-subtle) bg-(--plane-layer-1) p-3.5">
      <div class="flex flex-col gap-0.5">
        <span class="text-[13px] leading-5 font-medium text-(--plane-text-primary)">{confirmTitle(props.confirm)}</span>
        <span class="text-[12px] leading-5 text-(--plane-text-tertiary)">{confirmDetail(props.confirm)}</span>
      </div>
      <div class="flex flex-col gap-1 border-t border-(--plane-border-subtle) pt-3">
        <ConfirmPost
          request={props.confirm}
          class="flex max-h-80 flex-col gap-1 overflow-y-auto"
          muted="text-[12px] leading-5 text-(--plane-text-secondary)"
          text="text-[13px] leading-6 text-(--plane-text-primary)"
        />
        <Show when={props.confirm.tiktok}>
          {(tiktok) => <TikTokConsent branded={tiktok().branded} class="text-[12px] leading-5 text-(--plane-text-tertiary)" />}
        </Show>
      </div>
      <div class="flex items-center gap-1.5">
        <PlaneButton
          variant={removing() ? "secondary" : "primary"}
          size="lg"
          class={removing() ? "text-(--plane-danger-text)" : undefined}
          onClick={() => confirmAgentAction(true)}
        >
          {buttons().yes}
        </PlaneButton>
        <PlaneButton variant="ghost" size="lg" onClick={() => confirmAgentAction(false)}>
          {buttons().no}
        </PlaneButton>
      </div>
    </div>
  );
}

function MediaThumb(props: { item: MediaItem; onRemove?: () => void }) {
  return (
    <span class="group relative block size-12 shrink-0 overflow-hidden rounded-md bg-black ring-1 ring-(--plane-border-subtle)" title={props.item.name}>
      <img src={props.item.poster} alt="" class="size-full object-cover" draggable={false} />
      <Show when={props.onRemove}>
        {(remove) => (
          <button
            type="button"
            aria-label={t("Remove {name}", { name: props.item.name })}
            class="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/70 text-white opacity-0 outline-none transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => remove()()}
          >
            <XLucide class="size-3" aria-hidden="true" />
          </button>
        )}
      </Show>
    </span>
  );
}

function UserMessage(props: { item: Extract<ChatItem, { kind: "user" }> }) {
  const media = () => props.item.media.map((id) => mediaItems().find((item) => item.id === id)).filter((item): item is MediaItem => !!item);
  return (
    <div class="ml-auto flex max-w-[80%] flex-col items-end gap-1.5">
      <Show when={media().length}>
        <div class="flex flex-wrap justify-end gap-1.5">
          <For each={media()}>{(item) => <MediaThumb item={item} />}</For>
        </div>
      </Show>
      <div class="w-fit max-w-full rounded-xl bg-(--plane-layer-3) px-4 py-2.5 text-[14px] leading-[1.6] break-words whitespace-pre-wrap text-(--plane-text-primary)">
        {props.item.text}
      </div>
    </div>
  );
}

type AnswerGroup = { kind: "text"; text: string } | { kind: "steps"; steps: StepView[] };
type ShownPart = { kind: "text"; text: string } | { kind: "tool"; name: string; status: StepView["status"] };

/** An answer's parts, with tool calls that follow one another gathered into one run of steps. */
function grouped(parts: readonly ShownPart[]): AnswerGroup[] {
  const groups: AnswerGroup[] = [];
  for (const part of parts) {
    const last = groups[groups.length - 1];
    if (part.kind === "text") groups.push({ kind: "text", text: part.text });
    else if (last?.kind === "steps") last.steps.push({ name: part.name, status: part.status });
    else groups.push({ kind: "steps", steps: [{ name: part.name, status: part.status }] });
  }
  return groups;
}

function Answer(props: { item: Extract<ChatItem, { kind: "answer" }>; last: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const working = () => props.last && agentChat.busy;
  /**
   * What shows: the saved parts, and while it works, the step on its way after them, so it joins the
   * steps before it. A call still running once the turn has ended never finished.
   */
  const parts = (): ShownPart[] => {
    const shown: ShownPart[] = props.item.parts.map((part) => {
      if (part.kind === "text" || part.status !== "running") return part;
      if (!agentChat.busy) return { ...part, status: "error" };
      return agentChat.confirm?.tool === part.name ? { ...part, status: "waiting" } : part;
    });
    if (!working()) return shown;
    if (agentChat.live.text) shown.push({ kind: "text", text: agentChat.live.text });
    const last = shown.at(-1);
    const busyStep = last?.kind === "tool" && (last.status === "running" || last.status === "waiting");
    if (agentChat.live.tool) shown.push({ kind: "tool", name: agentChat.live.tool, status: "running" });
    // Between steps, the model is working out what to do next.
    else if (!agentChat.live.text && !busyStep) shown.push({ kind: "tool", name: "thinking", status: "thinking" });
    return shown;
  };
  const text = () =>
    props.item.parts
      .filter((part): part is Extract<AnswerPart, { kind: "text" }> => part.kind === "text")
      .map((part) => part.text)
      .join("\n\n");
  const rating = () => agentChat.feedback[props.item.key];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be refused; nothing to undo.
    }
  };

  return (
    <div class="group/answer flex flex-col gap-2.5">
      <Index each={grouped(parts())}>
        {(group) => (
          <Switch>
            <Match when={group().kind === "text" && (group() as Extract<AnswerGroup, { kind: "text" }>)}>{(entry) => <Prose text={entry().text} />}</Match>
            <Match when={group().kind === "steps" && (group() as Extract<AnswerGroup, { kind: "steps" }>)}>
              {(entry) => <Steps steps={entry().steps} />}
            </Match>
          </Switch>
        )}
      </Index>
      <Show when={working() && agentChat.confirm}>{(confirm) => <ConfirmCard confirm={confirm()} />}</Show>
      <Show when={!working() && text()}>
        {/* Earlier answers keep their buttons out of the way until pointed at. */}
        <div
          class={cx(
            "-mt-1 -ml-1.5 flex items-center gap-0.5",
            !props.last && "opacity-0 transition-opacity group-hover/answer:opacity-100 focus-within:opacity-100",
          )}
        >
          <Show when={props.last && !props.item.changed}>
            <button type="button" class={ICON_BUTTON} aria-label={t("Write again")} title={t("Write again")} onClick={() => void regenerateLast()}>
              <RefreshCwLucide class="size-3.5" aria-hidden="true" />
            </button>
          </Show>
          <button type="button" class={ICON_BUTTON} aria-label={t("Copy")} title={copied() ? t("Copied") : t("Copy")} onClick={() => void copy()}>
            <Show when={copied()} fallback={<CopyLucide class="size-3.5" aria-hidden="true" />}>
              <CheckLucide class="size-3.5" aria-hidden="true" />
            </Show>
          </button>
          <button
            type="button"
            class={cx(ICON_BUTTON, rating() === "up" && "text-(--plane-text-primary)")}
            aria-label={t("Good answer")}
            aria-pressed={rating() === "up"}
            title={t("Good answer")}
            onClick={() => rateAnswer(props.item.key, "up")}
          >
            <ThumbsUpLucide class="size-3.5" aria-hidden="true" fill={rating() === "up" ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            class={cx(ICON_BUTTON, rating() === "down" && "text-(--plane-text-primary)")}
            aria-label={t("Bad answer")}
            aria-pressed={rating() === "down"}
            title={t("Bad answer")}
            onClick={() => rateAnswer(props.item.key, "down")}
          >
            <ThumbsDownLucide class="size-3.5" aria-hidden="true" fill={rating() === "down" ? "currentColor" : "none"} />
          </button>
        </div>
      </Show>
    </div>
  );
}

/** Who the Assistant writes for, picked where the message is typed, on the page and in the panel alike. */
function ChannelPicker() {
  const [, setParams] = useSearchParams();
  const picked = () => new Set(pickedChannels());
  const accounts = () => channels().filter((account) => picked().has(account.id));
  const names = () => accounts().map((account) => accountLabel(account));
  const label = () => (names().length <= 2 ? names().join(", ") : `${names().slice(0, 2).join(", ")} +${names().length - 2}`);

  return (
    <DropdownMenu placement="top-start">
      <DropdownMenuTrigger
        as="button"
        type="button"
        aria-label={t("Channels")}
        title={accounts().length ? t("Writing for {channels}", { channels: names().join(", ") }) : undefined}
        class="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] leading-5 text-(--plane-text-tertiary) outline-none press hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-ring data-expanded:bg-(--plane-layer-transparent-active) data-expanded:text-(--plane-text-primary)"
      >
        <Show
          when={accounts().length}
          fallback={
            <>
              <AtSignLucide class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="truncate">{t("Channels")}</span>
            </>
          }
        >
          <span class="flex shrink-0 items-center gap-1">
            <For each={accounts().slice(0, 3)}>{(account) => <AccountAvatar account={account} class="size-4" />}</For>
          </span>
          <span class="truncate">{label()}</span>
        </Show>
        <ChevronDownLucide class="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-60 gap-0.5">
          <For each={channels()}>
            {(account) => (
              <DropdownMenuItem tone="neutral" closeOnSelect={false} class="gap-2" onSelect={() => toggleChannel(account.id)}>
                <AccountAvatar account={account} class="size-4" />
                <span class="min-w-0 flex-1 truncate">{accountLabel(account)}</span>
                <Show when={picked().has(account.id)}>
                  <CheckLucide class="size-3.5 text-(--plane-text-secondary)" aria-hidden="true" />
                </Show>
              </DropdownMenuItem>
            )}
          </For>
          <Show when={channels().length}>
            <DropdownMenuSeparator />
          </Show>
          <DropdownMenuItem tone="neutral" class="gap-2" onSelect={() => setParams({ dashboard: "connections" })}>
            <PlaneIcon name="plus" class="size-3.5" />
            <span class="flex-1">{t("Connect a channel")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

/** The message box. What's in it is the one draft the panel and the page share (lib/agent-chat). */
function Composer(props: { placeholder: string; compact?: boolean; class?: string; ref(input: HTMLTextAreaElement): void }) {
  const auth = useAuth();
  let input: HTMLTextAreaElement | undefined;

  createEffect(() => {
    void draftText();
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  });

  // A new or reopened chat starts with the cursor in the box.
  createEffect(() => {
    void agentChat.id;
    queueMicrotask(() => input?.focus());
  });

  /** The picker hands back files; the library item each came from is what the agent names. */
  const pick = (files: File[]) => {
    const items = files
      .map((file) => mediaItems().find((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))
      .filter((item): item is MediaItem => !!item);
    setDraftMedia((current) => [...current, ...items.filter((item) => !current.some((row) => row.id === item.id))].slice(0, MAX_MEDIA));
  };

  const canSend = () => !agentChat.busy && (!!draftText().trim() || draftMedia().length > 0);

  const submit = () => {
    if (!canSend()) return;
    // The agent runs on the server, for accounts: a guest is asked to make one.
    if (auth.isGuest()) return askForAccount({ reason: "agent" });
    void sendToAgent(draftText(), draftMedia());
    setDraftText("");
    setDraftMedia([]);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div class={cx("shrink-0", props.compact ? "px-3" : "px-6", props.class)}>
      <div
        class={cx(
          !props.compact && COLUMN,
          "assistant-composer flex flex-col rounded-xl border border-(--plane-border-subtle-1) bg-(--plane-layer-2) transition-colors focus-within:border-(--plane-border-strong)",
        )}
      >
        <Show when={draftMedia().length}>
          <div class="flex flex-wrap gap-1.5 px-3.5 pt-3.5">
            <For each={draftMedia()}>
              {(item) => <MediaThumb item={item} onRemove={() => setDraftMedia((current) => current.filter((row) => row.id !== item.id))} />}
            </For>
          </div>
        </Show>
        <textarea
          ref={(element) => {
            input = element;
            props.ref(element);
          }}
          value={draftText()}
          rows={2}
          aria-label={t("Message the Assistant")}
          placeholder={props.placeholder}
          onInput={(event) => setDraftText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          class="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-[22px] text-(--plane-text-primary) caret-(--plane-accent-primary) outline-none placeholder:text-(--plane-text-placeholder)"
        />
        <div class="flex items-center gap-0.5 px-2.5 pb-2.5">
          <MediaPicker label={t("Insert media")} kinds={["video", "image"]} max={MAX_MEDIA} onPick={pick} class={ICON_BUTTON}>
            <ImagePlusLucide class="size-4" aria-hidden="true" />
          </MediaPicker>
          <ChannelPicker />
          <div class="ml-auto shrink-0">
            <Show
              when={agentChat.busy}
              fallback={
                <button
                  type="button"
                  aria-label={t("Send")}
                  disabled={!canSend()}
                  class={planeButton({ variant: "primary", size: "lg", class: "size-7 rounded-full px-0" })}
                  onClick={submit}
                >
                  <ArrowUpLucide class="size-4" aria-hidden="true" />
                </button>
              }
            >
              <button type="button" aria-label={t("Stop")} class={planeButton({ variant: "secondary", size: "lg", class: "size-7 rounded-full px-0" })} onClick={stopAgent}>
                <SquareLucide class="size-3" fill="currentColor" aria-hidden="true" />
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The sidebar's top button, where Schedule has New post. */
export function DashboardAssistantNewChat() {
  return (
    <PlaneButton variant="secondary" size="xl" class="w-full justify-start gap-1.5" disabled={agentChat.busy} onClick={newAgentChat}>
      <PlaneIcon name="edit" class="size-4 text-(--plane-text-secondary)" />
      <span class="truncate text-sm font-medium">{t("New chat")}</span>
    </PlaneButton>
  );
}

/** The sidebar's earlier chats, newest first. */
export function DashboardAssistantChats() {
  useAgent();
  return (
    <Show when={agentChat.list.length}>
      <DashboardSidebarSection title={t("Chats")}>
        <For each={agentChat.list}>
          {(chat) => (
            <div class="group/chat relative">
              <button
                type="button"
                aria-current={agentChat.id === chat.id ? "page" : undefined}
                disabled={agentChat.busy && agentChat.id !== chat.id}
                class={cx(dashboardNavItemClass(agentChat.id === chat.id), "pr-8 disabled:opacity-60")}
                onClick={() => void openAgentChat(chat.id)}
              >
                <span class="min-w-0 truncate py-px text-sm leading-5">{chat.title}</span>
              </button>
              <button
                type="button"
                aria-label={t("Delete {title}", { title: chat.title })}
                title={t("Delete chat")}
                disabled={agentChat.busy && agentChat.id === chat.id}
                class="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-(--plane-text-tertiary) opacity-0 outline-none group-hover/chat:opacity-100 hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-visible:opacity-100 focus-ring disabled:hidden"
                onClick={() => void deleteAgentChat(chat.id)}
              >
                <PlaneIcon name="trash" class="size-3.5" />
              </button>
            </div>
          )}
        </For>
      </DashboardSidebarSection>
    </Show>
  );
}

/**
 * The chat itself: the conversation and the message box. On the page it keeps
 * to a reading column; `compact` is the corner panel's narrower drawing.
 */
export function AssistantChat(props: { compact?: boolean }) {
  useAgent();
  // Inserted media shows in the messages that carry it.
  void loadMediaLibrary();

  const items = () => chatItems();
  const sent = () => items().filter((item) => item.kind === "user").length;
  const lastIsAnswer = () => items()[items().length - 1]?.kind === "answer";
  const canRetry = () => !agentChat.busy && !!agentChat.error && !lastIsAnswer();
  /** A new chat, before anything is sent: the box sits in the middle with things to ask. */
  const fresh = () => !agentChat.opening && !agentChat.busy && !agentChat.error && !items().length;
  const column = () => (props.compact ? "w-full" : COLUMN);

  let input: HTMLTextAreaElement | undefined;
  const suggest = (text: string) => {
    setDraftText(text);
    input?.focus();
    input?.setSelectionRange(text.length, text.length);
  };

  return (
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <Show
        when={!fresh()}
        fallback={
          <Show
            when={props.compact}
            fallback={
              <div class="flex flex-1 flex-col justify-end px-6 pb-6">
                <Title />
              </div>
            }
          >
            {/* The panel keeps its box at the bottom; the start sits in the room above it. */}
            <div class="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-4">
              <Title compact />
              <Starters onPick={suggest} />
            </div>
          </Show>
        }
      >
        <Conversation pin={() => `${agentChat.id}:${sent()}`} fade>
          <div class={cx(column(), "flex flex-col gap-6", props.compact ? "py-2" : "py-4")}>
            <Show when={!agentChat.opening} fallback={<Shimmer>{t("Opening the chat…")}</Shimmer>}>
              <For each={items()}>
                {(item, index) => (
                  <Switch>
                    <Match when={item.kind === "user" && item}>{(entry) => <UserMessage item={entry()} />}</Match>
                    <Match when={item.kind === "answer" && item}>{(entry) => <Answer item={entry()} last={index() === items().length - 1} />}</Match>
                  </Switch>
                )}
              </For>
            </Show>
            {/* Before a turn's first words, the answer has no place yet. */}
            <Show when={agentChat.busy && !lastIsAnswer()}>
              <Answer item={{ kind: "answer", key: "live", parts: [], changed: false }} last />
            </Show>
            <Show when={agentChat.error}>
              {(error) => (
                <div class="flex items-center gap-2 text-[12px] leading-5 text-(--plane-danger-text)">
                  <CircleAlertLucide class="size-3.5 shrink-0" aria-hidden="true" />
                  <span class="min-w-0">{t(error())}</span>
                  <Show when={canRetry()}>
                    <PlaneButton variant="ghost" size="base" onClick={() => void retryAgent()}>
                      {t("Try again")}
                    </PlaneButton>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Conversation>
      </Show>
      <Composer
        compact={props.compact}
        placeholder={fresh() ? t("Describe a post, or ask about your numbers…") : t("Reply…")}
        class={props.compact ? "pb-3" : fresh() ? undefined : "pb-5"}
        ref={(element) => (input = element)}
      />
      {/* On the page, a little more room below than above, so the group sits just over the middle. */}
      <Show when={fresh() && !props.compact}>
        <div class="flex flex-[1.3] flex-col px-6 pt-5">
          <div class={COLUMN}>
            <Starters onPick={suggest} />
          </div>
        </div>
      </Show>
    </div>
  );
}

export function DashboardAgentView() {
  return <AssistantChat />;
}
