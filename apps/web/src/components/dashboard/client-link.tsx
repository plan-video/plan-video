/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Connections' client link: a link the workspace's owner or an admin sends a
// client, who connects their own accounts to this workspace with it, without
// a plan.video account (lib/connect-link.ts, pages/connect.tsx). The accounts
// they connect show up in Networks above as the account syncs.

import { Show, createResource, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { TextField, TextFieldInput } from "@/components/ui/text-field";
import { useAuth } from "@/context/auth";
import { connectLinkUrl, createConnectLink, loadConnectLink, revokeConnectLink, type ConnectLink } from "@/lib/connect-link";
import { intlLocale, t } from "@/lib/i18n";
import { activeScope, activeShared, activeWorkspace, activeWorkspaceId, shownWorkspaceName } from "@/lib/workspaces";

import { DashboardGroupLabel } from "./page-header";
import { DashboardSurfaceCard } from "./shared";

export function ClientLinkSection() {
  const auth = useAuth();
  /** The workspace the link is for: the open one, yours or one shared with you. */
  const where = () => ({ workspace: activeWorkspaceId(), team: activeScope() });
  const workspaceName = () => activeShared()?.name ?? shownWorkspaceName(activeWorkspace().name);
  const fromName = () => {
    const meta = auth.user()?.user_metadata as Record<string, unknown> | undefined;
    const name = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "";
    return name.trim() || auth.user()?.email?.split("@")[0] || "";
  };

  const [link, { mutate, refetch }] = createResource(where, async ({ workspace, team }) => loadConnectLink(workspace, team).catch(() => null), {
    initialValue: null,
  });
  const [busy, setBusy] = createSignal(false);

  // A client may have just connected through it: the count is read again when you come back to the tab.
  const onFocus = () => void refetch();
  window.addEventListener("focus", onFocus);
  onCleanup(() => window.removeEventListener("focus", onFocus));

  const copy = async (current: ConnectLink) => {
    try {
      await navigator.clipboard.writeText(connectLinkUrl(current.link));
      toast.success(t("Link copied"), { description: t("Anyone with it can connect accounts to {workspace} until it runs out.", { workspace: workspaceName() }) });
    } catch {
      toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
    }
  };

  const make = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const made = await createConnectLink(where().workspace, { workspaceName: workspaceName(), fromName: fromName() }, where().team);
      mutate(made);
      await copy(made);
    } catch (error) {
      toast.error(t("Couldn't make the link"), { description: error instanceof Error ? error.message : t("Try again in a moment.") });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await revokeConnectLink(where().workspace, where().team);
      mutate(null);
      toast.success(t("Link turned off"), { description: t("It doesn't connect accounts any more. Accounts already connected stay.") });
    } catch (error) {
      toast.error(t("Couldn't turn the link off"), { description: error instanceof Error ? error.message : t("Try again in a moment.") });
    } finally {
      setBusy(false);
    }
  };

  const until = (current: ConnectLink) => new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" }).format(new Date(current.expiresAt));

  return (
    <section class="flex flex-col gap-2">
      <div class="flex flex-col gap-1 px-1">
        <DashboardGroupLabel>{t("Client link")}</DashboardGroupLabel>
        <p class="text-xs text-muted-foreground">
          {t("Send it to a client to connect their own accounts to {workspace}. They sign in to each network themselves and don't need a plan.video account.", {
            workspace: workspaceName(),
          })}
        </p>
      </div>
      <DashboardSurfaceCard class="flex flex-col gap-3">
        <Show
          when={link()}
          fallback={
            <div class="flex items-center gap-3">
              <p class="min-w-0 flex-1 text-xs text-muted-foreground">{t("No link yet. Each link works for 7 days.")}</p>
              <Button variant="secondary" disabled={busy()} onClick={() => void make()}>
                {t("Create link")}
              </Button>
            </div>
          }
        >
          {(current) => (
            <>
              <div class="flex items-center gap-2">
                <TextField class="min-w-0 flex-1">
                  <TextFieldInput uiSize="compact" readOnly value={connectLinkUrl(current().link)} aria-label={t("Client link")} onFocus={(event) => event.currentTarget.select()} />
                </TextField>
                <Button variant="secondary" onClick={() => void copy(current())}>
                  {t("Copy")}
                </Button>
              </div>
              <div class="flex items-center gap-3">
                <p class="min-w-0 flex-1 text-xs text-muted-foreground">
                  {t("Works until {date} · {count, plural, =0 {no accounts connected yet} one {# account connected} other {# accounts connected}}", {
                    date: until(current()),
                    count: current().connected,
                  })}
                </p>
                <Button variant="link" disabled={busy()} onClick={() => void make()}>
                  {t("New link")}
                </Button>
                <Button variant="link" disabled={busy()} onClick={() => void turnOff()}>
                  {t("Turn off")}
                </Button>
              </div>
            </>
          )}
        </Show>
      </DashboardSurfaceCard>
    </section>
  );
}
