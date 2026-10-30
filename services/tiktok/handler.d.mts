import type { IncomingMessage, ServerResponse } from "node:http";

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string);
}

export function handleTikTok(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  env: {
    clientKey: string;
    clientSecret: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    requireInvite: boolean;
    /** Asks for video.list too, once the TikTok app has it, so Analytics can read the account's videos. */
    readVideos?: boolean;
  },
): Promise<void>;

export function json(res: ServerResponse, status: number, body: unknown): void;
