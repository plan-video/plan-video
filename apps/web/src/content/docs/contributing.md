Fixes, features, translations and docs are all welcome.

## Before you start

- **Found a bug?** [Open an issue](https://github.com/plan-video/plan-video/issues) with what you did, what you expected, what happened instead, and your browser.
- **Want to build something bigger than a fix?** Open an issue first, so we can agree on the approach before you spend time on it.
- **Have a question?** Ask in the [Discord community](https://discord.gg/4C3g9FZsyr).

## Make a change

<Steps>
  <Step title="Fork and branch">
    Fork the repository on GitHub and make a branch for your change.
  </Step>
  <Step title="Run it">
    Set up the dev server as in [Local development](/docs/local-development). `/try` gives you the dashboard and editor with sample data.
  </Step>
  <Step title="Check it">
    Type-check the website, and run the tests of whatever you changed:
    ```bash
    npm run check -w @plan.video/web
    cd services/publisher && npm test
    ```
  </Step>
  <Step title="Open a pull request">
    Open it against `main`. Say what changes for the people using plan.video and why, and add a screenshot or a short video for anything you can see.
  </Step>
</Steps>

## How the code is written

Match the code around your change. A few things hold everywhere:

- **Comments say why.** They're plain sentences above the code they explain, written for someone reading it for the first time.
- **Every word people read is translated.** Wrap it in `t()`, as in [Translations](/docs/translations), and run `node scripts/i18n.mjs unwrapped <path>` to catch any you missed.
- **Secrets stay on the server.** Anything with the `VITE_` prefix ends up in the browser. Network tokens never go to a browser: the publisher keeps them.
- **Test what you change.** The services use Node's own test runner, with `*.test.mjs` files beside the code. The packages use Vitest.
- **Keep the license notice.** Leave the notice at the top of every file you change.

## Security issues

Please don't open a public issue for a security problem. Email [hello@plan.video](mailto:hello@plan.video) instead, and we'll reply as soon as we can.

## License

plan.video is under AGPL-3.0, and the files from the editor it started from are under MPL-2.0. See [License](/docs/license).
