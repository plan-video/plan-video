/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keep this file free of the browser, types included: the build imports seo-pages.ts in Node, which uses `msg`.

/// <reference types="vite/client" />

import { batch, createSignal, type JSX } from "solid-js";

export type Language = "en" | "es" | "fr" | "de" | "it" | "pt-BR" | "nl" | "pl" | "tr" | "ja" | "ko" | "zh-CN";

/** index.html keeps its own copy of these codes to pick one before the first paint. */
export const LANGUAGES: { code: Language; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh-CN", name: "简体中文" },
];

const STORAGE_KEY = "plan.language";

type Catalog = Record<string, string>;

const catalogs = import.meta.glob<Catalog>("../locales/*.json", { import: "default" });
const siteCatalogs = import.meta.glob<Catalog>("../../site/locales/*.json", { import: "default" });

const isLanguage = (code: string | null | undefined): code is Language => LANGUAGES.some((entry) => entry.code === code);

/** There's none when the build reads this in Node. */
const page = () => (globalThis as { document?: { documentElement: { lang: string } } }).document?.documentElement;

function startingLanguage(): Language {
  const code = page()?.lang;
  return isLanguage(code) ? code : "en";
}

const [language, setLanguageSignal] = createSignal<Language>(startingLanguage());
const [catalog, setCatalog] = createSignal<Catalog | null>(null);

export { language };

async function loadCatalog(code: Language): Promise<Catalog | null> {
  if (code === "en") return null;
  const load = catalogs[`../locales/${code}.json`];
  const loadSite = siteCatalogs[`../../site/locales/${code}.json`];
  const [words, siteWords] = await Promise.all([load?.(), loadSite?.()]);
  return words || siteWords ? { ...words, ...siteWords } : null;
}

// Undefined in English. If the words fail to arrive, the app draws in English and the pick stays for the next visit.
export function loadStartingLanguage(): Promise<void> | undefined {
  const code = language();
  if (code === "en") return undefined;
  return loadCatalog(code).then(
    (words) => void setCatalog(words),
    () => void setLanguageSignal("en"),
  );
}

let switching = 0;

