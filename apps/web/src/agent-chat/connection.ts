/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Re-resolved on every reconnect, so a host that came back on another port is found again.

import { AgentChatClient } from "@plan.video/agent-chat";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";

const configuredUrl = (): string | null => (import.meta.env.VITE_AGENT_CHAT_URL as string | undefined) || null;

export async function resolveEndpoint(): Promise<string | null> {
  if (window.desktop) return (await mainBridge.call(MAIN_CHANNELS.AGENT_CHAT_ENDPOINT, undefined))?.url ?? null;
  return configuredUrl();
}

export const hasHost = (): boolean => !!window.desktop || configuredUrl() !== null;

export const client = new AgentChatClient({ resolveEndpoint });
