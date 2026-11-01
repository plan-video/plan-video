# Translations

The website, the dashboard and the editor are drawn in the language picked in
the site's footer or in the dashboard's Preferences, else the browser's own
language when we have it. `lib/i18n.ts` does the work; this folder holds each
language's words, one JSON file per language (`fr.json`, `pt-BR.json`…).
English has no file: **the English text is the key.**

```json
{
  "Schedule post": "Programmer la publication",
  "{count, plural, one {# post} other {# posts}}": "{count, plural, one {# publication} other {# publications}}"
}
```

A string nobody has translated yet shows in English, so new copy never breaks
anything; it just waits for its translations.

## Checking and adding translations

```sh
node scripts/i18n.mjs                 # how far along each language is; fails on a broken translation
node scripts/i18n.mjs missing fr      # fr's untranslated strings: [{ id, text, where }]
node scripts/i18n.mjs merge fr a.json # merges { "<id>": "translation" } into fr.json, checking each
node scripts/i18n.mjs sync            # drops strings the app no longer uses
node scripts/i18n.mjs unwrapped components/dashboard   # English that's shown but not wrapped yet
```

`merge` refuses a translation whose `{placeholders}`, plural branches or
`<tags>` don't match the English.

When you change or add copy, translate the new strings into every language
(`missing` → translate → `merge`) in the same change if you can.

The home page's headline and its two buttons are also written into the built
HTML in every language (prerender-pages.ts reads them from these files), so a
visitor in another language sees their headline at the first paint too.

## Language notes

Each language keeps one register and one word per product term. Match them
when translating new strings:

| | register | post | Schedule | draft | queue (shown as Auto-schedule) | Plugs | Vault | workspace | subtitles | Templates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| es | tú | Publicación | Programación | Borrador | Programación automática | Promos | Bóveda | Espacio de trabajo | Subtítulos | Plantillas |
| fr | vous | Publication | Planning | Brouillon | Planning automatique | Relances | Coffre | Espace de travail | Sous-titres | Modèles |
| de | du | Post | Planung | Entwurf | Auto-Planung | Plugs | Tresor | Workspace | Untertitel | Vorlagen |
| it | tu | Post | Programmazione | Bozza | Programmazione automatica | Automazioni | Archivio | Spazio di lavoro | Sottotitoli | Modelli |
| pt-BR | você | Post | Agenda | Rascunho | Agenda automática | Divulgações | Cofre | Espaço de trabalho | Legendas | Modelos |
| nl | je | Post | Planning | Concept | Auto-planning | Plugs | Kluis | Werkruimte | Ondertiteling | Sjablonen |
| pl | ty | Post | Harmonogram | Szkic | Automatyczny harmonogram | Dopiski | Skarbiec | Przestrzeń robocza | Napisy | Szablony |
| tr | sen | Gönderi | Planlama | Taslak | Otomatik planlama | Tanıtımlar | Kasa | Çalışma alanı | Altyazılar | Şablonlar |
| ja | です/ます | 投稿 | 予約投稿 | 下書き | 自動予約 | 宣伝 | 保管庫 | ワークスペース | 字幕 | テンプレート |
| ko | 해요체 | 게시물 | 일정 | 초안 | 자동 일정 | 홍보 댓글 | 보관함 | 워크스페이스 | 자막 | 템플릿 |
| zh-CN | 你 | 帖子 | 排期 | 草稿 | 自动排期 | 引流 | 文案库 | 工作区 | 字幕 | 模板 |

- "Caption" in the scheduler is the post's text. In the editor it means the
  subtitles drawn on the video (the context "video subtitles").
