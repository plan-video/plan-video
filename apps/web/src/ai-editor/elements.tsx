/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// After AI Elements (elements.ai-sdk.dev), in Solid.

import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { Collapsible } from "@kobalte/core/collapsible";

import { Icon } from "@/components/ui/icon";
import { t } from "@/lib/i18n";

import "@/agent-chat/activity.css";

/** `fade` dissolves the messages at the scroller's ends rather than cutting them. */
export function Conversation(props: { children: JSX.Element; pin: () => unknown; fade?: boolean }) {
  let scroller!: HTMLDivElement;
  let content!: HTMLDivElement;
  const [atBottom, setAtBottom] = createSignal(true);

  const toBottom = (behavior: ScrollBehavior = "auto") => scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  const handleScroll = () => setAtBottom(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24);

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (atBottom()) toBottom();
    });
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });

  createEffect(on(props.pin, () => {
    setAtBottom(true);
    queueMicrotask(() => toBottom());
  }, { defer: true }));

  return (
    <div class="relative min-h-0 flex-1" role="log">
      <div
        ref={scroller}
        onScroll={handleScroll}
        class="h-full overflow-y-auto"
        classList={{ "[mask-image:linear-gradient(to_bottom,transparent,black_1.25rem,black_calc(100%-1.25rem),transparent)]": !!props.fade }}
      >
        <div ref={content} class="flex flex-col gap-6 p-4">
          {props.children}
        </div>
      </div>
      <Show when={!atBottom()}>
        <button
          type="button"
          aria-label={t("Scroll to the latest message")}
          class="absolute bottom-3 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-border-input bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-ring"
          onClick={() => toBottom("smooth")}
        >
          <Icon name="arrow-top" class="size-4 rotate-180" />
        </button>
      </Show>
    </div>
  );
}

export function ConversationEmptyState(props: { title: string; description: string; children?: JSX.Element }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon name="ai-generate" class="size-6 text-muted-foreground" />
      <div class="space-y-1">
        <h3 class="text-[13px] font-450 text-foreground">{props.title}</h3>
        <p class="text-[12px] leading-5 text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
    </div>
  );
}

export function Message(props: { from: "user" | "assistant"; children: JSX.Element }) {
  return (
    <div
      class="flex w-full max-w-[95%] flex-col gap-2"
      classList={{ "ml-auto items-end": props.from === "user" }}
    >
      <Show when={props.from === "user"} fallback={<div class="flex min-w-0 max-w-full flex-col gap-3">{props.children}</div>}>
        <div class="w-fit max-w-full whitespace-pre-wrap break-words rounded-lg bg-secondary px-3 py-2 text-[12px] leading-5 text-foreground">
          {props.children}
        </div>
      </Show>
    </div>
  );
}

export function Shimmer(props: { children: string }) {
  return <span class="agent-shimmer">{props.children}</span>;
}

const AUTO_CLOSE_DELAY_MS = 1000;

/** Open while it works, closed a moment after it finishes, and reopenable at any time. */
export function Reasoning(props: { streaming: boolean; seconds?: number; children: JSX.Element }) {
  const [open, setOpen] = createSignal(props.streaming);
  let streamed = props.streaming;
  let autoClosed = false;

  createEffect(on(() => props.streaming, (streaming) => {
    if (streaming) {
      streamed = true;
      setOpen(true);
      return;
    }
    if (!streamed || autoClosed) return;
    const timer = setTimeout(() => {
      setOpen(false);
      autoClosed = true;
    }, AUTO_CLOSE_DELAY_MS);
    onCleanup(() => clearTimeout(timer));
  }));

  const label = () => {
    if (props.seconds === undefined) return t("Thought for a few seconds");
    return t("Thought for {seconds, plural, one {# second} other {# seconds}}", { seconds: props.seconds });
  };

  return (
    <Collapsible open={open()} onOpenChange={setOpen} class="w-full">
      <Collapsible.Trigger class="flex w-full items-center gap-2 text-[12px] leading-5 text-muted-foreground transition-colors hover:text-foreground focus-ring rounded-sm">
        <Icon name="ai-generate" class="size-4 shrink-0" />
        <Show when={props.streaming} fallback={<span>{label()}</span>}>
          <Shimmer>{t("Thinking...")}</Shimmer>
        </Show>
        <Icon name="chevron-down" class={`size-4 shrink-0 transition-transform ${open() ? "rotate-180" : ""}`} />
      </Collapsible.Trigger>
      <Collapsible.Content class="mt-3 space-y-3 outline-none data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:slide-in-from-top-2 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:slide-out-to-top-2">
        {props.children}
      </Collapsible.Content>
    </Collapsible>
  );
}

export type StepStatus = "active" | "complete" | "error";

export function ChainStep(props: {
  icon: string;
  status: StepStatus;
  spin?: boolean;
  last: boolean;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class="flex gap-2 text-[12px] leading-5 animate-in fade-in-0 slide-in-from-top-2"
      classList={{
        "text-foreground": props.status === "active",
        "text-muted-foreground": props.status === "complete",
        "text-destructive": props.status === "error",
      }}
    >
      <div class="relative mt-0.5 shrink-0">
        <Icon name={props.icon} class={`size-4 ${props.spin ? "animate-spin" : ""}`} />
        <Show when={!props.last}>
          <div class="absolute top-[19px] -bottom-[11px] left-1/2 -mx-px w-px bg-muted-foreground/25" />
        </Show>
      </div>
      <div class="min-w-0 flex-1 space-y-1">
        {props.children}
        <Show when={props.description}>
          <div class="text-[11px] leading-4 text-muted-foreground">{props.description}</div>
        </Show>
      </div>
    </div>
  );
}
