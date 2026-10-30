# Working on plan.video

## Commit messages

This repository is public. Every commit uses [Conventional Commits](https://www.conventionalcommits.org): a type, the part of plan.video it touches, and what changes, in plain words.

```text
fix(publisher): retry TikTok uploads that time out
feat(editor): add a blur effect to the Effects tab
perf(web): load the calendar's thumbnails as they scroll into view
docs: explain PUBLIC_URL in Self-hosting
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `chore`.
- **Scopes:** `web` (the dashboard), `editor`, `publisher`, `mcp`, `billing`, `storage`, a network (`tiktok`, `youtube`, `x`, …), `db` (Supabase), `i18n`, `docs`.
- **The subject:** lowercase, no full stop, under about 72 characters, saying what changes for the people using plan.video when it's something they'd notice.
- **The body**, if any: a few short lines on why. No back-story, and nothing private: no audits, servers, keys, business plans or notes from the session.

Pull requests are squash-merged, so a pull request's title follows the same format.
