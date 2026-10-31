/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AgentChatClient } from "@plan.video/agent-chat";

const configuredUrl = (): string | null => (import.meta.env.VITE_AGENT_CHAT_URL as string | undefined) || null;

export const hasHost = (): boolean => configuredUrl() !== null;

export const client = new AgentChatClient({ resolveEndpoint: async () => configuredUrl() });
