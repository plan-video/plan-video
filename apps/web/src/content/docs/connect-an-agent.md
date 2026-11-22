Add plan.video to your agent with this address:

```text
https://plan.video/mcp
```

The first time your agent connects, a plan.video page opens where you sign in and click **Allow**.

## Claude

<Steps>
  <Step title="Open Connectors">
    In Claude, open **Customize**, then **Connectors**.
  </Step>
  <Step title="Add a custom connector">
    Click **Add**, then **Add custom connector**. Name it *plan.video*, paste `https://plan.video/mcp`, and click **Add**.
  </Step>
  <Step title="Sign in">
    Click **Connect**, sign in with your plan.video account, and click **Allow**.
  </Step>
</Steps>

Add it once on the web or in the desktop app, and it's there in Claude's mobile apps too. On a Team or Enterprise plan, an owner adds it under **Organization settings**, and each member clicks **Connect**.

## Coding agents

<CodeGroup>

```bash Claude Code
claude mcp add --transport http --scope user planvideo https://plan.video/mcp
# Then run /mcp in Claude Code and pick planvideo to sign in.
```

```toml Codex
# ~/.codex/config.toml, shared by the ChatGPT desktop app, the Codex CLI and the IDE extension
[mcp_servers.planvideo]
url = "https://plan.video/mcp"

# Then sign in from your terminal: codex mcp login planvideo
```

```json Cursor
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "planvideo": {
      "url": "https://plan.video/mcp"
    }
  }
}
// Then open Customize, find planvideo under MCP and click Connect.
```

```json VS Code
// ~/.copilot/mcp-config.json
{
  "mcpServers": {
    "planvideo": {
      "type": "http",
      "url": "https://plan.video/mcp"
    }
  }
}
// Then run MCP: List Servers, start planvideo and click Authenticate.
```

```json Gemini CLI
// ~/.gemini/settings.json
{
  "mcpServers": {
    "planvideo": {
      "httpUrl": "https://plan.video/mcp"
    }
  }
}
// Then sign in from Gemini CLI: /mcp auth planvideo
// Moved to Antigravity CLI? Use the Antigravity config instead.
```

```json Antigravity
// Agent panel → … → MCP Servers → Manage MCP Servers → View raw config
{
  "mcpServers": {
    "planvideo": {
      "serverUrl": "https://plan.video/mcp"
    }
  }
}
```

```json Devin Desktop
// ~/.config/devin/mcp_config.json (formerly Windsurf)
{
  "mcpServers": {
    "planvideo": {
      "url": "https://plan.video/mcp",
      "transport": "http"
    }
  }
}
// Then open Customize → MCPs and click Authenticate next to planvideo.
```

```bash OpenCode
opencode mcp add planvideo --url https://plan.video/mcp
# Then sign in: opencode mcp auth planvideo
```

</CodeGroup>

Each agent has its own page with these steps, things to ask and its questions: see [AI agents](/agents).

For any other agent, add a remote MCP server with the address above. plan.video uses Streamable HTTP and signs you in with OAuth.

## Check it works

Ask your agent:

```text
Which social accounts do I have connected in plan.video?
```

It should list your accounts. If it can't reach plan.video, see [Troubleshooting](/docs/agent-troubleshooting).

<Tip>
Once one is connected, your agents are listed under **Connected apps** on the dashboard's [**MCP & CLI** page](https://plan.video/dashboard?dashboard=mcp).
</Tip>
