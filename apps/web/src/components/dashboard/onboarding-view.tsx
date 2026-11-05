/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

import { PLATFORMS } from "@/components/calendar/utils";
import { PlatformLogo } from "@/components/publish/controls";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { dashboardRailLabels, dashboardTheme, setDashboardRailLabels, setDashboardTheme } from "@/lib/dashboard-theme";
import { msg, t } from "@/lib/i18n";
import { smoothly } from "@/lib/motion";
import { ONBOARDING_STEPS, onboardingStep, setOnboardingStep, type OnboardingStep } from "@/lib/onboarding";
import { isPhone } from "@/lib/phone";
import { addQueueSlots, clearQueueSlots, describeQueue, loadQueueSlots, queueSlots, type QueueSlot } from "@/lib/queue-slots";
import { PUBLISHING_PLATFORMS } from "@/lib/social";
import { accountLabel, connectionsFor, socialConnections } from "@/lib/social-connections";
import { activeWorkspace, shownWorkspaceName, updateWorkspace, type Workspace } from "@/lib/workspaces";

import { createConnectFlow } from "./connections-view";
import { LanguagePicker } from "./language-picker";
import { OnboardingSky } from "./onboarding-preview";
import { PlaneIcon, type PlaneIconName } from "./plane-icons";
import { TimeZonePicker } from "./time-zone-picker";
import type { DashboardView } from "./types";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 0];

const ROWS = "flex flex-col divide-y divide-(--plane-border-subtle)";

// The sign-in page's controls, on the dashboard's tokens so they follow its theme.
const BUTTON =
  "press flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] px-4 text-[15px] font-medium tracking-[-0.15px] outline-none focus-ring disabled:pointer-events-none disabled:opacity-50";
const INK = `${BUTTON} bg-(--plane-text-primary) text-(--plane-surface-1) hover:opacity-85`;
const QUIET = `${BUTTON} bg-(--plane-layer-transparent-active) text-(--plane-text-primary) hover:bg-(--plane-layer-transparent-hover)`;
const FIELD =
  "h-11 w-full rounded-[8px] bg-transparent px-4 text-[15px] text-(--plane-text-primary) outline-none inset-ring inset-ring-(--plane-border-strong) transition-shadow placeholder:text-(--plane-text-placeholder) focus:inset-ring-(--plane-accent-primary)";
const CORNER = "press inline-flex h-9 cursor-pointer items-center rounded-[8px] text-[14px] outline-none focus-ring";
/** One width, so the column of buttons lines up whatever each one says. */
const ROW_ACTION =
  "press h-8 min-w-[5.75rem] shrink-0 cursor-pointer rounded-[8px] bg-(--plane-layer-transparent-active) px-2.5 text-[13px] font-medium text-(--plane-text-primary) outline-none hover:bg-(--plane-layer-transparent-hover) focus-ring max-[360px]:min-w-[4.25rem]";
/** A choice as a filled row, like the sign-in page's Google button. */
const TILE = "flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-4 text-left outline-none transition-[background-color,box-shadow] focus-ring";
const tile = (selected: boolean) =>
  cx(TILE, selected ? "bg-(--plane-layer-transparent-hover) ring-2 ring-(--plane-accent-primary)" : "bg-(--plane-layer-transparent-hover) hover:bg-(--plane-layer-transparent-active)");

type PaceId = "later" | "few" | "weekdays" | "daily" | "twice";

const PACES: { id: Exclude<PaceId, "later">; label: string; detail?(): string; times: { days: number[]; time: string }[] }[] = [
  { id: "few", label: msg("A few times a week"), times: [{ days: [1, 3, 5], time: "10:00" }] },
  { id: "weekdays", label: msg("Every weekday"), times: [{ days: [1, 2, 3, 4, 5], time: "10:00" }] },
  { id: "daily", label: msg("Every day"), detail: () => t("At {time}", { time: "10:00" }), times: [{ days: EVERY_DAY, time: "10:00" }] },
  {
    id: "twice",
    label: msg("Twice a day"),
    detail: () => t("At {first} and {second}", { first: "09:00", second: "17:00" }),
    times: [
      { days: EVERY_DAY, time: "09:00" },
      { days: EVERY_DAY, time: "17:00" },
    ],
  },
];

