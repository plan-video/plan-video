/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { handleX, json, Refused } from "../../services/x/handler.mjs";
import { serverEnv } from "./server-env";

/**
 * Dev-server routes under `/api/x/`. The client secret stays in
 * `apps/web/server.env` and never enters the browser bundle.
 */
export function xDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-x",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path?.startsWith("/api/x/")) {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const env = {
          clientId: envFile.X_CLIENT_ID?.trim() ?? "",
          clientSecret: envFile.X_CLIENT_SECRET?.trim() ?? "",
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          requireInvite: envFile.VITE_INVITE_ONLY === "true",
        };
        void handleX(req as IncomingMessage, res as ServerResponse, path, env).catch((error: unknown) => {
          if (error instanceof Refused) json(res as ServerResponse, error.status, { error: error.message });
          else json(res as ServerResponse, 500, { error: "X isn't available right now." });
        });
      });
    },
  };
}
