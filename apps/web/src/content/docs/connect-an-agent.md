Add plan.video to your agent with this address:

```text
https://plan.video/mcp
```

The first time your agent connects, a plan.video page opens where you sign in and click **Allow**.

## Claude

<Steps>
  <Step title="Open Connectors">
    In Claude, open **Settings**, then **Connectors**.
  </Step>
  <Step title="Add a custom connector">
    Click **Add custom connector**, name it *plan.video*, and paste `https://plan.video/mcp`.
  </Step>
  <Step title="Sign in">
    Click **Connect**, sign in with your plan.video account, and click **Allow**.
  </Step>
</Steps>

This works in Claude on the web, the desktop app and the mobile apps.

## Coding agents

<CodeGroup>

```bash Claude Code
claude mcp add --transport http planvideo https://plan.video/mcp
# Then run /mcp in Claude Code and pick planvideo to sign in.
```

```toml Codex
# ~/.codex/config.toml
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
```

```json VS Code
// .vscode/mcp.json
{
  "servers": {
    "planvideo": {
      "type": "http",
      "url": "https://plan.video/mcp"
    }
  }
}
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
      "serverUrl": "https://plan.video/mcp"
    }
  }
}
```

```json OpenCode
// opencode.json
{
  "mcp": {
    "planvideo": {
      "type": "remote",
      "url": "https://plan.video/mcp"
    }
  }
}
// Then sign in from your terminal: opencode mcp auth planvideo
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
Your agents are listed in the dashboard under **MCP & CLI** → **Connected apps**.
</Tip>