function paceSlots(id: PaceId): QueueSlot[] {
  const times = PACES.find((pace) => pace.id === id)?.times ?? [];
  return times.flatMap(({ days, time }) => days.map((weekday) => ({ id: `${weekday}-${time}`, weekday, time })));
}

type Palette = { canvas: string; surface: string; line: string; ink: string; faint: string; bar: string; accent: string };

const CURRENT_THEME: Palette = {
  canvas: "var(--plane-canvas)",
  surface: "var(--plane-surface-1)",
  line: "var(--plane-border-subtle)",
  ink: "var(--plane-text-primary)",
  faint: "var(--plane-text-tertiary)",
  bar: "var(--plane-border-strong)",
  accent: "var(--plane-accent-primary)",
};
const DARK: Palette = { canvas: "#060606", surface: "#0b0b0b", line: "#1c1c1c", ink: "#e8e8e8", faint: "#6e6e6e", bar: "#2c2c2c", accent: "#2f6ff0" };
const LIGHT: Palette = { canvas: "#f3f3f3", surface: "#ffffff", line: "#ebebeb", ink: "#1c1c1c", faint: "#8e8e8e", bar: "#dcdcdc", accent: "#2563eb" };

const PICTURE_RAIL: { icon: PlaneIconName; label: string }[] = [
  { icon: "calendar", label: msg({ message: "Schedule", context: "noun" }) },
  { icon: "project", label: msg("Projects") },
  { icon: "layer-stack", label: msg("Library") },
];

/** The dashboard, small: its rail, side panel and calendar in the colours it's being chosen in. */
function DashboardPicture(props: { palette: Palette; names: boolean }) {
  return (
    <span aria-hidden="true" class="flex aspect-[3/2] w-full overflow-hidden pt-2" style={{ background: props.palette.canvas }}>
      <span class={cx("flex shrink-0 flex-col items-center", props.names ? "w-11 gap-2" : "w-7 gap-2.5")}>
        <For each={PICTURE_RAIL}>
          {(item, index) => {
            const color = () => (index() === 0 ? props.palette.ink : props.palette.faint);
            return (
              <span class="flex w-full flex-col items-center gap-0.5" style={{ color: color() }}>
                <PlaneIcon name={item.icon} class="size-3" />
                <Show when={props.names}>
                  <span class="w-full truncate px-0.5 text-center text-[7px] leading-[9px] font-medium">{t(item.label)}</span>
                </Show>
              </span>
            );
          }}
        </For>
      </span>
      <span class="flex min-w-0 flex-1 overflow-hidden rounded-tl-md border-t border-l" style={{ background: props.palette.surface, "border-color": props.palette.line }}>
        <span class="flex w-1/4 shrink-0 flex-col gap-1.5 border-r px-1.5 pt-2" style={{ "border-color": props.palette.line }}>
          <span class="h-1 w-3/4 rounded-full" style={{ background: props.palette.bar }} />
          <span class="h-1 w-full rounded-full" style={{ background: props.palette.line }} />
          <span class="h-1 w-2/3 rounded-full" style={{ background: props.palette.line }} />
          <span class="h-1 w-5/6 rounded-full" style={{ background: props.palette.line }} />
        </span>
        <span class="grid min-w-0 flex-1 grid-cols-4 grid-rows-3">
          <For each={Array.from({ length: 12 }, (_, index) => index)}>
            {(index) => (
              <span class="border-r border-b p-0.5" style={{ "border-color": props.palette.line }}>
                <Show when={index === 1 || index === 6 || index === 8}>
                  <span class="block h-1.5 rounded-[2px] opacity-60" style={{ background: props.palette.accent }} />
                </Show>
              </span>
            )}
          </For>
        </span>
      </span>
    </span>
  );
}

function ChoiceCells(props: { label: string; children: JSX.Element }) {
  return (
    <div role="radiogroup" aria-label={props.label} class="grid grid-cols-2 gap-3">
      {props.children}
    </div>
  );
}

