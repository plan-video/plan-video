/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Show } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { t } from "@/lib/i18n";

export function PurchaseSuccess() {
  const [params, setParams] = useSearchParams();

  const close = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setParams({ checkout: undefined }, { replace: true });
  };

  return (
    <Show when={params.checkout === "success"}>
      <div
        class="pointer-events-auto fixed inset-0 z-[999] flex flex-col items-center justify-center gap-2 bg-overlay-strong"
        onClick={close}
      >
        <Icon name="confirm-check" class="size-12 text-foreground" />
        <h4 class="text-2xl">{t("Thank you for your purchase!")}</h4>
        <span class="text-[13px] text-foreground/70">
          {t("You can click anywhere to close this window and continue using the app.")}
        </span>
      </div>
    </Show>
  );
}
