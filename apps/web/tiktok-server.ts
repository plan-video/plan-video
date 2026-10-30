/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { handleTikTok, json, Refused } from "../../services/tiktok/handler.mjs";
import { serverEnv } from "./server-env";

// The client secret stays in apps/web/server.env, out of the browser bundle.
export function tiktokDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-tiktok",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path?.startsWith("/api/tiktok")) {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const env = {
          clientKey: envFile.TIKTOK_CLIENT_KEY?.trim() ?? "",
          clientSecret: envFile.TIKTOK_CLIENT_SECRET?.trim() ?? "",
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          requireInvite: envFile.VITE_INVITE_ONLY === "true",
          readVideos: envFile.TIKTOK_READ_VIDEOS?.trim() === "true",
        };
        void handleTikTok(req as IncomingMessage, res as ServerResponse, path, env).catch((error: unknown) => {
          if (error instanceof Refused) json(res as ServerResponse, error.status, { error: error.message });
          else json(res as ServerResponse, 500, { error: "TikTok isn't available right now." });
        });
      });
    },
  };
}
