/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createResource, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Switch as Toggle, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { intlLocale, t } from "@/lib/i18n";
import {
  AGENT_ICONS,
  applyMcp,
  fetchCliStatus,
  fetchMcpStatus,
  installCli,
  uninstallCli,
  type AgentId,
  type McpAgentStatus,
} from "@/lib/mcp";
import { isDesktop } from "@/projects";
import { supabase } from "@/lib/supabase";

import {
  DashboardDividedStack,
  DashboardInfoActionRow,
  DashboardScrollView,
  DashboardSurfaceCard,
  DashboardSurfaceSection,
  DashboardTitledSection,
} from "./shared";

const MCP_DOCS_URL = "https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers";

// --- Agents ------------------------------------------------------------------

type AgentRowProps = {
  agent: McpAgentStatus;
  /** The state the switch is moving to while a write is in flight. */
  pending: boolean | undefined;
  onChange: (connected: boolean) => void;
};

function AgentRow(props: AgentRowProps) {
  const checked = () => props.pending ?? props.agent.connected;

  return (
    <DashboardInfoActionRow
      layout="inline"
      leadingSize="sm"
      title={props.agent.label}
      leading={<Icon name={AGENT_ICONS[props.agent.id]} class="text-foreground" />}
      action={
        <Toggle
          checked={checked()}
          disabled={props.pending !== undefined}
          onChange={props.onChange}
          class="flex shrink-0 items-center"
        >
          <SwitchInput aria-label={t("Connect {agent}", { agent: props.agent.label })} />
          <SwitchControl variant="compact">
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Toggle>
      }
    />
  );
}

function DashboardAgentsSection() {
  const [status, { refetch }] = createResource(fetchMcpStatus);
  const [pending, setPending] = createSignal<Partial<Record<AgentId, boolean>>>({});

  const labelOf = (id: AgentId) => status()?.agents.find((agent) => agent.id === id)?.label ?? id;

  /** Every agent not yet connected. */
  const connectable = () => (status()?.agents ?? []).filter((agent) => !agent.connected);

  /**
   * Writes the change straight into the agents' configs — a switch is not a
   * draft. Whatever fails snaps back, with the reason in a toast.
   */
  const apply = async (add: AgentId[], remove: AgentId[]) => {
    if (add.length + remove.length === 0) return;
    setPending((current) => ({
      ...current,
      ...Object.fromEntries(add.map((id) => [id, true])),
      ...Object.fromEntries(remove.map((id) => [id, false])),
    }));
    try {
      const result = await applyMcp({ add, remove });
      const changed = result.added.length + result.removed.length;
      if (result.failures.length > 0) {
        toast.error(changed > 0 ? t("Some agents could not be updated") : t("Agents could not be updated"), {
          description: result.failures.map((failure) => `${labelOf(failure.id)}: ${failure.error}`).join("\n"),
        });
      }
    } catch (e) {
      toast.error(t("Could not update the agents"), { description: (e as Error).message });
    } finally {
      await refetch();
      setPending((current) => {
        const next = { ...current };
        for (const id of [...add, ...remove]) delete next[id];
        return next;
      });
    }
  };

  const setConnected = (agent: McpAgentStatus, connected: boolean) =>
    apply(connected ? [agent.id] : [], connected ? [] : [agent.id]);

  const enableAll = () => apply(connectable().map((agent) => agent.id), []);

  return (
    <DashboardTitledSection
      title={t("Agents")}
      description={t("Connect to Plan Video’s MCP server to schedule and publish posts with your agents.")}
      action={
        <Button variant="link" class="h-4" disabled={connectable().length === 0} onClick={enableAll}>
          {t("Enable all")}
        </Button>
      }
    >
      <DashboardSurfaceCard class="flex flex-col gap-3">
        <Show
          when={status()}
          fallback={<p class="text-xs text-muted-foreground">{t("Checking agents...")}</p>}
        >
          {(current) => (
            <DashboardDividedStack>
              <For each={current().agents}>
                {(agent) => (
                  <AgentRow
                    agent={agent}
                    pending={pending()[agent.id]}
                    onChange={(connected) => void setConnected(agent, connected)}
                  />
                )}
              </For>
            </DashboardDividedStack>
          )}
        </Show>
      </DashboardSurfaceCard>
    </DashboardTitledSection>
  );
}

// --- MCP server --------------------------------------------------------------

const COPIED_LABEL_MS = 2000;

