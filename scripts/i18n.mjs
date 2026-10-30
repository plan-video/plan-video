#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//   node scripts/i18n.mjs                 how far along each language is; fails on a broken translation
//   node scripts/i18n.mjs sync            drops words the app no longer uses, in the order the app has them
//   node scripts/i18n.mjs missing fr      fr's untranslated strings, as JSON: [{ id, text, where }]
//   node scripts/i18n.mjs merge fr a.json merges { id or English: translation } into fr, after checking each
//   node scripts/i18n.mjs unwrapped [path…]  English that looks shown to people but isn't wrapped yet (paths from apps/web/src)

import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps/web");
const SRC = join(WEB, "src");
const LOCALES = join(SRC, "locales");
const SITE_SRC = join(WEB, "site/src");
const SITE_LOCALES = join(WEB, "site/locales");
const HAS_SITE = existsSync(SITE_SRC);
const I18N = join(SRC, "lib/i18n.ts");
const CONTEXT = "\u0004";

function sourceFiles(dir, out = []) {
  // The app's files first, in order, then the site's: the order the words are kept in.
  if (!dir) return (HAS_SITE ? [SRC, SITE_SRC] : [SRC]).flatMap((root) => sourceFiles(root, []).sort());
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "locales") continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const isSiteFile = (rel) => rel.startsWith("../site/");

const parse = (file) =>
  ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function i18nNames(source) {
  const names = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    const resolved = from.startsWith("@/") ? join(SRC, from.slice(2)) : from.startsWith(".") ? resolve(dirname(source.fileName), from) : "";
    if (resolved.replace(/\.ts$/, "") !== I18N.replace(/\.ts$/, "")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === "t" || imported === "msg" || imported === "rich") names.set(element.name.text, imported);
    }
  }
  return names;
}

const isFunction = (node) =>
  ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);

function keysOf(node, problems, where) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node)) return keysOf(node.expression, problems, where);
  if (ts.isConditionalExpression(node)) return [...keysOf(node.whenTrue, problems, where), ...keysOf(node.whenFalse, problems, where)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))
    return [...keysOf(node.left, problems, where), ...keysOf(node.right, problems, where)];
  if (ts.isTemplateExpression(node)) {
    problems.push(`${where}: a template with \${…} in it can't be translated; write {placeholders} and pass values`);
    return [];
  }
  if (ts.isObjectLiteralExpression(node)) {
    const field = (name) => {
      const property = node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === name);
      return property && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)) ? property.initializer.text : undefined;
    };
    const message = field("message");
    const context = field("context");
    if (message !== undefined && context !== undefined) return [`${context}${CONTEXT}${message}`];
  }
  return []; // A variable: its words were marked where they were written.
}

