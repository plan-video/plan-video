/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";

import { DefaultCalendarViewToggle } from "@/components/calendar/view-toggle";
import { QUEUE_RETURN_LABELS, QueueSlotsEditor } from "@/components/publish/queue-slots";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Switch as Toggle, SwitchControl, SwitchInput, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import {
  dashboardRailLabels,
  dashboardTheme,
  setDashboardRailLabels,
  setDashboardTheme,
  type DashboardTheme,
} from "@/lib/dashboard-theme";
import { chosenZone, timeZone, zonedFormat } from "@/lib/time-zone";
import { pickProjectsRoot, projectsRoot } from "@/projects";
import { usePermissionState, type PermissionState } from "@/hooks/use-permission";

import {
  DashboardDividedStack,
  DashboardInfoActionRow,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";
import { LanguagePicker } from "./language-picker";
import { TimeZonePicker } from "./time-zone-picker";
import type { DashboardView } from "./types";

/** The two themes, drawn in their own colors whichever one is on. */
const THEME_PREVIEWS: { value: DashboardTheme; label: string; canvas: string; surface: string; line: string; text: string; accent: string }[] = [
  { value: "dark", label: msg("Dark"), canvas: "#060606", surface: "#0b0b0b", line: "#1c1c1c", text: "#3a3a3a", accent: "#2f6ff0" },
  { value: "light", label: msg("Light"), canvas: "#f3f3f3", surface: "#ffffff", line: "#ebebeb", text: "#d4d4d4", accent: "#2563eb" },
];

function DashboardAppearanceSection() {
  return (
    <DashboardSurfaceSection title={t("Appearance")}>
      <div role="radiogroup" aria-label={t("Theme")} class="grid grid-cols-2 gap-3">
        <For each={THEME_PREVIEWS}>
          {(option) => {
            const selected = () => dashboardTheme() === option.value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected()}
                class="group flex flex-col gap-2.5 rounded-xl p-1.5 text-left outline-none depth-card depth-unlit focus-ring"
                onClick={() => setDashboardTheme(option.value)}
              >
                <span
                  aria-hidden="true"
                  class={cx(
                    "flex h-24 gap-1.5 overflow-hidden rounded-md p-1.5 ring-1 transition-shadow",
                    selected() ? "ring-2 ring-(--plane-accent-primary)" : "ring-(--plane-border-subtle-1) group-hover:ring-(--plane-border-strong)",
                  )}
                  style={{ background: option.canvas }}
                >
                  <span class="flex w-4 flex-col items-center gap-1.5 pt-1">
                    <span class="size-2.5 rounded-[3px]" style={{ background: option.accent }} />
                    <span class="size-2 rounded-[2px]" style={{ background: option.text }} />
                    <span class="size-2 rounded-[2px]" style={{ background: option.text }} />
                  </span>
                  <span class="flex min-w-0 flex-1 overflow-hidden rounded-[4px] border" style={{ background: option.surface, "border-color": option.line }}>
                    <span class="flex w-14 flex-col gap-1.5 border-r p-2" style={{ "border-color": option.line }}>
                      <span class="h-1.5 w-8 rounded-full" style={{ background: option.text }} />
                      <span class="h-1.5 w-6 rounded-full" style={{ background: option.line }} />
                      <span class="h-1.5 w-7 rounded-full" style={{ background: option.line }} />
                    </span>
                    <span class="flex flex-1 flex-col gap-1.5 p-2">
                      <span class="h-1.5 w-12 rounded-full" style={{ background: option.text }} />
                      <span class="grid flex-1 grid-cols-3 gap-1">
                        <span class="rounded-[2px] border" style={{ "border-color": option.line }} />
                        <span class="rounded-[2px] border" style={{ "border-color": option.line }} />
                        <span class="rounded-[2px] border" style={{ "border-color": option.line, background: option.accent, opacity: 0.35 }} />
                      </span>
                    </span>
                  </span>
                </span>
                <span class="flex items-center gap-2 px-0.5">
                  <span
                    class={cx(
                      "grid size-4 place-items-center rounded-full border transition-colors",
                      selected() ? "border-(--plane-accent-primary) bg-(--plane-accent-primary)" : "border-(--plane-border-strong)",
                    )}
                  >
                    <Show when={selected()}>
                      <span class="size-1.5 rounded-full bg-white" />
                    </Show>
                  </span>
                  <span class="text-sm font-medium text-(--plane-text-primary)">{t(option.label)}</span>
                </span>
              </button>
            );
          }}
        </For>
      </div>
      <Toggle checked={!dashboardRailLabels()} onChange={(iconsOnly) => setDashboardRailLabels(!iconsOnly)} class="flex items-center gap-4">
        <SwitchLabel class="min-w-0 flex-1 cursor-pointer pr-4 text-xs font-normal">
          <span class="block text-foreground">{t("Icons only in the side rail")}</span>
          <span class="mt-1 block text-muted-foreground">{t("Hides the names under Schedule, Projects and the rest. Hover an icon to see its name.")}</span>
        </SwitchLabel>
        <SwitchInput aria-label={t("Icons only in the side rail")} />
        <SwitchControl variant="compact">
          <SwitchThumb variant="compact" />
        </SwitchControl>
      </Toggle>
    </DashboardSurfaceSection>
  );
}

