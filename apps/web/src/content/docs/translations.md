The website, the dashboard and the editor are in 12 languages: English, Spanish, French, German, Italian, Brazilian Portuguese, Dutch, Polish, Turkish, Japanese, Korean and Simplified Chinese. People pick one in the site's footer or in **Preferences**. Otherwise plan.video uses the browser's language when it has it.

## How it works

The English text is the key. Each language has one JSON file in `apps/web/src/locales`, such as `fr.json` or `pt-BR.json`, that maps English to its translation. English has no file.

```json fr.json
{
  "Schedule post": "Programmer la publication",
  "{count, plural, one {# post} other {# posts}}": "{count, plural, one {# publication} other {# publications}}"
}
```

A string nobody has translated yet shows in English, so new copy never breaks a page. It only waits for its translations.

## Showing words in code

Every string people read goes through `t()`, `msg()` or `rich()` from `lib/i18n.ts`.

```tsx
import { msg, rich, t } from "@/lib/i18n";

<p>{t("Saved")}</p>
<p>{t("Delete {name}?", { name })}</p>
<p>{t("{count, plural, one {# post} other {# posts}}", { count })}</p>

// A constant keeps the English with msg(), and shows it with t().
const TABS = [{ id: "week", label: msg("Week") }];

// A sentence with a link in it stays one string.
rich("Read the <guide>guide</guide> first.", { guide: (text) => <A href="/docs">{text}</A> });
```

<Warning>
Call `t()` where the words are drawn: in JSX, in an accessor or in a memo. A Solid component's body runs once, so `const label = t("Save")` at the top of a component stays in the language the page opened in.
</Warning>

Values always go in `{placeholders}`, never glued onto the text, and counts use ICU plurals, because other languages have more plural forms than English.

## The translation tool

`scripts/i18n.mjs` finds every string the app shows and checks each language against it. Run it from the repository's root.

```bash
# How far along each language is. Fails on a broken translation.
node scripts/i18n.mjs

# French strings that aren't translated yet, as JSON: [{ id, text, where }]
node scripts/i18n.mjs missing fr

# Merge translations, keyed by id or by the English, into fr.json
node scripts/i18n.mjs merge fr fr-new.json

# Drop strings the app no longer uses
node scripts/i18n.mjs sync

# English that's shown on screen but not wrapped yet
node scripts/i18n.mjs unwrapped components/dashboard
```

`merge` turns down a translation whose placeholders, plural branches or tags don't match the English. Like `sync`, it also drops every string the app doesn't use at that moment, so merge once your copy is settled.

## Adding or fixing a translation

<Steps>
  <Step title="Find what's missing">
    Run `node scripts/i18n.mjs missing <code>` for your language.
  </Step>
  <Step title="Translate">
    Write `{ "<id>": "<translation>" }` for each string in a JSON file. Keep the language's register and its word for each product term. The table in `apps/web/src/locales/README.md` lists them, such as *vous* and *Brouillon* for French.
  </Step>
  <Step title="Merge and check">
    Run `node scripts/i18n.mjs merge <code> <file>`, then `node scripts/i18n.mjs` to check every language still passes.
  </Step>
</Steps>

When you add or change copy in a pull request, translate the new strings into every language in the same change if you can.

## What stays in English

- Brand, network and plan names: plan.video, TikTok, YouTube, Creator, Pro, Agency.
- The legal pages and these docs.
- Anything an AI agent or a server reads: MCP tool descriptions, prompts and post captions.
- Code, commands, URLs and file formats.

<Note>
Want plan.video in a language it doesn't have yet? [Open an issue](https://github.com/plan-video/plan-video/issues) first, so we can agree on its terms before you start.
</Note>
