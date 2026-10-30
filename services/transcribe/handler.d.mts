import type { IncomingMessage, ServerResponse } from "node:http";

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string);
}

export function handleTranscribe(
  req: IncomingMessage,
  res: ServerResponse,
  env: {
    elevenLabsKey: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    requireInvite: boolean;
    /** Where uploads wait while they're transcribed. The system's temp folder when unset. */
    tmpDir?: string;
  },
): Promise<void>;

export function json(res: ServerResponse, status: number, body: unknown): void;