function DashboardProjectsFolderSection() {
  const handleChange = async () => {
    try {
      await pickProjectsRoot();
    } catch (e) {
      toast.error(t("Failed to choose projects folder"), { description: (e as Error).message });
    }
  };

  return (
    <DashboardSurfaceSection title={t("Projects folder")}>
      <DashboardInfoActionRow
        title={t("Save projects to")}
        leading={<Icon name="navigation.folder" class="text-foreground" />}
        description={projectsRoot() ?? t("No folder selected")}
        action={
          <Button variant="secondary" onClick={handleChange}>
            {t("Change...")}
          </Button>
        }
      />
    </DashboardSurfaceSection>
  );
}

function DashboardLanguageSection() {
  return (
    <DashboardSurfaceSection title={t("Language")}>
      <DashboardInfoActionRow
        title={t("Show plan.video in")}
        leading={<Icon name="globe" class="text-foreground" />}
        description={t("Saved on this device, for the dashboard, the editor and the website.")}
        action={<LanguagePicker />}
      />
    </DashboardSurfaceSection>
  );
}

const CLOCK_FORMAT = zonedFormat({ weekday: "short", hour: "2-digit", minute: "2-digit" });

function DashboardTimeZoneSection() {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));

  return (
    <DashboardSurfaceSection title={t("Time zone")}>
      <DashboardInfoActionRow
        title={t("Show times in")}
        leading={<Icon name="clock" class="text-foreground" />}
        description={
          chosenZone()
            ? t("{zone} · {time} there now. The calendar, posts, scheduling and analytics all use it.", {
                zone: timeZone().replace(/_/g, " "),
                time: CLOCK_FORMAT.format(now()),
              })
            : t("{zone}, this device's · {time} there now. The calendar, posts, scheduling and analytics all use it.", {
                zone: timeZone().replace(/_/g, " "),
                time: CLOCK_FORMAT.format(now()),
              })
        }
        action={<TimeZonePicker />}
      />
    </DashboardSurfaceSection>
  );
}

function DashboardCalendarSection() {
  return (
    <DashboardSurfaceSection title={t("Calendar")}>
      <DashboardInfoActionRow
        title={t("Open the calendar in")}
        leading={<Icon name="calendar" class="text-foreground" />}
        description={t("Saved on this device. On the calendar, W, M and L still switch views.")}
        action={<DefaultCalendarViewToggle />}
      />
    </DashboardSurfaceSection>
  );
}

