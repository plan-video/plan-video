/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { handleScan, handleVideo, json, Refused } from "../../services/clips/handler.mjs";
import { StreamError } from "../../services/clips/hls.mjs";
import { serverEnv } from "./server-env";

// Asks this dev server's own /api/transcribe and /api/agent/moments, so it needs their keys in server.env.
export function clipsDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-clips",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        const handle = path === "/api/clips/scan" ? handleScan : path === "/api/clips/video" ? handleVideo : null;
        if (!handle) {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const self = `http://${req.headers.host ?? "localhost:5173"}`;
        const env = {
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          requireInvite: envFile.VITE_INVITE_ONLY === "true",
          transcribeUrl: `${self}/api/transcribe`,
          agentUrl: `${self}/api/agent/moments`,
          ffmpeg: envFile.FFMPEG?.trim() || "ffmpeg",
          ffprobe: envFile.FFPROBE?.trim() || "ffprobe",
          ytdlp: envFile.YTDLP?.trim() || "yt-dlp",
          ytdlpCookies: envFile.YTDLP_COOKIES?.trim() || "",
        };
        void handle(req as IncomingMessage, res as ServerResponse, env).catch((error: unknown) => {
          if (error instanceof Refused || error instanceof StreamError) json(res as ServerResponse, error.status, { error: error.message });
          else json(res as ServerResponse, 500, { error: error instanceof Error ? error.message : "Finding clips failed" });
        });
      });
    },
  };
}
