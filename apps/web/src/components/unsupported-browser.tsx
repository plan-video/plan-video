/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A } from "@solidjs/router";
import { Show, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { Icon } from "@/components/ui/icon";
import { appRoute } from "@/hooks/use-project-route";
import { t } from "@/lib/i18n";

// Safari passes the feature test too, but the editor hasn't been tried there yet.
function canEdit() {
  if (isServer) return true;
  const uaData = (navigator as { userAgentData?: { brands: { brand: string }[] } }).userAgentData;
  const chromium = uaData?.brands?.some((b) => b.brand === "Chromium") ?? false;
  const firefox = /\bFirefox\//.test(navigator.userAgent);
  const codecs = [globalThis.VideoDecoder, globalThis.VideoEncoder, globalThis.AudioDecoder, globalThis.AudioEncoder].every(
    (api) => typeof api === "function",
  );
  return (chromium || firefox) && codecs;
}

/** Holds the editor back where it can't run, so nothing behind the notice (like the tour) starts. */
export function UnlessUnsupported(props: { children: JSX.Element }) {
  return <Show when={canEdit()}>{props.children}</Show>;
}

export function UnsupportedBrowser() {
  return (
    <Show when={!canEdit()}>
      <div class="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
        <div class="flex max-w-sm flex-col items-center gap-3 text-center">
          <span class="text-muted-foreground">
            <Icon name="alert-warning" class="size-12" />
          </span>
          <h2 class="text-xl font-450 text-foreground">{t("Unsupported browser")}</h2>
          <p class="text-xs text-muted-foreground">
            {t("The video editor needs a recent version of Chrome, Edge, Firefox, Brave or Arc.")}
          </p>
          <A href={appRoute()} class="mt-1 text-sm text-foreground underline underline-offset-2 focus-ring">
            {t("Back to dashboard")}
          </A>
        </div>
      </div>
    </Show>
  );
}
