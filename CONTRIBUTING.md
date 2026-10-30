# Contributing to plan.video

Fixes, features, translations and docs are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Found a bug?** [Open an issue](https://github.com/plan-video/plan-video/issues/new/choose) with what you did, what you expected, what happened instead, and your browser.
- **Want to build something bigger than a fix?** Open an issue first, so we can agree on the approach before you spend time on it.
- **Have a question?** Ask in the [Discord community](https://discord.gg/4C3g9FZsyr).
- **Found a security problem?** Don't open an issue. Follow [SECURITY.md](SECURITY.md) instead.

## Make a change

1. **Fork and branch.** Fork the repository on GitHub and make a branch for your change.
2. **Run it.** Set up the dev server as in [Local development](apps/web/src/content/docs/local-development.md). `/try` gives you the dashboard and editor with sample data.
3. **Check it.** Type-check the website, and run the tests of whatever you changed:
   ```bash
   npm run check -w @plan.video/web
   cd services/publisher && npm test
   ```
4. **Open a pull request** against `main`. Say what changes for the people using plan.video and why, and add a screenshot or a short video for anything you can see.

## How the code is written

Match the code around your change. A few things hold everywhere:

- **Comments say why.** They're plain sentences above the code they explain, written for someone reading it for the first time.
- **Every word people read is translated.** Wrap it in `t()`, as in [Translations](apps/web/src/content/docs/translations.md), and run `node scripts/i18n.mjs unwrapped <path>` to catch any you missed.
- **Secrets stay on the server.** Anything with the `VITE_` prefix ends up in the browser. Network tokens never go to a browser: the publisher keeps them.
- **Test what you change.** The services use Node's own test runner, with `*.test.mjs` files beside the code. The packages use Vitest.
- **Keep the license notice.** Leave the notice at the top of every file you change.

## License and the contributor agreement

plan.video is under [AGPL-3.0](LICENSE), and the files that carry the MPL notice are under [MPL-2.0](LICENSES/MPL-2.0.txt) (see [NOTICE](NOTICE)). Your contribution is released under the license of the files it changes: MPL-2.0 for changes to a file with the MPL notice, AGPL-3.0 for everything else.

Before your first pull request is merged, you sign the [Contributor License Agreement](CLA.md): the CLA check on the pull request asks you to, once. You keep the copyright in what you write. The agreement lets plan.video use your contribution in the hosted service at plan.video as well as in the open code.

The plan.video name and logos aren't covered by these licenses: see [Trademarks](NOTICE).