function DashboardMcpServerSection() {
  const [status] = createResource(fetchMcpStatus);
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  const copy = async () => {
    const url = status()?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      // The button itself says so for a moment, then goes back to its label.
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    } catch (e) {
      toast.error(t("Failed to copy"), { description: (e as Error).message });
    }
  };

  return (
    <DashboardTitledSection title={t("MCP Server")}>
      <DashboardSurfaceCard class="flex flex-col gap-3">
        <DashboardInfoActionRow
          layout="inline"
          leadingSize="sm"
          title="Plan Video MCP"
          leading={<Icon name="ai-mcp-cli" class="text-foreground" />}
          description={t("Connect any other agent that supports MCP over Streamable HTTP. The same server schedules posts.")}
          action={
            <div class="flex shrink-0 items-center gap-2">
              <div class="flex h-7 w-41 items-center rounded-md bg-input px-2">
                <span class="min-w-0 flex-1 truncate text-xs text-foreground">{status()?.url ?? "..."}</span>
              </div>
              <Button variant="secondary" disabled={!status()} onClick={copy}>
                {copied() ? t("Copied!") : t("Copy URL")}
              </Button>
            </div>
          }
        />
      </DashboardSurfaceCard>
      <p class="px-2 pt-3 text-xs text-muted-foreground">
        <span>{t("Available locally while Plan Video is running.")}{" "}</span>
        <a href={MCP_DOCS_URL} target="_blank" class="text-primary hover:underline focus-ring">
          {t("What is MCP?")}
        </a>
      </p>
    </DashboardTitledSection>
  );
}

// --- Claude connector (website) ---------------------------------------------

/** Where Claude reaches the connector (services/mcp), on the site's own domain. */
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

// --- CLI ---------------------------------------------------------------------

function DashboardCliSection() {
  const [status, { refetch }] = createResource(fetchCliStatus);
  const [busy, setBusy] = createSignal(false);

  const handleInstall = async () => {
    setBusy(true);
    try {
      const result = await installCli();
      if (result.status === "installed") {
        toast(t("CLI installed"), { description: t("Open a terminal and run --help to see the commands.") });
      }
      if (result.status === "error") {
        toast.error(t("Could not install the CLI"), { description: result.error });
      }
    } catch (e) {
      toast.error(t("Could not install the CLI"), { description: (e as Error).message });
    } finally {
      setBusy(false);
      void refetch();
    }
  };

  const handleUninstall = async () => {
    setBusy(true);
    try {
      const result = await uninstallCli();
      if (result.status === "removed") toast(t("CLI uninstalled"));
      if (result.status === "error") toast.error(t("Could not uninstall the CLI"), { description: result.error });
    } catch (e) {
      toast.error(t("Could not uninstall the CLI"), { description: (e as Error).message });
    } finally {
      setBusy(false);
      void refetch();
    }
  };

  return (
    <DashboardSurfaceSection
      title="CLI"
      description={t("Give agents access to Plan Video through terminal commands.")}
    >
      <DashboardInfoActionRow
        layout="inline"
        leadingSize="sm"
        title="Plan Video CLI"
        leading={<Icon name="dapi-cli" class="text-foreground" />}
        description={t("Plan Video’s command-line tool for accessing its media tools and managing projects.")}
        action={
          <Switch>
            <Match when={!status()}>
              <Button variant="secondary" disabled>
                {t("Install")}
              </Button>
            </Match>
            <Match when={status()?.installed && status()?.managed}>
              <Tooltip>
                <TooltipTrigger as={Button} variant="secondary" disabled={busy()} onClick={handleUninstall}>
                  {t("Uninstall")}
                </TooltipTrigger>
                <TooltipContent>{t("Installed at {path}", { path: status()?.path })}</TooltipContent>
              </Tooltip>
            </Match>
            <Match when={status()?.installed}>
              <Tooltip>
                <TooltipTrigger as={Button} variant="on">
                  {t("Installed")}
                </TooltipTrigger>
                <TooltipContent>{t("Found at {path}. Not a link, so it is left alone.", { path: status()?.path })}</TooltipContent>
              </Tooltip>
            </Match>
            <Match when={true}>
              <Button variant="secondary" disabled={busy()} onClick={handleInstall}>
                {t("Install")}
              </Button>
            </Match>
          </Switch>
        }
      />
    </DashboardSurfaceSection>
  );
}

export function DashboardMcpView() {
  return (
    <DashboardScrollView>
      <Show
        when={isDesktop()}
        fallback={<DashboardClaudeSection />}
      >
        <DashboardAgentsSection />
        <DashboardMcpServerSection />
        <DashboardCliSection />
      </Show>
    </DashboardScrollView>
  );
}
