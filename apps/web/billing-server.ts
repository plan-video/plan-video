/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { fail, handleBilling } from "../../services/billing/handler.mjs";
import { serverEnv } from "./server-env";

// The Stripe key and billing's database key stay in apps/web/server.env, out of the browser bundle.
// Use a test-mode key, and `stripe listen --forward-to localhost:5173/api/billing/webhook` for webhooks.
export function billingDevPlugin(envDir: string, mode: string): Plugin {
  return {
    name: "plan-billing",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path?.startsWith("/api/billing/")) {
          next();
          return;
        }
        const envFile = serverEnv(mode, envDir);
        const env = {
          stripeKey: envFile.STRIPE_SECRET_KEY?.trim() ?? "",
          webhookSecret: envFile.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
          automaticTax: envFile.STRIPE_AUTOMATIC_TAX === "true",
          supabaseUrl: envFile.VITE_SUPABASE_URL?.trim() ?? "",
          supabaseAnonKey: envFile.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
          databaseKey: envFile.BILLING_DB_KEY?.trim() ?? "",
          publicUrl: `http://${req.headers.host ?? "localhost:5173"}`,
        };
        void handleBilling(req as IncomingMessage, res as ServerResponse, path, env).catch((error: unknown) =>
          fail(res as ServerResponse, error),
        );
      });
    },
  };
}