export async function setLanguage(code: Language): Promise<void> {
  const ticket = ++switching;
  const words = await loadCatalog(code);
  if (ticket !== switching) return;
  batch(() => {
    setCatalog(words);
    setLanguageSignal(code);
  });
  const root = page();
  if (root) root.lang = code;
  try {
    (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage?.setItem(STORAGE_KEY, code);
  } catch {
    // Storage can be off (private windows); the choice then lasts the visit.
  }
}

export type Message = { message: string; context: string };

const CONTEXT = "\u0004";

const keyOf = (source: string | Message) => (typeof source === "string" ? source : `${source.context}${CONTEXT}${source.message}`);

let english = 0;

// Only covers what runs before `read` returns: after an await it's the app's language again.
export function inEnglish<T>(read: () => T): T {
  english++;
  try {
    return read();
  } finally {
    english--;
  }
}

const current = (): Language => (english ? "en" : language());

function lookup(source: string | Message): string {
  const key = keyOf(source);
  const translated = english ? undefined : catalog()?.[key];
  if (translated) return translated;
  if (typeof source !== "string") return source.message;
  const cut = key.indexOf(CONTEXT);
  return cut === -1 ? key : key.slice(cut + 1);
}

type Value = string | number | boolean | null | undefined;
export type Values = Record<string, Value>;

export function msg<T extends string>(source: T): T;
export function msg(source: Message): string;
export function msg(source: string | Message): string {
  return keyOf(source);
}

export function t(source: string | Message, values?: Values): string {
  const message = lookup(source);
  return values ? format(message, values, (text) => text) : message;
}

type Tag = (chunk: string) => JSX.Element;

export function rich(source: string | Message, parts: Record<string, Value | Tag | JSX.Element>): JSX.Element {
  const values: Values = {};
  const tags: Record<string, Tag> = {};
  const nodes: Record<string, JSX.Element> = {};
  for (const [name, part] of Object.entries(parts)) {
    if (typeof part === "function" && part.length > 0) tags[name] = part as Tag;
    else if (part === null || part === undefined || ["string", "number", "boolean"].includes(typeof part)) values[name] = part as Value;
    else nodes[name] = part as JSX.Element;
  }

  // Values sit behind markers while tags are found, so a value with a "<" (a file name, a caption) is never read as markup.
  const kept: string[] = [];
  // Private-use characters, which no text carries.
  const keep = (text: string) => `${kept.push(text) - 1}`;
  const restore = (text: string) => text.replace(/(\d+)/g, (_, index: string) => kept[Number(index)]);
  for (const name of Object.keys(nodes)) values[name] = `${name}`;
  const message = format(lookup(source), values, keep);

  const out: JSX.Element[] = [];
  const text = (chunk: string) => {
    restore(chunk)
      .split(/(\w+)/)
      .forEach((part, index) => {
        if (index % 2) out.push(nodes[part]);
        else if (part) out.push(part);
      });
  };
  let last = 0;
  for (const match of message.matchAll(/<(\w+)>([\s\S]*?)<\/\1>|<(\w+)\s*\/>/g)) {
    text(message.slice(last, match.index));
    const name = match[1] ?? match[3];
    const inner = restore(match[2] ?? "");
    const tag = tags[name];
    out.push(tag ? tag(inner) : inner);
    last = match.index + match[0].length;
  }
  text(message.slice(last));
  return out;
}

// Only {name}, plural, selectordinal and select are supported; anything else in braces is left as written.

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralRule(type: Intl.PluralRuleType, value: number): string {
  const code = current();
  const key = `${code}:${type}`;
  let rules = pluralRules.get(key);
  if (!rules) pluralRules.set(key, (rules = new Intl.PluralRules(code, { type })));
  return rules.select(value);
}

function closing(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function branches(text: string): Record<string, string> | undefined {
  const found: Record<string, string> = {};
  let index = 0;
  for (;;) {
    while (/\s/.test(text[index] ?? "")) index++;
    if (index >= text.length) return found;
    const start = index;
    while (index < text.length && !/[\s{]/.test(text[index])) index++;
    const key = text.slice(start, index);
    while (/\s/.test(text[index] ?? "")) index++;
    if (!key || text[index] !== "{") return undefined;
    const end = closing(text, index);
    if (end === -1) return undefined;
    found[key] = text.slice(index + 1, end);
    index = end + 1;
  }
}

function argument(inner: string, values: Values, insert: (text: string) => string): string | undefined {
  const [name, type, ...rest] = inner.split(",");
  const key = name.trim();
  if (!(key in values)) return undefined;
  const value = values[key];
  if (type === undefined) return insert(value == null ? "" : String(value));
  const options = branches(rest.join(","));
  if (!options) return undefined;
  switch (type.trim()) {
    case "plural":
    case "selectordinal": {
      const count = Number(value);
      const branch = options[`=${count}`] ?? options[pluralRule(type.trim() === "plural" ? "cardinal" : "ordinal", count)] ?? options.other;
      return branch === undefined ? undefined : format(branch, values, insert, insert(String(value)));
    }
    case "select": {
      const branch = options[String(value)] ?? options.other;
      return branch === undefined ? undefined : format(branch, values, insert);
    }
  }
  return undefined;
}

function format(message: string, values: Values, insert: (text: string) => string, count?: string): string {
  let out = "";
  let index = 0;
  while (index < message.length) {
    const char = message[index];
    if (char === "#" && count !== undefined) {
      out += count;
      index++;
    } else if (char === "{") {
      const end = closing(message, index);
      if (end === -1) return out + message.slice(index);
      out += argument(message.slice(index + 1, end), values, insert) ?? message.slice(index, end + 1);
      index = end + 1;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** In English each caller keeps its own locale (`english`; undefined is the browser's own). */
export function intlLocale(english?: string): string | undefined {
  const code = current();
  return code === "en" ? english : code;
}

export function localized<T>(make: (locale: string | undefined) => T, english?: string): () => T {
  const made = new Map<Language, T>();
  return () => {
    // Read the language first, so JSX and memos calling this track it.
    const code = language() && current();
    if (!made.has(code)) made.set(code, make(code === "en" ? english : code));
    return made.get(code)!;
  };
}
