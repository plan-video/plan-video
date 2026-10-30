import type { IncomingMessage, ServerResponse } from "node:http";

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string);
}

export function handleBilling(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  env: {
    stripeKey: string;
    webhookSecret: string;
    automaticTax: boolean;
    supabaseUrl: string;
    supabaseAnonKey: string;
    serviceKey: string;
    publicUrl: string;
  },
): Promise<void>;

export function fail(res: ServerResponse, error: unknown): void;

export function json(res: ServerResponse, status: number, body: unknown): void;
