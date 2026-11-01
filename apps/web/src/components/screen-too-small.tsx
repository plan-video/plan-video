/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A } from "@solidjs/router";
import { Show, createSignal, onCleanup, type JSX } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { appRoute } from "@/hooks/use-project-route";
import { t } from "@/lib/i18n";

/** Holds the editor back on a screen that refuses it. Once mounted it stays, so shrinking a window loses no work. */
export function UnlessTooSmall(props: { children: JSX.Element }) {
  // Must match the screens .screen-too-small shows on, in index.css.
  const query = window.matchMedia("(max-width: 719px), (max-height: 479px)");
  const [fits, setFits] = createSignal(!query.matches);
  const onChange = () => {
    if (!query.matches) setFits(true);
  };
  query.addEventListener("change", onChange);
  onCleanup(() => query.removeEventListener("change", onChange));
  return <Show when={fits()}>{props.children}</Show>;
}

export function ScreenTooSmall() {
  return (
    <div class="screen-too-small fixed inset-0 z-[100] hidden items-center justify-center bg-background p-6">
      <div class="flex max-w-sm flex-col items-center gap-3 text-center">
        <span class="text-muted-foreground">
          <Icon name="alert-warning" class="size-12" />
        </span>
        <h2 class="text-xl font-450 text-foreground">{t("The video editor needs a bigger screen")}</h2>
        <p class="text-xs text-muted-foreground">
          {t("Open it on a computer, at 720×480 or larger. Everything else in plan.video works here.")}
        </p>
        <A href={appRoute()} class="mt-1 text-sm text-foreground underline underline-offset-2 focus-ring">
          {t("Back to dashboard")}
        </A>
      </div>
    </div>
  );
}
