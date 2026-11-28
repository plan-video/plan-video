import type { IncomingMessage, ServerResponse } from "node:http";

export type ClipsEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  requireInvite: boolean;
  transcribeUrl: string;
  agentUrl: string;
  ffmpeg?: string;
  tmpDir?: string;
};

export class Refused extends Error {
  status: number;
}

export function handleScan(req: IncomingMessage, res: ServerResponse, env: ClipsEnv): Promise<void>;
export function handleVideo(req: IncomingMessage, res: ServerResponse, env: ClipsEnv): Promise<void>;
export function json(res: ServerResponse, status: number, body: unknown): void;
