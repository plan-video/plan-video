/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Switch, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { DefaultCalendarViewToggle } from "@/components/calendar/view-toggle";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Switch as Toggle, SwitchControl, SwitchInput, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { t } from "@/lib/i18n";
import { dashboardRailLabels, setDashboardRailLabels } from "@/lib/dashboard-theme";
import { chosenZone, timeZone, zonedFormat } from "@/lib/time-zone";
import { usePermissionState, type PermissionState } from "@/hooks/use-permission";

import {
  DashboardDividedStack,
  DashboardInfoActionRow,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";
import { LanguagePicker } from "./language-picker";
import { ThemeSection } from "./theme-gallery";
import { TimeZonePicker } from "./time-zone-picker";

function DashboardRailSection() {
  return (
    <DashboardSurfaceSection title={t("Navigation")}>
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
      <ThemeSection />
      <DashboardRailSection />
      <DashboardLanguageSection />
      <DashboardTimeZoneSection />
      <DashboardCalendarSection />
      <DashboardPermissionsSection />
    </DashboardScrollView>
  );
}
