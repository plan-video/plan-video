# plan.video

plan.video is the all-in-one social media scheduler, with a video editor built in. People plan posts on a calendar, and the publisher sends them to 9 networks on time: YouTube, TikTok, Instagram, Facebook, Threads, X, LinkedIn, Bluesky and Pinterest. It runs in the browser: a SolidJS dashboard and editor (`apps/web`), Node services that post and connect accounts (`services/`), and Supabase for the database (`supabase/`).

## What we never compromise on

1. **Posts go out on time, once.** A missed or doubled post is the worst bug we can ship. Anything touching scheduling, the publisher or a network's API gets tests and a careful read.
2. **Simple, for people who aren't technical.** Most users are creators, not developers. Every screen should be obvious without a manual. Don't add a setting when a good default will do.
3. **Light and fast.** The dashboard and editor stay quick on an ordinary laptop, with or without a GPU. No animation that keeps repainting while nothing changes.
4. **Open, and easy to host.** The hosted plan.video runs this code. A self-hosted copy has to work from the docs alone, with no step that only plan.video can do.

## How we like to work

Ambitious ideas, simple systems. Find the real constraint, then make the smallest change that makes the right behaviour unsurprising. Don't keep complexity because it's already there, and don't add machinery because it looks impressive. "Measure twice, cut once" and "you aren't gonna need it" both apply. Honour what the developer asked for, no more. These are good defaults, not hard rules: the developer's wishes win.

## Words we use

- **user**: the person using plan.video. **you**: the agent changing the code.
- **workspace**: one brand's or client's space, with its own accounts, posts and team. Everyone starts with "Personal".
- **account**: a social account connected to a workspace (a YouTube channel, an X profile…). **network**: the service it's on.
- **post**: what goes out, to one or more accounts. **thread**: a post with follow-ups (replies on X and Bluesky, comments on LinkedIn).
- **queue**: a workspace's regular posting times, which new posts fill in order.
- **publisher**: the service that sends due posts and holds every network login. No network token ever reaches a browser.
- **plug**: a rule that acts on a post after it goes out, such as reposting it or replying under it with a link.
- **Assistant**: the chat built into the dashboard. **agents**: outside AIs (Claude, Codex, Cursor…) that connect over MCP at `/mcp`.
- **guest mode**: the dashboard and editor at `/try`, with sample data. Nothing is saved to an account or sent.

## Ways to hurt yourself

1. **Sharing a checkout.** Several agents may work in the same folder at once. Edit only what your task needs, never revert or reformat changes you didn't make, and stop only processes you started yourself.
2. **Reaching the real world.** A dev setup can be connected to a real Supabase project and a real publisher. Never post, schedule, connect a real account or send email to test something: use `/try`, mocks or the tests.
3. **Deploying or touching servers.** Never deploy, ssh into a server or change a live database unless the developer asks for exactly that.
4. **Removing what others still use.** Update the importers first, and delete an export or file last. Then search that nothing still uses it.

## Hit every surface

The most common bug here is a change that works where it was tried and is missing everywhere else. Before calling a change done, go through this list and say which entries applied:

- **Places:** the dashboard, the editor, guest mode (`/try`), the Assistant, and the MCP tools agents use. A thing a person can do is usually one an agent should be able to do too.
- **Networks:** each network has its own limits and rules (lengths, media types, threads). Decide for every network, even if the answer is "not supported there".
- **Languages:** every word people read goes through `t()`, `msg()` or `rich()` (`apps/web/src/lib/i18n.ts`), in 12 languages. Run `node scripts/i18n.mjs` to see what's missing.
- **Themes and screens:** light and dark, wide screens and small ones.
- **The way back:** if you add a way in, add the way out and the way to see it. Archive needs unarchive, pause needs resume.
- **Docs:** check whether `apps/web/src/content/docs` now says something untrue.

## Checking your work

- Run the checks for what you changed, not the whole repo: `npm run check -w @plan.video/web` for types, `npx vitest run <files>` in `apps/web`, and `node --test` in the service you touched.
- Test what can break: sending and scheduling, retries, races, limits, permission checks, saved data, and reading what networks send back. Leave out what the types already guarantee, trivial logic, wording, "it runs" checks, and tests that only check a fake was called.
- Add a case to an existing test before writing a new one, and test once, at the lowest layer that shows the bug.
- A logic, data or sending bug gets a failing test first, then the fix. A purely visual fix gets before/after screenshots instead of a test.
- A test has to be able to fail: break the code it guards and see it go red.
- Never wait on sleeps or timers in a test. Wait for the event or result itself: Node's fake timers (`t.mock.timers`) for code that runs on a timer, a promise the test resolves to hold work in flight. A flaky test gets fixed, not retried.
- A change people can see gets one pass in a real browser before it's called done.

## Comments

Default to no comment. Write one only for a constraint, an outside quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names or signatures, narrate steps, record history, or explain the fix you just made: the commit carries that. Keep the MPL notice at the top of every file that has one, and the comments tools act on (`eslint-disable`, `@ts-expect-error`, `@vite-ignore` and the like).

## Commit messages and pull requests

Every commit uses [Conventional Commits](https://www.conventionalcommits.org): a type, the part of plan.video it touches, and what changes, in plain words.

```text
fix(publisher): retry TikTok uploads that time out
feat(editor): add a blur effect to the Effects tab
perf(web): load the calendar's thumbnails as they scroll into view
docs: explain PUBLIC_URL in Self-hosting
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `chore`.
- **Scopes:** `web` (the dashboard), `editor`, `publisher`, `mcp`, `billing`, `storage`, a network (`tiktok`, `youtube`, `x`, …), `db` (Supabase), `i18n`, `docs`.
- **The subject:** lowercase, no full stop, under about 72 characters, saying what changes for the people using plan.video when it's something they'd notice.
- **The body**, if any: the problem in a sentence or two, then the fix. No back-story, and nothing private: this repository is public.
- Changes to sending, scheduling, database migrations, sign-in, permissions or billing land through a pull request, so the checks and review run first. Commit those on a branch and offer the pull request; everything else can go straight to `main`.
- Never open a pull request unless the developer asks. Pull requests are squash-merged, so the title follows the same format. Changes people can see need before/after images; motion needs a short video.

## Keep out of the repository

- Plans, research notes, audits and scratch files. Keep working material outside the checkout.
- Keys, tokens and passwords. Secrets live in env files that git ignores. Anything with the `VITE_` prefix ends up in the browser.
- plan.video's own website. If `apps/web/site/` exists, it's a separate private repository: the app never imports it (it reaches it only through `apps/web/src/lib/site.ts`), and its changes are committed inside that folder.