function extract() {
  const keys = new Map();
  const problems = [];
  const warnings = [];
  for (const file of sourceFiles()) {
    if (file === I18N) continue;
    const source = parse(file);
    const names = i18nNames(source);
    if (!names.size) continue;
    const rel = relative(SRC, file);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text) && node.arguments.length) {
        const kind = names.get(node.expression.text);
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        const where = `${rel}:${line + 1}`;
        for (const key of keysOf(node.arguments[0], problems, where)) {
          if (!key.trim()) continue;
          if (!keys.has(key)) keys.set(key, { files: new Set(), where });
          keys.get(key).files.add(rel);
        }
        if (kind !== "msg") {
          let parent = node.parent;
          while (parent && !isFunction(parent)) parent = parent.parent;
          if (!parent) warnings.push(`${where}: ${kind}() outside a function runs once, in the language the page opened in; keep the English with msg() and call t() where it's shown`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { keys, problems, warnings };
}

function shape(message) {
  const args = new Set();
  const tags = [];
  const read = (text, depth) => {
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === "{") {
        let level = 0;
        let end = -1;
        for (let at = index; at < text.length; at++) {
          if (text[at] === "{") level++;
          else if (text[at] === "}" && --level === 0) {
            end = at;
            break;
          }
        }
        if (end === -1) throw new Error("a { is never closed");
        const inner = text.slice(index + 1, end);
        const [name, type, ...rest] = inner.split(",");
        if (/^\s*\w+\s*$/.test(name)) {
          args.add(name.trim());
          if (type !== undefined) {
            const kind = type.trim();
            if (!["plural", "select", "selectordinal"].includes(kind)) throw new Error(`unknown {${name.trim()}, ${kind}}`);
            const body = rest.join(",");
            let at = 0;
            const seen = [];
            for (;;) {
              while (/\s/.test(body[at] ?? "")) at++;
              if (at >= body.length) break;
              const start = at;
              while (at < body.length && !/[\s{]/.test(body[at])) at++;
              const key = body.slice(start, at);
              while (/\s/.test(body[at] ?? "")) at++;
              if (!key || body[at] !== "{") throw new Error(`{${name.trim()}, ${kind}} has a branch without braces`);
              let branchLevel = 0;
              let close = -1;
              for (let pos = at; pos < body.length; pos++) {
                if (body[pos] === "{") branchLevel++;
                else if (body[pos] === "}" && --branchLevel === 0) {
                  close = pos;
                  break;
                }
              }
              if (close === -1) throw new Error(`{${name.trim()}, ${kind}} has a branch that's never closed`);
              seen.push(key);
              read(body.slice(at + 1, close), depth + 1);
              at = close + 1;
            }
            if (!seen.includes("other")) throw new Error(`{${name.trim()}, ${kind}} needs an "other" branch`);
          }
        }
        index = end + 1;
      } else if (char === "}") {
        throw new Error("a } that nothing opened");
      } else index++;
    }
  };
  read(message, 0);
  for (const match of message.matchAll(/<\/?(\w+)\s*\/?>/g)) tags.push(match[0].replace(/\s+/g, ""));
  return { args: [...args].sort().join(","), tags: tags.sort().join(",") };
}

function problemWith(source, translation) {
  if (typeof translation !== "string" || !translation.trim()) return "empty";
  const english = source.includes(CONTEXT) ? source.slice(source.indexOf(CONTEXT) + 1) : source;
  let want;
  try {
    want = shape(english);
  } catch {
    return undefined; // English with stray braces (code, JSON) is shown as written; nothing to match.
  }
  let have;
  try {
    have = shape(translation);
  } catch (error) {
    return error.message;
  }
  if (want.args !== have.args) return `placeholders differ: English has {${want.args}}, this has {${have.args}}`;
  if (want.tags !== have.tags) return `tags differ: English has ${want.tags || "none"}, this has ${have.tags || "none"}`;
  return undefined;
}

function languages() {
  const text = readFileSync(I18N, "utf8");
  const block = text.slice(text.indexOf("export const LANGUAGES"));
  return [...block.slice(0, block.indexOf("];")).matchAll(/code: "([^"]+)"/g)].map((match) => match[1]);
}

const localePath = (code) => join(LOCALES, `${code}.json`);
const siteLocalePath = (code) => join(SITE_LOCALES, `${code}.json`);
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const readLocale = (code) => ({ ...readJson(localePath(code)), ...(HAS_SITE ? readJson(siteLocalePath(code)) : {}) });
const idOf = (key) => createHash("sha1").update(key).digest("base64url").slice(0, 8);

// Words only the site shows go into the site's file, the rest into the app's.
function writeLocale(code, words, keys) {
  const app = {};
  const site = {};
  for (const [key, { files }] of keys) {
    if (!(key in words)) continue;
    if ([...files].every(isSiteFile)) site[key] = words[key];
    else app[key] = words[key];
  }
  writeFileSync(localePath(code), `${JSON.stringify(app, null, 2)}\n`);
  if (HAS_SITE) {
    mkdirSync(SITE_LOCALES, { recursive: true });
    writeFileSync(siteLocalePath(code), `${JSON.stringify(site, null, 2)}\n`);
  }
}

// A lock left over two minutes is taken as abandoned.
async function lockLocale(code) {
  const path = `${localePath(code)}.lock`;
  for (let tries = 0; ; tries++) {
    try {
      closeSync(openSync(path, "wx"));
      return () => unlinkSync(path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - statSync(path, { throwIfNoEntry: false })?.mtimeMs > 120_000 || tries > 600) unlinkSync(path);
      await new Promise((done) => setTimeout(done, 200));
    }
  }
}

function requireLanguage(code) {
  if (!code || code === "en" || !languages().includes(code)) {
    console.error(`Name a language other than English: ${languages().filter((l) => l !== "en").join(", ")}`);
    process.exit(1);
  }
}

const [command = "check", ...rest] = process.argv.slice(2);

if (command === "check" || command === "sync") {
  const { keys, problems, warnings } = extract();
  for (const line of warnings) console.warn(`warning: ${line}`);
  for (const line of problems) console.error(`error: ${line}`);
  let broken = problems.length;

  const codes = languages();
  const html = readFileSync(join(WEB, "index.html"), "utf8").match(/var languages = \[([^\]]+)\]/)?.[1] ?? "";
  const htmlCodes = [...html.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (htmlCodes.join() !== codes.join()) {
    console.error(`error: index.html picks from [${htmlCodes}] but lib/i18n.ts has [${codes}]`);
    broken++;
  }

  console.log(`${keys.size} strings in the app`);
  for (const code of codes.filter((c) => c !== "en")) {
    const words = readLocale(code);
    const used = Object.keys(words).filter((key) => keys.has(key));
    const unused = Object.keys(words).length - used.length;
    const bad = used.filter((key) => problemWith(key, words[key]));
    for (const key of bad.slice(0, 20)) console.error(`error: ${code}: ${JSON.stringify(key)}: ${problemWith(key, words[key])}`);
    broken += bad.length;
    const done = used.length - bad.length;
    console.log(`${code.padEnd(6)} ${String(done).padStart(5)} translated, ${String(keys.size - done).padStart(5)} missing${unused ? `, ${unused} unused` : ""}`);
    if (command === "sync" && (existsSync(localePath(code)) || existsSync(siteLocalePath(code)))) writeLocale(code, words, keys);
  }
  if (broken) process.exit(1);
} else if (command === "missing") {
  const [code] = rest;
  requireLanguage(code);
  const { keys } = extract();
  const words = readLocale(code);
  const items = [];
  for (const [key, { files }] of keys) {
    if (words[key] && !problemWith(key, words[key])) continue;
    const cut = key.indexOf(CONTEXT);
    const item = { id: idOf(key), text: cut === -1 ? key : key.slice(cut + 1) };
    if (cut !== -1) item.context = key.slice(0, cut);
    item.where = [...files].slice(0, 3);
    items.push(item);
  }
  process.stdout.write(`${JSON.stringify(items, null, 1)}\n`);
} else if (command === "merge") {
  const [code, ...files] = rest;
  requireLanguage(code);
  const { keys } = extract();
  const byId = new Map([...keys.keys()].map((key) => [idOf(key), key]));
  // Two translators may merge into one language at once: read and write it under a lock.
  const release = await lockLocale(code);
  const words = readLocale(code);
  let merged = 0;
  let rejected = 0;
  for (const file of files) {
    const incoming = JSON.parse(readFileSync(file, "utf8"));
    for (const [idOrKey, translation] of Object.entries(incoming)) {
      const key = byId.get(idOrKey) ?? (keys.has(idOrKey) ? idOrKey : undefined);
      if (!key) {
        console.warn(`skipped ${idOrKey}: the app no longer has it`);
        continue;
      }
      const problem = problemWith(key, translation);
      if (problem) {
        console.error(`rejected ${idOrKey} ${JSON.stringify(key)}: ${problem}`);
        rejected++;
        continue;
      }
      words[key] = translation;
      merged++;
    }
  }
  writeLocale(code, words, keys);
  release();
  console.log(`${code}: merged ${merged}${rejected ? `, rejected ${rejected}` : ""}`);
  if (rejected) process.exit(1);
} else if (command === "unwrapped") {
  const roots = rest.length ? rest.map((path) => resolve(SRC, path)) : HAS_SITE ? [SRC, SITE_SRC] : [SRC];
  const SHOWN = new Set(["title", "aria-label", "placeholder", "alt", "label", "description", "aria-description", "aria-valuetext", "aria-roledescription", "hint", "heading", "text", "tooltip", "subtitle", "caption", "message", "emptyText", "pendingLabel", "unavailableLabel", "confirmLabel", "cancelLabel", "actionLabel"]);
  const BRANDS = /^(plan\.video|plan|video|TikTok|YouTube|Instagram|X|LinkedIn|Bluesky|Threads|Facebook|Pinterest|Discord|Claude|Claude Code|Claude Desktop|Codex|Cursor|Gemini|Gemini CLI|ChatGPT|OpenAI|Anthropic|MCP|VS Code|Copilot|Windsurf|Zed|Valorant|CS2|Supabase|Stripe|Google|GitHub|Apple|Windows|macOS|Chrome|Safari|Firefox|MP4|WebM|MOV|GIF|PNG|JPG|JPEG|SVG|WAV|MP3|4K|HD|FPS|fps|px|ms|AI|API|URL|ID|OK|hello@plan\.video)$/;
  const looksLikeWords = (text) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!/\p{L}{2}/u.test(trimmed) || BRANDS.test(trimmed)) return false;
    if (/^[\w.+-]+@[\w.-]+$/.test(trimmed) || /^(https?:|\/|#|[a-z-]+:\/\/|\.\/)/.test(trimmed)) return false;
    // Class lists, ids, keys and code read as one lowercase token or several with dashes and colons.
    if (/^[a-z0-9_:\/\[\]().%-]+(\s+[a-z0-9_:\/\[\]().%-]+)*$/.test(trimmed) && /[-_:\/\[.]/.test(trimmed)) return false;
    return true;
  };
  const literals = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) return [[node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("…")];
    if (ts.isParenthesizedExpression(node)) return literals(node.expression);
    if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind))
      return [...literals(node.left), ...literals(node.right)];
    return [];
  };
  let count = 0;
  for (const file of sourceFiles()) {
    if (!roots.some((root) => file === root || file.startsWith(`${root}/`)) || file === I18N) continue;
    const source = parse(file);
    const rel = relative(SRC, file);
    const report = (node, text) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      console.log(`${rel}:${line + 1}: ${JSON.stringify(text.replace(/\s+/g, " ").trim())}`);
      count++;
    };
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        if (looksLikeWords(node.text)) report(node, node.text);
      } else if (ts.isJsxAttribute(node) && node.initializer && SHOWN.has(node.name.getText())) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        for (const text of value ? literals(value) : []) if (looksLikeWords(text)) report(node, text);
      } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        for (const text of literals(node.expression)) if (looksLikeWords(text)) report(node, text);
      } else if (
        ts.isCallExpression(node) &&
        ((ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "toast") ||
          (ts.isIdentifier(node.expression) && ["toast", "confirm", "alert", "prompt"].includes(node.expression.text))) &&
        node.arguments[0]
      ) {
        for (const text of literals(node.arguments[0])) if (looksLikeWords(text)) report(node, text);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === "document.title") {
        for (const text of literals(node.right)) if (looksLikeWords(text)) report(node, text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  console.log(`${count} found`);
} else {
  console.error(`Unknown command ${command}. See the top of scripts/i18n.mjs.`);
  process.exit(1);
}
