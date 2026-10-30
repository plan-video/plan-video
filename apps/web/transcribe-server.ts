/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { handleTranscribe, json, Refused } from "../../services/transcribe/handler.mjs";
import { serverEnv } from "./server-env";

// ELEVENLABS_API_KEY stays in apps/web/server.env, out of the browser bundle.
export function transcribeDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-transcribe",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/api/transcribe") {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const env = {
          elevenLabsKey: envFile.ELEVENLABS_API_KEY?.trim() ?? "",
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          requireInvite: envFile.VITE_INVITE_ONLY === "true",
        };
        if (!env.elevenLabsKey) {
          json(res as ServerResponse, 503, {
            error: "Add ELEVENLABS_API_KEY to apps/web/server.env. Use the secret, not the key name, then try Auto-Captions again.",
          });
          return;
        }
        void handleTranscribe(req as IncomingMessage, res as ServerResponse, env).catch((error: unknown) => {
          if (error instanceof Refused) json(res as ServerResponse, error.status, { error: error.message });
          else json(res as ServerResponse, 500, { error: error instanceof Error ? error.message : "Transcription failed" });
        });
      });
    },
  };
}
