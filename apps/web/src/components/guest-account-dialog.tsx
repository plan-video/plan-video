/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from "@solidjs/router";
import { Show } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";
import { accountAsk, closeAccountAsk, type AccountAsk } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { SOCIAL_PLATFORMS } from "@/lib/social";

function reasonText(ask: AccountAsk) {
  const network = SOCIAL_PLATFORMS.find((platform) => platform.id === ask.platform)?.name;
  switch (ask.reason) {
    case "schedule":
      return t("Nothing goes out from the demo. Create a free account to schedule posts on your own accounts.");
    case "post":
      return t("Nothing goes out from the demo. Create a free account to post on your own accounts.");
    case "connect":
      return network
        ? t("The demo's accounts are samples. Create a free account to connect your own {network}.", { network })
        : t("The demo's accounts are samples. Create a free account to connect your own accounts.");
    case "share":
      return t("Create a free account to share a preview of a post with anyone.");
    case "captions":
      return t("Create a free account to make captions from your video's speech.");
    case "agent":
      return t("Create a free account to plan and schedule posts with the Assistant.");
    default:
      return t("Create a free account to plan and post on your own accounts.");
  }
}

export function GuestAccountDialog() {
  const navigate = useNavigate();

  const go = (path: "/signup" | "/login") => {
    const ask = accountAsk();
    if (ask) track("guest_account_chosen", { reason: ask.reason, action: path === "/signup" ? "signup" : "login" });
    closeAccountAsk();
    navigate(path);
  };

  return (
    <Show when={accountAsk()}>
      {(ask) => (
        <Dialog open preventScroll={false} onOpenChange={(open) => !open && closeAccountAsk()}>
          <DialogPortal>
            <DialogContent showCloseButton={false} class="w-96 gap-0 overflow-hidden rounded-xl border-border-strong bg-popover p-0">
              <div class="flex items-center justify-between border-b border-border-strong py-2 pl-4 pr-2">
                <p class="text-xs text-foreground">{t("Create your plan.video account")}</p>
                <Button type="button" variant="ghost" size="icon-square" aria-label={t("Close")} onClick={closeAccountAsk}>
                  <Icon name="close-remove" class="size-6" />
                </Button>
              </div>
              <p class="p-4 text-xs leading-5 text-muted-foreground">{reasonText(ask())}</p>
              <div class="flex justify-end gap-1.5 border-t border-border-strong px-4 py-3">
                <Button type="button" variant="ghost" onClick={() => go("/login")}>
                  {t("Log in")}
                </Button>
                <Button type="button" autofocus onClick={() => go("/signup")}>
                  {t("Create account")}
                </Button>
              </div>
            </DialogContent>
          </DialogPortal>
        </Dialog>
      )}
    </Show>
  );
}
