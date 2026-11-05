/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { PlatformLogo } from "@/components/publish/controls";
import { useAuth } from "@/context/auth";
import { AvatarPhoto, useAvatar } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { dashboardRailLabels, dashboardTheme } from "@/lib/dashboard-theme";
import { intlLocale, msg, t } from "@/lib/i18n";
import { QUEUE_WEEKDAYS, type QueueSlot } from "@/lib/queue-slots";
import type { PlatformId } from "@/lib/social";
import { accountLabel, socialConnections } from "@/lib/social-connections";
import type { Workspace } from "@/lib/workspaces";

import { planeButton } from "./plane-button";
import { PlaneIcon, type PlaneIconName } from "./plane-icons";
import { WorkspaceBadge } from "./workspace-switcher";

const RAIL: { icon: PlaneIconName; label: string }[] = [
  { icon: "calendar", label: msg({ message: "Schedule", context: "noun" }) },
  { icon: "project", label: msg("Projects") },
  { icon: "layer-stack", label: msg("Library") },
  { icon: "agent", label: msg("Assistant") },
  { icon: "plug", label: msg("Plugs") },
  { icon: "analytics", label: msg("Analytics") },
];

const PAGES: { icon: PlaneIconName; label: string; active?: boolean }[] = [
  { icon: "calendar", label: msg("Calendar"), active: true },
  { icon: "layers", label: msg("Bulk tools") },
];

const POST_PAGES: { icon: PlaneIconName; label: string }[] = [
  { icon: "clock", label: msg("Scheduled") },
  { icon: "draft", label: msg("Drafts") },
  { icon: "check", label: msg("Posted") },
];

/** More weeks and accounts than ever fit, so the window runs off the card on any screen. */
const WEEKS = 9;
const SHOWN_ACCOUNTS = 12;

const WINDOW_WIDTH = 1100;
const FULL_SIZE_AT = 820;
const MAX_SCALE = 1.15;
const SHOWN = { across: 0.72, down: 0.9 };
/** Grows with the card, so a big screen shows more sky rather than only more calendar. */
const insetFor = (cardWidth: number) => Math.max(40, Math.round(cardWidth * 0.08));

const STARS = (() => {
  let seed = 7;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let mix = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mix = (mix + Math.imul(mix ^ (mix >>> 7), 61 | mix)) ^ mix;
    return ((mix ^ (mix >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 150 }, () => ({
    x: random() * 100,
    y: Math.pow(random(), 1.6) * 72,
    r: random() < 0.12 ? 1.25 : 0.55 + random() * 0.45,
    opacity: 0.35 + random() * 0.6,
  }));
})();

function calendarDays(today: Date) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: WEEKS * 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
}

function PreviewRailItem(props: { icon: PlaneIconName; label: string; active?: boolean }) {
  return (
    <span class="flex flex-col items-center gap-0.5">
      <span
        class={cx(
          "grid size-8 place-items-center rounded-md",
          props.active ? "bg-(--plane-layer-transparent-active) text-(--plane-text-primary)" : "text-(--plane-text-tertiary)",
        )}
      >
        <PlaneIcon name={props.icon} class="size-5" />
      </span>
      <Show when={dashboardRailLabels()}>
        <span class={cx("text-center text-xxs leading-[1.1] font-medium [word-break:keep-all]", props.active ? "text-(--plane-text-primary)" : "text-(--plane-text-tertiary)")}>
          {t(props.label)}
        </span>
      </Show>
    </span>
  );
}

function PreviewNavItem(props: { icon: PlaneIconName; label: string; active?: boolean }) {
  return (
    <span class={cx("flex items-center gap-2 rounded-md px-2 py-1", props.active ? "bg-(--plane-layer-transparent-active) text-(--plane-text-primary)" : "text-(--plane-text-secondary)")}>
      <PlaneIcon name={props.icon} class={cx("size-4", props.active ? "text-(--plane-text-primary)" : "text-(--plane-text-tertiary)")} />
      <span class="truncate text-sm leading-5 font-medium">{t(props.label)}</span>
    </span>
  );
}

