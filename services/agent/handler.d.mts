import type { IncomingMessage, ServerResponse } from "node:http";

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string);
}

export function handleAgent(
  req: IncomingMessage,
  res: ServerResponse,
  env: {
    anthropicKey: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    requireInvite: boolean;
    personBudget?: number | string;
    siteBudget?: number;
    freeShare?: number;
    networkBudget?: number;
  },
): Promise<void>;

export function json(res: ServerResponse, status: number, body: unknown): void;