function ChoiceCell(props: { label: string; selected: boolean; onSelect(): void; children: JSX.Element }) {
  return (
    <button type="button" role="radio" aria-checked={props.selected} class="group flex min-w-0 cursor-pointer flex-col items-center gap-2.5 rounded-[8px] outline-none focus-ring" onClick={props.onSelect}>
      <span
        class={cx(
          "w-full overflow-hidden rounded-[8px] ring-1 transition-shadow",
          props.selected ? "ring-2 ring-(--plane-accent-primary)" : "ring-(--plane-border-subtle-1) group-hover:ring-(--plane-border-strong)",
        )}
      >
        {props.children}
      </span>
      <span class={cx("text-[14px] leading-5 font-medium", props.selected ? "text-(--plane-text-primary)" : "text-(--plane-text-secondary)")}>{props.label}</span>
    </button>
  );
}

function NetworkRow(props: { id: (typeof PLATFORMS)[number]["id"]; name: string; locked: boolean; onConnect(): void; onUpgrade(): void }) {
  const accounts = () => connectionsFor(props.id);
  const live = () => PUBLISHING_PLATFORMS.includes(props.id);
  return (
    <div class="flex h-11 items-center gap-2.5">
      {/* YouTube's logo is wider than the rest: the names still start in one line. */}
      <span class="grid w-[30px] shrink-0 place-items-center">
        <PlatformLogo id={props.id} class="size-6 rounded-md" />
      </span>
      <p class="shrink-0 text-[14px] leading-5 font-medium text-(--plane-text-primary)">{props.name}</p>
      {/* A count from two accounts up, so a row keeps its height however many there are. */}
      <div class="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-[13px] text-(--plane-text-tertiary)" title={accounts().map(accountLabel).join(", ")}>
        <Show when={accounts().length > 0}>
          <span class="size-1.5 shrink-0 rounded-full bg-meter-green" />
          <span class="truncate">{(accounts().length === 1 && accountLabel(accounts()[0]!)) || t("{count, plural, one {# account} other {# accounts}}", { count: accounts().length })}</span>
        </Show>
      </div>
      <Switch>
        <Match when={!live()}>
          <span class="grid h-8 min-w-[5.75rem] shrink-0 place-items-center text-[13px] font-medium text-(--plane-text-tertiary) max-[360px]:min-w-[4.25rem]">{t("Soon")}</span>
        </Match>
        <Match when={props.locked}>
          <button type="button" class={ROW_ACTION} onClick={props.onUpgrade}>
            {t("Upgrade")}
          </button>
        </Match>
        <Match when={accounts().length > 0}>
          <button type="button" class={ROW_ACTION} aria-label={`${t("Add account")}: ${props.name}`} onClick={props.onConnect}>
            {t("Add")}
          </button>
        </Match>
        <Match when={true}>
          <button type="button" class={ROW_ACTION} onClick={props.onConnect}>
            {t("Connect")}
          </button>
        </Match>
      </Switch>
    </div>
  );
}

function PaceRow(props: { label: string; detail: string; selected: boolean; onSelect(): void }) {
  return (
    <button type="button" role="radio" aria-checked={props.selected} class={cx(tile(props.selected), "py-2")} onClick={props.onSelect}>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-[14px] leading-5 font-medium text-(--plane-text-primary)">{props.label}</span>
        <span class="text-[13px] leading-[18px] text-(--plane-text-tertiary)">{props.detail}</span>
      </span>
      <span
        class={cx(
          "grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
          props.selected ? "border-(--plane-accent-primary) bg-(--plane-accent-primary)" : "border-(--plane-border-strong)",
        )}
      >
        <Show when={props.selected}>
          <span class="size-1.5 rounded-full bg-white" />
        </Show>
      </span>
    </button>
  );
}

