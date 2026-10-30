/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { handleLinkedIn, json, Refused } from "../../services/linkedin/handler.mjs";
import { serverEnv } from "./server-env";

/**
 * Dev-server routes under `/api/linkedin`. The client secret stays in
 * `apps/web/server.env` and never enters the browser bundle.
 */
export function linkedinDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-linkedin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path?.startsWith("/api/linkedin")) {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const env = {
          clientId: envFile.LINKEDIN_CLIENT_ID?.trim() ?? "",
          clientSecret: envFile.LINKEDIN_CLIENT_SECRET?.trim() ?? "",
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          requireInvite: envFile.VITE_INVITE_ONLY === "true",
        };
        void handleLinkedIn(req as IncomingMessage, res as ServerResponse, path, env).catch((error: unknown) => {
          if (error instanceof Refused) json(res as ServerResponse, error.status, { error: error.message });
          else json(res as ServerResponse, 500, { error: "LinkedIn isn't available right now." });
        });
      });
    },
  };
}