- Plan names (Creator, Pro, Agency), brands and network names stay as written.
- The Assistant (the dashboard's chat that schedules posts) is a name, capitalised where the
  language allows: Assistent (de, nl), Asistente (es), Assistant (fr), Assistente (it, pt-BR),
  Asystent (pl), Asistan (tr), アシスタント, 어시스턴트, 助手. Outside agents (Claude, ChatGPT)
  connected at plan.video/mcp stay "agents".
- Weekday and month names are lowercase in es, fr, it, pt-BR, nl and pl.
- "Schedule post" is a small button: keep it short ("Programmer", "Planen").
- For any other term, look up how the language's file already says it.

## Writing code that shows words

```tsx
import { intlLocale, localized, msg, rich, t } from "@/lib/i18n";
```

1. **Wrap every string people read** — JSX text, `title`, `aria-label`,
   `placeholder`, `alt`, props that end up on screen (`label`, `description`,
   `title`, `hint`…), toasts, `confirm()`, error messages shown to people,
   `document.title`.

   ```tsx
   <p>Saved</p>                         →  <p>{t("Saved")}</p>
   <button title="Close">               →  <button title={t("Close")}>
   toast.error("Couldn't save")         →  toast.error(t("Couldn't save"))
   ```

2. **Call `t()` where the words are drawn, not before.** A Solid component's
   body runs once, so a `const label = t("Save")` there stays in the language
   the page opened in. Call `t()` inside JSX, in an accessor
   (`const label = () => t("Save")`) or in a memo. Event handlers, toasts and
   other one-off moments can call it directly.

3. **Constants keep the English with `msg()`** and show it with `t()`:

   ```tsx
   const TABS = [{ id: "week", label: msg("Week") }];
   <For each={TABS}>{(tab) => <button>{t(tab.label)}</button>}</For>
   ```

   `msg()` returns the English unchanged, so code that compares labels keeps
   working. Never call `t()` at the top level of a module.

4. **Values go in placeholders**, never glued on or in a template string:

   ```tsx
   `Delete ${name}?`                     →  t("Delete {name}?", { name })
   "Back to " + label                    →  t("Back to {label}", { label })
   ```

   Name placeholders for what they hold (`{name}`, `{count}`, `{date}`), so a
   translator can tell what goes there.

5. **Counts use ICU plurals.** Languages have more forms than English, so let
   the translation choose:

   ```tsx
   `${n} ${n === 1 ? "post" : "posts"}`  →  t("{count, plural, one {# post} other {# posts}}", { count: n })
   ```

   `=0 {No posts}` is there for English's own zero text. `#` is the number as
   given; format it first (and pass it as another placeholder) when it needs
   thousands separators. Ordinals: `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}`.

6. **A sentence with a link or bold inside stays one string**, with `rich()`:

   ```tsx
   <p>Read the <A href="/docs">guide</A> first.</p>
   →  <p>{rich("Read the <guide>guide</guide> first.", { guide: (text) => <A href="/docs">{text}</A> })}</p>
   ```

   Values can be elements too: `rich("Press {key} to search", { key: <Kbd>K</Kbd> })`.

7. **Same English, two meanings** (the verb and the noun "Post"): give a context.
   `t({ message: "Post", context: "verb" })`, `msg({ message: "Post", context: "noun" })`.
   Only where a translator would need two different words.

8. **Dates and numbers follow the language.** Keep the locale the code used for
   English as the argument, so English reads exactly as before:

   ```tsx
   const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" })        // at module level
   →  const DAY = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "long" }), "en-GB")
      DAY().format(date)
   date.toLocaleDateString(undefined, { month: "short" })
   →  date.toLocaleDateString(intlLocale(), { month: "short" })
   count.toLocaleString("en-US")  →  count.toLocaleString(intlLocale("en-US"))
   ```

   `zonedFormat(options, english?)` in lib/time-zone.ts already follows the language.

9. **Don't translate:** brand and product names (plan.video, TikTok, YouTube,
   Instagram, X, LinkedIn, Bluesky, Threads, Facebook, Pinterest, Discord,
   Claude, Codex, Cursor, MCP…), keyboard keys, file formats, code, commands,
   URLs, email addresses, class names, ids, storage keys, analytics event
   names, console messages, errors thrown for developers, game assets
   (killfeed weapons and agents), the legal pages' text, and anything an AI
   agent or a server reads: MCP tool descriptions and results, prompts,
   `dapi/` handlers, post captions and API payloads.

10. **English stays exactly as it was.** The string in `t()` is the text that
    was shown, character for character (curly quotes, `…`, non-breaking
    spaces). JSX text collapses whitespace: write the string as it rendered,
    and keep the spaces between it and the elements around it.

11. **Don't make variants by changing case** (`t(x).toLowerCase()`): German
    capitalises nouns, other languages have no case. Write the variant as its
    own string. CSS `uppercase` is fine.

12. **Sample content is translated** — the posts, captions and notes in the
    homepage's product pictures and the guest demo — but not the names of
    people, accounts and brands in it.
