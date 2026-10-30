# Posts in their own table

Status: built on 2026-10-26, on the `posts-table` branch, not yet applied to the live database. Where the build differs from this proposal, the section "As built" at the end says how and why.

## Why

Every post lives inside one JSON record per person, `account_state.payload.slices[workspace].events`. That record:

- **is moved whole on every sync.** Each save upserts the whole account, Realtime sends the whole row to every open tab, every tab focus downloads it again, and each tab keeps a full copy in sessionStorage as its merge baseline (about 5 MB, then it silently stops having one).
- **only grows.** Sent posts are never pruned, and every post with media carries its thumbnail as a JPEG data URL inline. In the live data, thumbnails average 4.7 KB, about half of a post's bytes.
- **makes the publisher read everything.** Each planning pass unpacks every scheduled post of every person (`publisher_posts_after`), and the Free plan's waiting-posts check walks them all again.
- **puts all of an account's writes behind one revision.** A team member's save conflicts with the owner editing any other workspace.

With nobody's data at stake yet, now is the time to fix the shape rather than patch around it.

## What moves, and what stays

| Data | Today | After |
|---|---|---|
| Posts (`events`) | `account_state` slices | `posts`, one row per post |
| A post's thumbnail | inside the post | `post_thumbnails`, one row per post, loaded when shown |
| A post's file details (`media` entries for its files) | `account_state` slices, a list beside the posts | inside the post row (`data.media`) |
| A post's delivery state (`deliveries`) | copied into the post by every open browser | not stored on the post; read from `post_deliveries`, which the publisher already writes |
| "Posted" status of a one-off post | set by a browser when it sees every network sent | set by the publisher in the same step as the last send |
| Workspaces list, connections, calendars, library, vault, templates, groups, queue, boards, plugs, caption styles, signature, notifications, time zone | `account_state` | unchanged, in `account_state`; small, and not growing with every post |

## Tables

### `posts`

```sql
create table public.posts (
  owner_id     uuid not null references auth.users (id) on delete cascade,
  id           text not null check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  data         jsonb,                 -- the post as the calendar stores it, without thumbnail and deliveries; null once deleted
  version      bigint not null default 1,
  updated_at   timestamptz not null default clock_timestamp(),
  deleted_at   timestamptz,           -- a deletion, kept so other devices learn of it
  -- written only by the publisher (service role):
  status       text generated always as (data ->> 'status') stored,
  next_run_at  timestamptz,           -- the next run the publisher has to plan, or null
  posted_at    timestamptz,
  file_ids     text[] generated always as (public.post_file_ids(data)) stored,
  primary key (owner_id, id)
);
```

- **The key is `(owner_id, id)`, not the workspace.** One id is one post in one workspace, structurally. Today this is enforced by a deny-list in `save_team_workspace`. A member can't take over another workspace's post by reusing its id, because the row with that id belongs to the other workspace and the write is refused. The live data has no id used twice.
- **`workspace_id` never changes.** No feature moves a post between workspaces (copying makes a new id). A trigger refuses a change.
- **`version`** is raised by a trigger on every write. Browsers write with "update … where version = the one I read", so a lost update is impossible and conflicts are per post, not per account.
- **`updated_at`** comes from `clock_timestamp()` in the same trigger, and feeds the change feed below.
- **`data` size** is capped at 256 KB per post. A post today is at most a few tens of KB: long captions, a YouTube description, a 10-step thread.
- **Indexes:**
  - `(owner_id, workspace_id, updated_at)`, for the browser's change feed;
  - `(updated_at)`, for the publisher's change feed;
  - `next_run_at where next_run_at is not null`, for planning;
  - a GIN index on `file_ids`, for the file-ownership check.

### `post_thumbnails`

`(owner_id, post_id) → thumbnail text`, references `posts` with `on delete cascade`, same access rules as its post. Kept apart so the post row stays small in every sync, Realtime message and publisher read. Loaded only for posts on screen.

### Deletions

A delete sets `deleted_at`, clears `data`, and deletes the thumbnail. The row stays as a marker so devices that were away learn that the post is gone. Markers older than 90 days are removed by the publisher's daily housekeeping.

A device away longer than that still can't bring a post back by mistake: it only re-sends a post it changed itself since it last agreed with the account. That's today's rule, kept.

