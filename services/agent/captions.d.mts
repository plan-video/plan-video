import type { IncomingMessage, ServerResponse } from "node:http";

export function handleCaptions(
  req: IncomingMessage,
  res: ServerResponse,
  env: {
    anthropicKey: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    requireInvite: boolean;
    captionsBudget?: number | string;
    siteBudget?: number;
    freeShare?: number;
    networkBudget?: number;
  },
): Promise<void>;