function NextRow(props: { icon: PlaneIconName; title: string; onClick(): void }) {
  return (
    <button type="button" class="group flex h-12 w-full cursor-pointer items-center gap-3 text-left outline-none focus-ring" onClick={props.onClick}>
      <PlaneIcon name={props.icon} class="size-5 shrink-0 text-(--plane-text-tertiary) transition-colors group-hover:text-(--plane-text-primary)" />
      <span class="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-(--plane-text-primary)">{props.title}</span>
      <PlaneIcon name="chevron-right" class="size-4 shrink-0 text-(--plane-text-placeholder) transition-colors group-hover:text-(--plane-text-primary)" />
    </button>
  );
}

export function DashboardOnboardingView(props: { onDone(view?: DashboardView): void }) {
  const auth = useAuth();
  const userId = auth.user()!.id;
  const flow = createConnectFlow({ onUpgrade: () => props.onDone("billing") });

  // A phone always has its tab bar instead of the side rail, so there's nothing to choose.
  const steps = () => (isPhone() ? ONBOARDING_STEPS.filter((row) => row !== "rail") : [...ONBOARDING_STEPS]);
  const step = (): OnboardingStep => {
    const saved = onboardingStep(userId) ?? ONBOARDING_STEPS[0];
    return steps().includes(saved) ? saved : "accounts";
  };
  const stepIndex = () => steps().indexOf(step());
  const goTo = (next: OnboardingStep) => smoothly(() => setOnboardingStep(userId, next), "moving-step");
  const goBack = () => goTo(steps()[stepIndex() - 1]!);
  const goNext = () => goTo(steps()[stepIndex() + 1]!);

  const savedName = createMemo(() => shownWorkspaceName(activeWorkspace().name));
  const [name, setName] = createSignal(savedName());
  const [nameError, setNameError] = createSignal<string>();
  // The account's copy can arrive after this opens, on a new device, and the language can change. Typing wins over both.
  let lastSavedName = savedName();
  createEffect(
    on(
      savedName,
      (next) => {
        if (name() === lastSavedName) setName(next);
        lastSavedName = next;
      },
      { defer: true },
    ),
  );

  const wide = window.matchMedia("(min-width: 1024px)");
  const [isWide, setIsWide] = createSignal(wide.matches);
  const onWidth = (event: MediaQueryListEvent) => setIsWide(event.matches);
  wide.addEventListener("change", onWidth);
  onCleanup(() => wide.removeEventListener("change", onWidth));

  const nameChanged = () => name().trim() !== savedName();
  /** One the person has made theirs stops wearing the plan.video mark. */
  const shownWorkspace = (): Workspace => {
    const row = activeWorkspace();
    return { ...row, name: name(), icon: row.icon ?? (nameChanged() ? { type: "letters" } : undefined) };
  };

  const saveWorkspace = () => {
    if (!nameChanged()) return true;
    const row = activeWorkspace();
    const failure = updateWorkspace(row.id, { name: name(), ...(row.icon ? {} : { icon: { type: "letters" as const } }) });
    setNameError(failure);
    return !failure;
  };

  createEffect(() => loadQueueSlots(auth.ownerId()));
  const [pace, setPace] = createSignal<PaceId>("later");
  const [appliedPace, setAppliedPace] = createSignal<PaceId | null>(null);
  /** Times from before this visit stay as they are: this only ever sets a first week. */
  const hasOwnTimes = () => queueSlots().length > 0 && !appliedPace();
  const shownSlots = () => (hasOwnTimes() ? queueSlots() : paceSlots(pace()));

  const savePace = () => {
    const owner = auth.ownerId();
    if (!owner || hasOwnTimes() || pace() === (appliedPace() ?? "later")) return;
    if (appliedPace()) clearQueueSlots(owner);
    for (const { days, time } of PACES.find((row) => row.id === pace())?.times ?? []) addQueueSlots(owner, days, time);
    setAppliedPace(pace() === "later" ? null : pace());
  };

  const next = () => {
    if (step() === "workspace" && !saveWorkspace()) return;
    if (step() === "times") savePace();
    goNext();
  };

  let heading: HTMLHeadingElement | undefined;
  let nameInput: HTMLInputElement | undefined;

  onMount(() => {
    // On a phone this would throw the keyboard over the page before it's been read.
    if (step() === "workspace" && !isPhone()) {
      nameInput?.focus();
      nameInput?.select();
    }
  });
  createEffect(
    on(
      step,
      () => heading?.focus({ preventScroll: true }),
      { defer: true },
    ),
  );

  const title = () => {
    switch (step()) {
      case "workspace":
        return t("Name your workspace");
      case "look":
        return t("Choose your look");
      case "rail":
        return t("Choose your side rail");
      case "accounts":
        return t("Connect your accounts");
      case "times":
        return t("How often do you want to post?");
      case "done":
        return t("{workspace} is ready", { workspace: shownWorkspaceName(activeWorkspace().name) });
    }
  };

  const description = () => {
    switch (step()) {
      case "workspace":
        return t("A workspace keeps one brand's or client's accounts and posts together. You can add more later.");
      case "look":
      case "rail":
        return t("You can change this anytime in Preferences.");
      case "accounts":
        return t("Your posts go out from these accounts. You'll sign in on each network's own page and come back here.");
      case "times":
        return t("Auto-schedule puts each new post in your next free time, so you don't have to pick one.");
      case "done":
        return t("Pick where to start.");
    }
  };

  return (
    <div class="dashboard-shell flex h-dvh w-full min-h-0 overflow-hidden bg-(--plane-surface-1)!">
      <div class="relative flex min-w-0 flex-1 flex-col overflow-y-auto px-6">
        <Show when={stepIndex() > 0}>
          <button type="button" class={cx(CORNER, "absolute top-6 left-6 bg-(--plane-layer-transparent-active) pr-3.5 pl-2.5 text-(--plane-text-primary) hover:bg-(--plane-layer-transparent-hover)")} onClick={goBack}>
            <PlaneIcon name="chevron-left" class="size-4" />
            {t("Back")}
          </button>
        </Show>
        <div class="absolute top-6 right-6 flex h-9 items-center">
          <LanguagePicker />
        </div>

        <main class="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-6 pt-24 pb-10">
          <div class="step-heading flex flex-col text-center text-balance">
            <h1 ref={heading} tabindex="-1" class="text-[22px] leading-[27px] font-[520] tracking-[-0.35px] text-(--plane-text-primary) outline-none">
              {title()}
            </h1>
            <p class="mt-2 text-[15px] leading-[22px] text-(--plane-text-tertiary)">{description()}</p>
          </div>

          <div class="step-body">
            <Switch>
              <Match when={step() === "workspace"}>
                <form
                  id="onboarding-workspace"
                  class="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (name().trim()) next();
                  }}
                >
                  <input
                    ref={nameInput}
                    class={FIELD}
                    maxLength={40}
                    aria-label={t("Workspace name")}
                    placeholder={t("Workspace name")}
                    value={name()}
                    aria-invalid={!!nameError()}
                    onInput={(event) => {
                      setName(event.currentTarget.value);
                      setNameError(undefined);
                    }}
                  />
                  <Show when={nameError()}>
                    <span role="alert" class="text-[13px] leading-[18px] text-(--plane-danger-text)">
                      {nameError()}
                    </span>
                  </Show>
                </form>
              </Match>

              <Match when={step() === "look"}>
                <ChoiceCells label={t("Theme")}>
                  <ChoiceCell label={t("Light")} selected={dashboardTheme() === "light"} onSelect={() => setDashboardTheme("light")}>
                    <DashboardPicture palette={LIGHT} names={dashboardRailLabels()} />
                  </ChoiceCell>
                  <ChoiceCell label={t("Dark")} selected={dashboardTheme() === "dark"} onSelect={() => setDashboardTheme("dark")}>
                    <DashboardPicture palette={DARK} names={dashboardRailLabels()} />
                  </ChoiceCell>
                </ChoiceCells>
              </Match>

              <Match when={step() === "rail"}>
                <ChoiceCells label={t("Side rail")}>
                  <ChoiceCell label={t("Icons and names")} selected={dashboardRailLabels()} onSelect={() => setDashboardRailLabels(true)}>
                    <DashboardPicture palette={CURRENT_THEME} names />
                  </ChoiceCell>
                  <ChoiceCell label={t("Icons only")} selected={!dashboardRailLabels()} onSelect={() => setDashboardRailLabels(false)}>
                    <DashboardPicture palette={CURRENT_THEME} names={false} />
                  </ChoiceCell>
                </ChoiceCells>
              </Match>

              <Match when={step() === "accounts"}>
                <div class={ROWS}>
                  <For each={PLATFORMS}>
                    {(item) => <NetworkRow id={item.id} name={item.name} locked={flow.locked(item.id)} onConnect={() => flow.start(item.id)} onUpgrade={flow.upgrade} />}
                  </For>
                </div>
              </Match>

              <Match when={step() === "times"}>
                <div class="flex flex-col gap-2">
                  <Show when={!hasOwnTimes()} fallback={<div class="rounded-[8px] bg-(--plane-layer-transparent-hover) px-4 py-3 text-[14px] leading-5 text-(--plane-text-secondary)">{t("Your times: {times}", { times: describeQueue() })}</div>}>
                    <div role="radiogroup" aria-label={t("How often do you want to post?")} class="flex flex-col gap-2">
                      <For each={PACES}>
                        {(row) => <PaceRow label={t(row.label)} detail={row.detail?.() ?? describeQueue(paceSlots(row.id))} selected={pace() === row.id} onSelect={() => setPace(row.id)} />}
                      </For>
                      <PaceRow label={t("I'll set this later")} detail={t("Add times in Auto-schedule whenever you're ready.")} selected={pace() === "later"} onSelect={() => setPace("later")} />
                    </div>
                  </Show>
                  <div class="flex items-center justify-between gap-4 pt-1 pl-4">
                    <span class="text-[14px] leading-5 text-(--plane-text-secondary)">{t("Time zone")}</span>
                    <TimeZonePicker />
                  </div>
                </div>
              </Match>

              <Match when={step() === "done"}>
                <div class={ROWS}>
                  <NextRow icon="edit" title={t("Plan your first post")} onClick={() => props.onDone("new-post")} />
                  {/* The editor needs a computer. */}
                  <Show when={!isPhone()}>
                    <NextRow icon="project" title={t("Edit a video")} onClick={() => props.onDone("projects")} />
                  </Show>
                  <NextRow icon="agent" title={t("Connect an AI agent")} onClick={() => props.onDone("mcp")} />
                </div>
              </Match>
            </Switch>
          </div>

          <div class="step-actions bg-(--plane-surface-1) max-lg:sticky max-lg:bottom-0 max-lg:py-3">
            <Switch>
              <Match when={step() === "done"}>
                <button type="button" class={INK} onClick={() => props.onDone("calendar")}>
                  {t("Go to my calendar")}
                </button>
              </Match>
              <Match when={step() === "accounts" && socialConnections().length === 0}>
                <button type="button" class={QUIET} onClick={next}>
                  {t("Skip for now")}
                </button>
              </Match>
              <Match when={true}>
                <button type="button" class={INK} disabled={!name().trim()} onClick={next}>
                  {t("Continue")}
                </button>
              </Match>
            </Switch>
          </div>
        </main>

        <div
          role="progressbar"
          aria-label={t("Setup progress")}
          aria-valuemin={1}
          aria-valuemax={steps().length}
          aria-valuenow={stepIndex() + 1}
          class="flex shrink-0 items-center justify-center gap-2 pb-[max(2rem,env(safe-area-inset-bottom))]"
        >
          <For each={steps()}>{(row) => <span class={cx("size-1.5 rounded-full", row === step() ? "bg-(--plane-text-primary)" : "bg-(--plane-border-strong)")} />}</For>
        </div>
      </div>

      <Show when={isWide()}>
        <aside class="w-1/2 shrink-0 py-4 pr-4">
          <OnboardingSky workspace={shownWorkspace()} name={name().trim() || t("Workspace")} slots={shownSlots()} />
        </aside>
      </Show>

      {flow.modal()}
    </div>
  );
}