## Who can do what (row-level security)

- **Owner:** reads and writes their own rows: `owner_id = auth.uid()`.
- **Team admins and members:** read and write rows of workspaces they have a role in: `workspace_role(owner_id, workspace_id) in ('admin', 'member')`. This uses the same function as everything else today, so a paused plan, a removed member or a deleted workspace cut access the same way. Members never get the owner's other workspaces' posts, not even their ids.
- **A post's files must be its workspace's own.** A trigger refuses a write whose `file_ids` (files, `ownFiles`, thread files, `data.media` ids) overlap another workspace's posts or the library or media of another workspace. This matches today's `team_clean_event`, but refuses instead of quietly stripping, so the browser gets a clear error rather than a post that saved differently from what's on screen. It runs for owners too, since an owner's browser is no more trustworthy than a member's.
- **Columns the browser can't touch:** `next_run_at`, `posted_at`, `version`, `updated_at`, `owner_id`. Column grants plus the trigger enforce this. A post's status stays in `data` and the browser can still set it, including "Mark as posted" by hand. The publisher also sets `posted` itself (below), so it no longer depends on a browser being open.
- **Connector tokens (outside AI agents)** get nothing, as on every other table. The "Only plan.video's own sign-in" restrictive policy is added explicitly, because Realtime doesn't go through `refuse_app_tokens`.
- **The storage signer's check** (`team_files_allowed`) reads `posts.file_ids` instead of unpacking JSON.

## How a browser syncs posts

The calendar keeps its posts in IndexedDB as today. Only the way they reach the account changes. One code path serves owners and team members alike, replacing the posts part of both `account-sync.ts` and `team-sync.ts`.

- **Loading:**
  - The first time, a device reads all non-deleted posts of the workspace.
  - After that it asks only for rows changed since its cursor: `updated_at > cursor − 2 minutes`, deduplicated by `version`.
  - The 2-minute overlap covers a write that got its timestamp before an earlier one committed.
  - The cursor and each post's last agreed version (its baseline) are kept in IndexedDB, not sessionStorage, so they survive reloads and have no 5 MB limit.
- **Live updates:** Realtime on `posts`, filtered to the workspace and checked against the access rules by Supabase. The message is the one post that changed, a few KB. Other tabs apply it if its version is newer than theirs.
- **Saving:**
  - An edit saves only that post: `update … set data = $1 where owner_id = $o and id = $id and version = $base`.
  - A new post is an insert. A deletion is an update that sets `deleted_at`.
  - Edits are batched for 400 ms as today, then saved one post at a time, up to a few in parallel.
- **Conflicts:** if the version moved on, the browser reads the post and applies today's rule, per post instead of per account:
  - only this side changed → write over the new version;
  - only the other side changed → take theirs;
  - both changed → this side wins, written over the new version;
  - deleted on one side and edited on the other → the edit wins.
- **Offline and failures:** unsaved posts are marked as today ("Not synced"), retried after 5 s, 15 s, 1 min and 5 min, and saved again on focus and when the connection comes back. "Post now" still refuses to send a post that hasn't reached the account.
- **Every signed-in tab syncs**, not just the dashboard. Today an agent's post in a tab that never opened the dashboard is never saved, and a "publish" from such a tab asks the publisher to send a post the account doesn't have. That gap closes.
- **Thumbnails** are saved and loaded on their own, after the post, and only for posts the calendar shows.

The rest of the account (workspaces list, connections and the other lists in the table above) keeps syncing through `account_state` as today. It is small and changes rarely.

## The publisher