/** Drawn with the dashboard's own tokens and pieces, so it answers every choice as the real one will. */
function DashboardWindow(props: { workspace: Workspace; name: string; slots: readonly QueueSlot[] }) {
  const auth = useAuth();
  const avatarUrl = useAvatar();
  const today = new Date();
  const days = calendarDays(today);
  const isToday = (day: Date) => day.toDateString() === today.toDateString();
  const started = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const slotsOn = (day: Date) => (day < started ? [] : props.slots.filter((slot) => slot.weekday === day.getDay()).sort((a, b) => a.time.localeCompare(b.time)));
  const initial = () => (auth.user()?.user_metadata?.full_name || auth.user()?.email || "U").charAt(0).toUpperCase();

  return (
    <div
      class="flex flex-col overflow-hidden rounded-[8px] bg-(--plane-canvas) shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35)] ring-1 ring-white/[0.08]"
      style={{ "--rail-width": dashboardRailLabels() ? "4.75rem" : "3rem" }}
    >
      <div class="flex h-10 shrink-0 items-center px-3.5">
        <div class="flex min-w-0 flex-1 items-center gap-2 pl-[calc(var(--rail-width)/2-1.75rem)]">
          <WorkspaceBadge workspace={props.workspace} class="size-7 rounded-lg text-sm" />
          <span class="truncate text-sm font-medium text-(--plane-text-primary)">{props.name}</span>
          <PlaneIcon name="chevron-down" class="size-3.5 shrink-0 text-(--plane-text-tertiary)" />
        </div>
        <span class="flex h-7 w-60 items-center gap-1.5 rounded-md bg-(--plane-layer-transparent-hover) px-2 text-sm text-(--plane-text-placeholder)">
          <PlaneIcon name="search" class="size-3.5" />
          {t("Search")}
        </span>
        <div class="flex flex-1 items-center justify-end gap-1">
          <span class="grid size-8 place-items-center text-(--plane-text-tertiary)">
            <PlaneIcon name="inbox" class="size-5" />
          </span>
          <span class="grid size-8 place-items-center">
            <AvatarPhoto
              url={avatarUrl()}
              class="size-6 rounded-full object-cover"
              fallback={<span class="grid size-6 place-items-center rounded-full bg-(--plane-layer-3) text-xxs font-medium text-(--plane-text-primary)">{initial()}</span>}
            />
          </span>
        </div>
      </div>

      <div class="flex min-h-0 flex-1">
        <div class={cx("flex w-(--rail-width) shrink-0 flex-col items-center px-2 pt-2", dashboardRailLabels() ? "gap-4" : "gap-2")}>
          <For each={RAIL}>{(item, index) => <PreviewRailItem icon={item.icon} label={item.label} active={index() === 0} />}</For>
        </div>

        <div class="flex min-w-0 flex-1 overflow-hidden rounded-tl-xl border-t border-l border-(--plane-border-subtle) bg-(--plane-surface-1)">
          <div class="flex w-[250px] shrink-0 flex-col border-r border-(--plane-border-subtle)">
            <p class="flex h-11 shrink-0 items-center px-5 text-[15px] leading-5 font-medium tracking-[-0.01em] text-(--plane-text-primary)">{t(RAIL[0]!.label)}</p>
            <div class="px-3 pt-1">
              <span class={planeButton({ variant: "secondary", size: "xl", class: "w-full justify-start gap-1.5" })}>
                <PlaneIcon name="edit" class="size-4 text-(--plane-text-secondary)" />
                <span class="text-sm font-medium">{t("New post")}</span>
              </span>
            </div>
            <div class="flex min-h-0 flex-col gap-3 overflow-hidden px-3 pt-3">
              <div class="flex flex-col gap-0.5">
                <For each={PAGES}>{(page) => <PreviewNavItem icon={page.icon} label={page.label} active={page.active} />}</For>
              </div>
              <div class="flex flex-col gap-0.5">
                <p class="flex h-7 items-center pl-2 text-xs leading-4 font-medium text-(--plane-text-tertiary)">{t("Posts")}</p>
                <For each={POST_PAGES}>{(page) => <PreviewNavItem icon={page.icon} label={page.label} />}</For>
              </div>
              <Show when={socialConnections().length > 0}>
                <div class="flex flex-col gap-0.5">
                  <p class="flex h-7 items-center pl-2 text-xs leading-4 font-medium text-(--plane-text-tertiary)">{t("Accounts")}</p>
                  <For each={socialConnections().slice(0, SHOWN_ACCOUNTS)}>
                    {(account) => (
                      <span class="flex items-center gap-2 rounded-md px-2 py-1 text-(--plane-text-secondary)">
                        <PlatformLogo id={account.platform as PlatformId} class="size-4" compact />
                        <span class="truncate text-sm leading-5 font-medium">{accountLabel(account)}</span>
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>

          <div class="flex min-w-0 flex-1 flex-col">
            <p class="flex h-11 shrink-0 items-center px-5 text-[15px] leading-5 font-medium tracking-[-0.01em] text-(--plane-text-primary)">
              {new Intl.DateTimeFormat(intlLocale(), { month: "long", year: "numeric" }).format(today)}
            </p>
            <div class="grid shrink-0 grid-cols-7 border-y border-(--plane-border-subtle)">
              <For each={QUEUE_WEEKDAYS}>{(day) => <span class="px-2 py-1.5 text-xs text-(--plane-text-tertiary)">{t(day.short)}</span>}</For>
            </div>
            <div class="grid grid-cols-7" style={{ "grid-auto-rows": "132px" }}>
              <For each={days}>
                {(day) => (
                  <div class="flex min-w-0 flex-col gap-1 border-r border-b border-(--plane-border-subtle) p-1.5">
                    <span
                      class={cx(
                        "grid size-5 place-items-center rounded-full text-xs tabular-nums",
                        isToday(day) ? "bg-(--plane-accent-primary) font-medium text-white" : "text-(--plane-text-tertiary)",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    <For each={slotsOn(day)}>
                      {(slot) => <span class="truncate rounded-[4px] bg-(--plane-accent-subtle) px-1.5 py-0.5 text-xxs leading-4 font-medium tabular-nums text-(--plane-accent-secondary)">{slot.time}</span>}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The sign-in page's sky, with the person's own dashboard on it. Sized as that one is: like a cover image, running off two edges. */
export function OnboardingSky(props: { workspace: Workspace; name: string; slots: readonly QueueSlot[] }) {
  const [scale, setScale] = createSignal(1);
  const [width, setWidth] = createSignal(WINDOW_WIDTH);
  const [inset, setInset] = createSignal(40);
  let card!: HTMLDivElement;
  let frame!: HTMLDivElement;

  onMount(() => {
    const fit = () => {
      if (!card.clientWidth) return;
      const gap = insetFor(card.clientWidth);
      setInset(gap);
      const across = Math.min(MAX_SCALE, card.clientWidth / FULL_SIZE_AT);
      const down = (card.clientHeight - gap) / (SHOWN.down * frame.offsetHeight);
      const next = Math.max(across, down);
      setScale(next);
      setWidth(Math.max(WINDOW_WIDTH, (card.clientWidth - gap) / (SHOWN.across * next)));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={card} aria-hidden="true" inert class="onboarding-sky pointer-events-none relative size-full overflow-hidden rounded-3xl select-none">
      <Show when={dashboardTheme() === "dark"}>
        <svg class="absolute inset-0 size-full" fill="#fff">
          <For each={STARS}>{(star) => <circle cx={`${star.x}%`} cy={`${star.y}%`} r={star.r} opacity={star.opacity} />}</For>
        </svg>
      </Show>
      <div ref={frame} class="absolute origin-top-left" style={{ top: `${inset()}px`, left: `${inset()}px`, width: `${width()}px`, transform: `scale(${scale()})` }}>
        <DashboardWindow workspace={props.workspace} name={props.name} slots={props.slots} />
      </div>
    </div>
  );
}
