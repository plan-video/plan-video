plan.video is one repository: an npm workspace with the apps and packages, plus the services and the database next to them.

```text
plan.video/
  apps/        the website
  packages/    the editor's engine and shared code
  services/    the server's services, one folder each
  supabase/    the database's migrations, email templates and tests
  scripts/     tools for installing, translating and releasing
  patches/     fixes applied to node_modules on install
  docs/        skills and references AI agents read
```

## Apps

| Folder | What it is |
| --- | --- |
| `apps/web` | The website, dashboard and editor. SolidJS, Vite and Tailwind CSS. |

Most of the work happens in `apps/web/src`:

| Folder | What's in it |
| --- | --- |
| `pages` | One file per page or route, such as `docs.tsx` or `dashboard.tsx` |
| `components` | The UI, with a folder for each area: `calendar`, `dashboard`, `timeline` and more |
| `lib` | Logic without UI: syncing, scheduling, each network's sign-in, translations |
| `content/docs` | These docs, one Markdown file per page |
| `locales` | The translations, one JSON file per language |

## Packages

| Package | What it does |
| --- | --- |
| `runtime` | The editor's engine: the project's state, media, timing and drawing, with no UI |
| `reconciler` | Turns a project, written as JSX, into the runtime's objects |
| `jsx` | The types and functions a project is written with |
| `encoder` | Exports video, audio and pictures in the browser |
| `assets` | A project's files: the library, hashing and reading media details |
| `dapi` | The tools AI agents use, with their names, descriptions and schemas, shared by the Assistant and the MCP server |
| `koota-solid` | Solid bindings for koota, the store the runtime is built on |
| `agent-chat` | Runs Claude Code or Codex on your computer and streams them to the app |
| `api-contract` | Types for an older backend API |

## Services

Each folder in `services/` is a small Node.js server with its systemd unit: `publisher`, `storage`, `mcp`, `agent`, `transcribe`, `billing`, `tiktok`, `youtube`, `linkedin` and `x`, plus `monitor`, a shell script on a timer. They aren't part of the npm workspace: the four with dependencies, `agent`, `mcp`, `publisher` and `storage`, have their own `package.json`. [Services](/docs/services) says what each does.

The dev server runs `agent`, `transcribe`, `billing` and the four network services itself, from the files beside `apps/web/vite.config.ts`, so you don't need them to develop.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev -w @plan.video/web` | Starts the dev server at `localhost:5173` |
| `npm run build` | Builds the website into `apps/web/dist` |
| `npm run check -w @plan.video/web` | Type-checks the website |
| `npm test` | Runs the workspaces' unit tests |
| `npm run i18n` | Checks the translations; see [Translations](/docs/translations) |
