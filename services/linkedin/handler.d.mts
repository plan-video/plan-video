import type { IncomingMessage, ServerResponse } from "node:http";

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string);
}

export function handleLinkedIn(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  env: {
    clientId: string;
    clientSecret: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    requireInvite: boolean;
  },
): Promise<void>;

export function json(res: ServerResponse, status: number, body: unknown): void;