function DashboardQueueSection() {
  const [params, setParams] = useSearchParams();
  let section: HTMLDivElement | undefined;
  const back = () => (typeof params.back === "string" ? QUEUE_RETURN_LABELS[params.back as DashboardView] : undefined);

  onMount(() => {
    if (params.section !== "queue") return;
    setParams({ section: undefined }, { replace: true });
    requestAnimationFrame(() => section?.scrollIntoView({ block: "start", behavior: "smooth" }));
  });

  return (
    <div ref={section} class="scroll-mt-6">
      <DashboardSurfaceSection
        title={t("Posting queue")}
        hint={t("The days and times you post each week. A queued post goes to the next slot no other post holds.")}
      >
        <QueueSlotsEditor />
        <Show when={back()}>
          {(label) => (
            <div class="flex justify-end border-t border-border-strong pt-3">
              <Button onClick={() => setParams({ dashboard: params.back as string, back: undefined })}>{t("Back to {label}", { label: t(label()) })}</Button>
            </div>
          )}
        </Show>
      </DashboardSurfaceSection>
    </div>
  );
}

type PermissionActionButtonProps = {
  state: PermissionState;
  pendingLabel: string;
  unavailableLabel?: string;
  onRequest(): void | Promise<void>;
};

function PermissionActionButton(props: PermissionActionButtonProps) {
  return (
    <Switch>
      <Match when={props.state === "granted"}>
        <Button variant="on">{t("Granted")}</Button>
      </Match>
      <Match when={props.state === "denied"}>
        <Button variant="secondary" disabled>
          {t("Denied")}
        </Button>
      </Match>
      <Match when={props.state === "unsupported"}>
        <Button variant="secondary" disabled>
          {props.unavailableLabel ?? t("Unavailable")}
        </Button>
      </Match>
      <Match when={props.state === "prompt"}>
        <Button variant="secondary" onClick={props.onRequest}>
          {props.pendingLabel}
        </Button>
      </Match>
    </Switch>
  );
}

function DashboardPermissionsSection() {
  const clipboardState = usePermissionState("clipboard-read");
  const fontState = usePermissionState("local-fonts");
  const storageState = usePermissionState("persistent-storage");

  const handleClipboardRequest = async () => {
    try {
      await navigator.clipboard.readText();
    } catch {
      toast.error(t("Clipboard access denied"));
    }
  };

  const handleFontsRequest = async () => {
    if (typeof window.queryLocalFonts !== "function") {
      toast.error(t("Local fonts are not supported in this browser"));
      return;
    }
    try {
      await window.queryLocalFonts();
    } catch {
      toast.error(t("Local network access denied"));
    }
  };

  const handleStorageRequest = async () => {
    if (!navigator.storage?.persist) {
      toast.error(t("Persistent storage is not supported in this browser"));
      return;
    }
    const granted = await navigator.storage.persist();
    if (!granted) toast.error(t("Persistent storage was not granted"));
  };

  return (
    <DashboardSurfaceSection title={t("Permissions")}>
      <DashboardDividedStack>
        <DashboardInfoActionRow
          title={t("Clipboard access")}
          description={t("Copy/paste text, timecodes, assets metadata.")}
          action={
            <PermissionActionButton
              state={clipboardState()}
              pendingLabel={t("Allow clipboard access...")}
              onRequest={handleClipboardRequest}
            />
          }
        />
        <DashboardInfoActionRow
          title={t("Fonts access")}
          description={t("Required to use installed fonts.")}
          action={
            <PermissionActionButton
              state={fontState()}
              pendingLabel={t("Allow fonts access...")}
              onRequest={handleFontsRequest}
            />
          }
        />
        <DashboardInfoActionRow
          title={t("Persistent storage")}
          description={t("Prevents the browser from evicting your projects and imported assets under disk pressure.")}
          action={
            <PermissionActionButton
              state={window.chrome ? "granted" : storageState()}
              pendingLabel={t("Enable persistent storage...")}
              onRequest={handleStorageRequest}
            />
          }
        />
      </DashboardDividedStack>
    </DashboardSurfaceSection>
  );
}

export function DashboardSettingsView() {
  return (
    <DashboardScrollView>
      <DashboardAppearanceSection />
      <DashboardLanguageSection />
      <DashboardTimeZoneSection />
      <DashboardCalendarSection />
      <DashboardQueueSection />
      <DashboardProjectsFolderSection />
      <DashboardPermissionsSection />
    </DashboardScrollView>
  );
}
