/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_HOST, MCP_PATH, MCP_PORT, tools } from "@plan.video/dapi";
import { mainHandlers } from "./handlers";
import { DapiHttpServer } from "./http";
import { instructions } from "./docs";
import { RendererCalls } from "./renderer-calls";
import { serveCatalog } from "./tools-session";

import type { LogEntry } from "@plan.video/dapi";
import type { MainContext, MainToolName } from "./handler";

/** Also the namespace agents show the tools under (`mcp__planvideo__<tool>`), so don't rename it. */
const SERVER_NAME = "planvideo";

export type DapiServerDeps = {
  version: string;
  logs(): LogEntry[];
  onFirstConnection(): void;
  docsDir: string | null;
};

export class DapiServer {
  private readonly deps: DapiServerDeps;
  private readonly renderer = new RendererCalls();
  private readonly http: DapiHttpServer;
  private instructionsText: string | null = null;
  private httpReady: Promise<boolean> = Promise.resolve(false);

  constructor(deps: DapiServerDeps) {
    this.deps = deps;
    for (const tool of tools) {
      if (tool.environment === "main" && !(tool.name in mainHandlers)) {
        throw new Error(`Main-process tool "${tool.name}" has no handler`);
      }
    }
    this.http = new DapiHttpServer({
      host: MCP_HOST,
      port: MCP_PORT,
      path: MCP_PATH,
      createSession: () => this.createSession(),
      onFirstConnection: () => deps.onFirstConnection(),
    });
  }

  get url(): string {
    return this.http.url;
  }

  start(): void {
    this.renderer.start();
    // A taken port is the one way this fails; the app works without agents, so it is logged, not fatal.
    this.httpReady = this.http.start().then(
      () => true,
      (error: Error) => {
        console.error(`[dapi] cannot serve MCP at ${this.url}: ${error.message}`);
        return false;
      },
    );
  }

  async mcpUrl(): Promise<string | null> {
    return (await this.httpReady) ? this.url : null;
  }

  stop(): void {
    this.http.stop();
  }

  private createSession(): McpServer {
    this.instructionsText ??= instructions(this.deps.docsDir);
    // `name` must match the key we write into agent configs; `title` is what a client shows a person.
    const session = new McpServer({ name: SERVER_NAME, title: "plan.video", version: this.deps.version }, { instructions: this.instructionsText });
    serveCatalog(session, (tool, args, signal) =>
      tool.environment === "main" ?
        this.runInMain(tool.name as MainToolName, args, signal)
        : this.renderer.call(tool.name, args, signal),
    );
    return session;
  }

  private runInMain(name: MainToolName, args: unknown, signal: AbortSignal): Promise<unknown> {
    const ctx: MainContext = { signal, logs: this.deps.logs, version: this.deps.version };
    // The map's union type cannot pair each handler with its args, so the call site widens.
    return (mainHandlers[name] as (args: unknown, ctx: MainContext) => Promise<unknown>)(args, ctx);
  }
}
