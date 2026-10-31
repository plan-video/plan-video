/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { intlLocale, t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

import {
  DashboardDividedStack,
  DashboardInfoActionRow,
  DashboardScrollView,
  DashboardSurfaceCard,
  DashboardTitledSection,
} from "./shared";

const COPIED_LABEL_MS = 2000;

const CONNECTOR_URL = `${import.meta.env.VITE_APP_URL || window.location.origin}/mcp`;

type Grant = { clientId: string; name: string; grantedAt: string };

async function fetchGrants(): Promise<Grant[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) throw new Error(error.message);
  return data.map((grant) => ({ clientId: grant.client.id, name: grant.client.name || t("An app"), grantedAt: grant.granted_at }));
}

const grantDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", year: "numeric" });

function DashboardClaudeSection() {
  const [grants, { refetch }] = createResource(fetchGrants);
  const [revoking, setRevoking] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    } catch (e) {
      toast.error(t("Failed to copy"), { description: (e as Error).message });
    }
  };

  const revoke = async (grant: Grant) => {
    if (!supabase) return;
    setRevoking(grant.clientId);
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: grant.clientId });
    setRevoking(null);
    if (error) toast.error(t("Could not disconnect {name}", { name: grant.name }), { description: error.message });
    void refetch();
  };

  return (
    <>
      <DashboardTitledSection title="Claude">
        <DashboardSurfaceCard class="flex flex-col gap-3">
          <DashboardInfoActionRow
            layout="inline"
            leadingSize="sm"
            title={t("Plan Video connector")}
            leading={<Icon name="claude" class="text-foreground" />}
            description={t("In Claude, open Settings, then Connectors, add a custom connector and paste this URL.")}
            action={
              <div class="flex shrink-0 items-center gap-2">
                <div class="flex h-7 w-41 items-center rounded-md bg-input px-2">
                  <span class="min-w-0 flex-1 truncate text-xs text-foreground">{CONNECTOR_URL}</span>
                </div>
                <Button variant="secondary" onClick={copy}>
                  {copied() ? t("Copied!") : t("Copy URL")}
                </Button>
              </div>
            }
          />
        </DashboardSurfaceCard>
        <p class="px-2 pt-3 text-xs text-muted-foreground">
          {t(
            "Sign in with your plan.video account, then ask Claude to write, schedule, move or publish your posts. Keep plan.video open in a tab while it works.",
          )}
        </p>
      </DashboardTitledSection>

      <Show when={grants()?.length}>
        <DashboardTitledSection title={t("Connected apps")}>
          <DashboardSurfaceCard class="flex flex-col gap-3">
            <DashboardDividedStack>
              <For each={grants()}>
                {(grant) => (
                  <DashboardInfoActionRow
                    layout="inline"
                    leadingSize="sm"
                    title={grant.name}
                    description={t("Connected {date}", { date: grantDate(grant.grantedAt) })}
                    action={
                      <Button variant="secondary" disabled={revoking() === grant.clientId} onClick={() => void revoke(grant)}>
                        {t("Disconnect")}
                      </Button>
                    }
                  />
                )}
              </For>
            </DashboardDividedStack>
          </DashboardSurfaceCard>
        </DashboardTitledSection>
      </Show>
    </>
  );
}

export function DashboardMcpView() {
  return (
    <DashboardScrollView>
      <DashboardClaudeSection />
    </DashboardScrollView>
  );
}
