import type { IncomingMessage, ServerResponse } from "node:http";

export function handleMoments(
  req: IncomingMessage,
  res: ServerResponse,
  env: {
    anthropicKey: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    requireInvite: boolean;
    momentsBudget?: number | string;
    siteBudget?: number;
    freeShare?: number;
    networkBudget?: number;
  },
): Promise<void>;
