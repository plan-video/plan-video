/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tab's side of the hosted connector (services/mcp). Every signed-in tab
// keeps a socket to the connector, signed in as its user, and runs the tool
// calls agents make there: the posting tools, with the dashboard agent's own
// handlers (see lib/agent-connector), and, once agentic editing is back, the
// editor's tools on the project open in the tab, one undo step each. Calls
// run one at a time, in the order they came.

import { supabase } from "@/lib/supabase";

const PATH = "/api/mcp/tab";
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;

/**
 * Off until agentic editing launches: agents schedule posts, and the editor's
 * tools stay unserved. Turned back on, an open project answers them too.
 */
export const AGENTIC_EDITING = false;

/** In production builds of the website, and in dev when asked for. */
export const connectorEnabled =
  (import.meta.env.PROD || import.meta.env.VITE_CONNECTOR_DEV === "true") && !window.desktop && supabase !== null;

export type ConnectorOutput = {
  text: string;
  images?: { mediaType: "image/png"; data: string }[];
};

/** Runs one call, or throws what to tell the agent. `arrived` is when the call reached the tab, which may be before it starts. */
export type ConnectorRunner = (tool: string, args: Record<string, unknown>, call?: { arrived: number }) => Promise<ConnectorOutput>;

let editorRunner: ConnectorRunner | null = null;

/** The open project's tools while one is open, then null again. */
export function setEditorRunner(run: ConnectorRunner | null) {
  editorRunner = run;
}

/** The open project's tools, when agentic editing is on and a project is open. */
export function openEditor(): ConnectorRunner | null {
  return AGENTIC_EDITING ? editorRunner : null;
}

type Call = { type: "call"; id: string; tool: string; args?: Record<string, unknown> };
type Incoming = Call | { type: "ready" };

/** Opens the tab's connection; returns what closes it for good. */
export function connectClaude(run: ConnectorRunner): () => void {
  const auth = supabase?.auth;
  if (!auth) return () => {};

  let socket: WebSocket | null = null;
  let stopped = false;
  let retryMs = RETRY_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();

  const send = (ws: WebSocket, message: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const answer = async (ws: WebSocket, call: Call, arrived: number) => {
    try {
      const output = await run(call.tool, call.args ?? {}, { arrived });
      send(ws, { type: "result", id: call.id, ok: true, text: output.text, images: output.images ?? [] });
    } catch (error) {
      send(ws, { type: "result", id: call.id, ok: false, error: (error as Error).message || String(error) });
    }
  };

  const schedule = () => {
    if (stopped) return;
    clearTimeout(retryTimer);
    // Jittered, so a server restart isn't met by every tab at once.
    retryTimer = setTimeout(() => void open(), retryMs * (0.5 + Math.random()));
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  };

  const open = async () => {
    if (stopped || socket) return;
    const token = (await auth.getSession()).data.session?.access_token;
    if (stopped || socket) return;
    if (!token) return schedule();

    const url = new URL(PATH, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => send(ws, { type: "hello", token });
    ws.onmessage = (event) => {
      let message: Incoming;
      try {
        message = JSON.parse(String(event.data)) as Incoming;
      } catch {
        return;
      }
      if (message.type === "ready") {
        retryMs = RETRY_MIN_MS;
        if (document.visibilityState === "visible") send(ws, { type: "active" });
      } else if (message.type === "call") {
        // The relay's clock for the call starts now, also while an earlier one still runs.
        const arrived = Date.now();
        queue = queue.then(() => answer(ws, message, arrived));
      }
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      schedule();
    };
  };

  /** The user is back on this tab, so the next call should land here. */
  const onActive = () => {
    if (document.visibilityState === "visible" && socket) send(socket, { type: "active" });
  };
  window.addEventListener("focus", onActive);
  document.addEventListener("visibilitychange", onActive);

  const { data: { subscription } } = auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") socket?.close(1000);
    else if (event === "SIGNED_IN" && !socket) void open();
  });

  void open();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    subscription.unsubscribe();
    window.removeEventListener("focus", onActive);
    document.removeEventListener("visibilitychange", onActive);
    socket?.close(1000);
    socket = null;
  };
}
