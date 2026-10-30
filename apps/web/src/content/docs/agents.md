Connect plan.video to the AI agent you already use, and ask it to plan and post for you: "Schedule this video to TikTok and YouTube for Friday at 6pm."

<CardGroup cols={2}>
  <Card title="Connect an agent" icon="plug" href="/docs/connect-an-agent">
    Add plan.video to Claude, Claude Code, Cursor, Codex and others.
  </Card>
  <Card title="Example prompts" icon="message-square" href="/docs/example-prompts">
    Things to ask once it's connected.
  </Card>
  <Card title="Tools" icon="wrench" href="/docs/tools">
    What your agent can do in plan.video.
  </Card>
  <Card title="Access and safety" icon="shield" href="/docs/agent-access">
    What it can see and change, and how to disconnect it.
  </Card>
</CardGroup>

## How it works

plan.video runs an MCP server at `https://plan.video/mcp`. Any agent that supports MCP over Streamable HTTP can connect to it. You sign in with your plan.video account and allow the agent in, and it can then:

- see your connected accounts, media library and calendar
- write, schedule, move and delete posts
- read your Analytics, such as how your posts did on TikTok and YouTube, and pick good times
- publish a post when you ask

<Warning>
Keep plan.video open in a browser tab, signed in, while your agent works. The agent's requests run through that tab. Once a post is scheduled, it goes out on time whether the tab is open or not.
</Warning>

## Works with

Claude, Claude Code, Codex, Cursor, VS Code Copilot, Gemini CLI, Antigravity, Devin Desktop, OpenCode, and any other agent that supports MCP.

<Note>
Agents can schedule and publish posts. Editing videos with an agent isn't available yet.
</Note>