- **Change feed instead of reading everything.** Every few seconds the publisher reads posts changed since its cursor (`updated_at > cursor − 2 min`, the same overlap trick). For each post it changed, it:
  - works out `next_run_at` with `schedule.mjs`. The recurrence and time-zone rules stay in one place, shared with the calendar's own; they aren't rewritten in SQL;
  - updates `publisher_waiting` for that post (the Free plan's 10 waiting posts). That table is kept up to date incrementally instead of rebuilt from every post each pass.
- **Planning** reads only `next_run_at <= now() + 2 min` through the index: one small query, however many posts exist. After planning a run, it sets the post's following `next_run_at`, or null when the series ends. The 30-second pass, the wake at a run's moment, the 5-second dispatch and the parallel lanes from today's change all stay.
- **A safety sweep** reads every scheduled post once an hour, in pages, and fixes any `next_run_at` that's wrong. It runs in the background and never holds up sending.
- **Missed runs** (publisher down for over a day) are still found: their `next_run_at` is in the past, so the same `LATE` rule applies. The per-person "how far back I've looked" memory goes away.
- **"Posted"** is set by the publisher when the last network of a one-off post goes out (`status = 'posted'`, `posted_at`, a new version so devices pick it up). Posts no longer stay "scheduled" forever when nobody opens the dashboard.
- **Delivery state** stays in `post_deliveries` only. The calendar reads it from there, as it already does to show results. It no longer writes a copy into each post. That removes every browser's writes on each delivery change. It also removes the YouTube daily check's rewriting of `account_state` to clear video ids, since there's no copy to clear.
- **`publisher_post` and Post now** read one row by key. Connections and plugs still come from `account_state`, joined in SQL as today.

## Other parts that change

- **Team sync (`save_team_workspace`, `team_workspace`, `team_foreign_ids*`, `team_clean_event`):** no longer carry posts. Members' post access is the access rules above. The functions keep the slice's other lists. The foreign-id checks read `posts.file_ids` for posts and the slices for library and media.
- **`workspace_versions` change notices:** members learn of post changes from Realtime on `posts`. The notices remain for the slice's other lists.
- **Deleting a workspace:** deletes its posts and thumbnails; the existing cleanup of logins, files and previews stays.
- **Deleting an account:** posts go with the user, by the foreign key.
- **Previews (`/p/:id`):** unchanged. They're snapshots in their own table.
- **Guest mode (`/try`):** unchanged. It never syncs.
- **`account_state` size limit:** with posts gone, a `check (pg_column_size(payload) <= 2 MB)` closes the audit's M10.

## Moving the data over

There are 3 test accounts and 26 posts, so this is a cutover, not a long dual-running migration:

1. Apply the SQL (new tables, rules, functions), alongside today's.
2. A one-time SQL step copies every slice's events into `posts`, and thumbnails into `post_thumbnails`. It checks that the counts match and no id is used twice.
3. Deploy the publisher and the website together. Both read and write only the new tables.
4. A second SQL step removes `events` and per-post `media` from every `account_state` slice, and adds the size limit. This runs only after step 3 is confirmed working; until then the old copy stays as a fallback.

Rollback before step 4 means redeploying the previous publisher and site. The old copy is untouched.

## Testing

Tests are written alongside the code, not after:

- **Database:** a local Supabase (`supabase start` in Docker) running every migration. Tests cover:
  - every access rule, as owner, admin, member, outsider, a member on a paused plan, and a connector token;
  - the file-ownership refusal;
  - the column protections;
  - versioned writes and conflicts;
  - deletion markers;
  - Realtime delivering a post change to a member but not to an outsider;
  - the data migration on copies of today's real records.
- **Publisher:** the existing 426 tests, adapted. New tests for the change feed (including a write that commits late inside the overlap), `next_run_at` across every recurrence kind and daylight-saving change, the hourly sweep repairing a wrong value, posted status, and the incremental waiting-posts count.
- **Browser sync:** the sync logic as plain functions under vitest. Tests cover:
  - two tabs editing the same post and different posts;
  - offline then back;
  - a delete against an edit;
  - a device away past the marker window;
  - a member and the owner editing at once;
  - a write refused by the rules.
  The mutation testing used for the publisher is repeated here.
- **End to end:** the real site against the local Supabase and a local publisher in Playwright. Make a post, edit it in two tabs, schedule it, watch the publisher plan and send it to a fake network, see it marked posted in both tabs.

## Order of work

1. SQL: tables, rules, triggers, functions, data migration, with their tests.
2. Publisher: change feed, `next_run_at`, planning by index, posted status, incremental waiting count, sweep.
3. Browser: the per-post sync for owners and members, thumbnails, deliveries read from `post_deliveries`, sync in every signed-in tab.
4. Team functions slimmed down; workspace and account deletion.
5. End-to-end run, then the cutover above, then the clean-up step.

Each step lands as its own commits with its tests passing.

## As built

What changed from the proposal while building it:

- **The publisher's own columns are a table of their own, `post_schedule`,** rather than `next_run_at` and `posted_at` columns on `posts`.
  - The publisher can then write when it next looks at a post without a Realtime message to every open tab, and without column rules for what the browser may set.
  - A trigger makes a post due a look at once whenever it's made, changed or deleted. The publisher reads `post_schedule` through the `next_run_at` index, and keeps its next look only over the version it read (`publisher_schedule`), so an edit made meanwhile keeps it due.
  - `posted_at` was dropped: `post_deliveries` already says when each network had it.
- **The publisher needs no change feed of its own.** A post due a look is either changed or has a run that came, and both are in `post_schedule`.
  - `planned_through` replaces the per-person "how far back I've looked" memory for runs missed while the publisher was down.
  - An hourly look over every scheduled post counts the Free plan's waiting posts afresh and repairs any next look that would come after its run.
- **The Free plan's waiting posts are counted a post at a time.** `publisher_waiting` keeps `until`, when each post stops waiting, so posts nobody changed still count. An owner who pays after being over the limit has their posts looked at again (`publisher_look_again`), so the held runs go out, as they did before.
- **A draft sent with Post now is marked posted too,** like a scheduled one-off post.
- **A file of another workspace is refused, not stripped,** for owners as well as members. The browser shows the post as not synced, with the server's reason, and doesn't send it again until it changes.
- **A thumbnail change raises the post's `updated_at` (through `thumbnail_at`) but not its version,** so devices read the new picture without treating the post as edited.
- **What a browser last agreed with the server is kept in the calendar's own database** (version 3, `syncBases` and `syncState`), not in a database of its own. A database cleared or made again then loses both together, and simply reads everything again; no rule has to guess whether missing posts were deleted.
- **A tab recognises its own writes coming back over Realtime by their `updated_at`,** not their version, so a thumbnail saved on another device over the same version is still read.
- **The first run after the move uses what the old sync last agreed on:** the account copy's fingerprints for the person's own workspaces, and team-sync's last copy for shared ones. Posts unchanged here since then take the server's; changed ones are sent.
- **Every signed-in tab syncs once it answers an AI agent** (`lib/sync-start.ts`), not every page; the dashboard starts it as before.
- **The web app got a test runner** (vitest, `npm test` in `apps/web`) for the sync rules, and `apps/web/e2e` holds end-to-end checks against a local Supabase.

## Rolling it out

The order matters, because the live site and publisher keep running throughout:

1. **Back up `account_state`** (every row), off the server, before anything else.
2. **Apply `20261026090000_posts.sql`, then `20261026090100_posts_copy.sql`, straight after it**, in the SQL editor.
   - The running publisher keeps working: its functions now read the posts table, and the copy fills it.
   - From this moment until the next step, the old site still saves edits only into `account_state`, and those won't reach the posts table. Keep this gap to minutes, and make no edits in it.
3. **Deploy the publisher and the website together.**
   - Reload or close every open plan.video tab. The first tab on the new site moves this browser's posts database to version 3. The old site's code can't open version 3, so a tab still running it can't change posts here (see below).
4. **Check it** on the live site:
   - a post made, edited and deleted shows up in `posts`;
   - a second browser gets the change live;
   - the publisher's health is green;
   - a scheduled test post goes out and is marked posted.
5. **Apply `20261026090200_posts_cleanup.sql`.** It removes posts from `account_state` and caps its size. Until this step, the old copy is the way back: redeploy the previous publisher and site, and the posts table is simply left unused.

**Why a tab left on the old site can't delete posts.** The old site syncs posts through `account_state`. Once the new site saves the account without them, an old tab would read every post as deleted on the server and remove them from this browser's database. The new tab's sync would then send those deletions to the posts table. This can't happen, because the new site opens the posts database at version 3 before its first save. That makes the old tab close its copy, and the old code can't open version 3 again (it asks for 2 and gets a version error), so its reads and writes fail instead. Another browser still on the old site only empties its own copy, and the new site reads that browser's posts back from the server once it's loaded there. A deleted post on the server is a marker for 90 days and can be brought back by clearing `deleted_at`.

