/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { handleCaptions } from "../../services/agent/captions.mjs";
import { handleAgent, json, Refused } from "../../services/agent/handler.mjs";
import { serverEnv } from "./server-env";

/**
 * Dev-server routes `POST /api/agent` and `POST /api/agent/captions`. Reads `ANTHROPIC_API_KEY` from
 * `apps/web/server.env` on each request, so the key stays out of the client bundle.
 * Production runs the same handler as services/agent.
 */
export function agentDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-agent",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        const handle = path === "/api/agent" ? handleAgent : path === "/api/agent/captions" ? handleCaptions : null;
        if (!handle) {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const env = {
          anthropicKey: envFile.ANTHROPIC_API_KEY?.trim() ?? "",
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          requireInvite: envFile.VITE_INVITE_ONLY === "true",
        };
        if (!env.anthropicKey) {
          json(res as ServerResponse, 503, { error: "Add ANTHROPIC_API_KEY to apps/web/server.env, then try the agent again." });
          return;
        }
        void handle(req as IncomingMessage, res as ServerResponse, env).catch((error: unknown) => {
          if (error instanceof Refused) json(res as ServerResponse, error.status, { error: error.message });
          else json(res as ServerResponse, 500, { error: error instanceof Error ? error.message : "The agent failed" });
        });
      });
    },
  };
}
