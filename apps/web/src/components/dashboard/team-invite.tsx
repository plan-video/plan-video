/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from "solid-js";
import { toast } from "somoto";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { acceptInvite, declineInvite, showInvite, shownInvite, teamInvites } from "@/lib/team";

import { ROLES } from "./team-members";
import { WorkspaceBadge } from "./workspace-switcher";

export function TeamInviteDialog() {
  const [busy, setBusy] = createSignal(false);
  const invite = () => teamInvites().find((row) => row.id === shownInvite());
  const close = () => !busy() && showInvite(null);

  const join = async () => {
    const current = invite();
    if (!current || busy()) return;
    setBusy(true);
    const failure = await acceptInvite(current);
    setBusy(false);
    if (failure) return void toast.error(failure);
    showInvite(null);
    toast.success(t("Joined {workspace}", { workspace: current.look.name }));
  };

  const decline = async () => {
    const current = invite();
    if (!current || busy()) return;
    setBusy(true);
    const failure = await declineInvite(current);
    setBusy(false);
    if (failure) return void toast.error(failure);
    showInvite(null);
  };

  return (
    <AlertDialog open={!!invite()} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <Show when={invite()}>
          {(current) => (
            <>
              <AlertDialogHeader>
                <div class="mb-1 flex items-center gap-2.5">
                  <WorkspaceBadge workspace={current().look} class="size-8 rounded-lg text-sm" />
                  <AlertDialogTitle>{t("Join {workspace}?", { workspace: current().look.name })}</AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  {t("{name} asked you into {workspace} as {role, select, admin {an admin} other {a member}}.", {
                    name: current().invitedBy || current().ownerName || current().ownerEmail,
                    workspace: current().look.name,
                    role: current().role,
                  })}{" "}
                  {t(ROLES.find((item) => item.id === current().role)!.detail)}
                </AlertDialogDescription>
                <Show when={!current().open}>
                  <p class="text-xs text-muted-foreground">{t("This workspace's plan doesn't include team members right now. You can join once its owner is on Pro or Agency.")}</p>
                </Show>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button variant="secondary" disabled={busy()} onClick={() => void decline()}>
                  {t("Decline")}
                </Button>
                <Button disabled={busy() || !current().open} onClick={() => void join()}>
                  {t({ message: "Join", context: "invite" })}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </Show>
      </AlertDialogContent>
    </AlertDialog>
  );
}
