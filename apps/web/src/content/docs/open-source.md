The dashboard, the video editor, the scheduler and the services that post for you are all in [one repository on GitHub](https://github.com/plan-video/plan-video), under the AGPL-3.0 license. plan.video's own homepage and marketing pages aren't part of it.

<CardGroup cols={2}>
  <Card title="Local development" icon="code" href="/docs/local-development">
    Run the dashboard and editor on your machine in a few minutes.
  </Card>
  <Card title="Self-hosting" icon="server" href="/docs/self-hosting">
    Run your own copy, with your own database and network apps.
  </Card>
  <Card title="Architecture" icon="layers" href="/docs/architecture">
    How the web app, Supabase and the services fit together.
  </Card>
  <Card title="Contributing" icon="git-pull-request" href="/docs/contributing">
    Report a bug, suggest a feature or send a pull request.
  </Card>
</CardGroup>

## What's in the repository

- **The web app**: the dashboard and the browser-based video editor, written in TypeScript with SolidJS.
- **The services**: small Node.js servers that send scheduled posts, keep network logins, run the MCP server for AI agents, and more.
- **The database**: Supabase migrations for every table, function and policy.

[Repository layout](/docs/repository) goes through it folder by folder.

## Hosted or self-hosted

The code is the same either way. What differs is who runs it.

| | plan.video | Your own copy |
| --- | --- | --- |
| Setup | Sign up | A server, Supabase, an R2 bucket and Caddy |
| Network apps | Already registered | You register one on each network, and each reviews it |
| Updates | Arrive on their own | You pull and deploy them |
| Plans | Free, Creator, Pro and Agency | Whatever you set in the database |
| Cost | Free, or a paid plan | Your server and the APIs you use |

## Get help

- **Bugs and ideas**: [GitHub issues](https://github.com/plan-video/plan-video/issues)
- **Questions**: the [Discord community](https://discord.gg/4C3g9FZsyr)
- **Security issues**: [hello@plan.video](mailto:hello@plan.video), not a public issue
