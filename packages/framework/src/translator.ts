import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Messages = Record<string, string>;

const messages = new Map<string, Messages>();
let locale = "en";
let fallback = "en";

function flatten(value: unknown, prefix: string, into: Messages): void {
  if (typeof value === "string") into[prefix] = value;
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) flatten(inner, prefix ? `${prefix}.${key}` : key, into);
  }
}

/** Add messages for a locale. Nested objects become dotted keys; `namespace` is put in front of every key. */
export function addTranslations(lang: string, data: unknown, namespace = ""): void {
  const bag = messages.get(lang) ?? {};
  flatten(data, namespace, bag);
  messages.set(lang, bag);
}

export function setLocale(next: string): void {
  locale = next;
}

export function getLocale(): string {
  return locale;
}

export function setFallbackLocale(next: string): void {
  fallback = next;
}

/** Forget every message (tests). */
export function clearTranslations(): void {
  messages.clear();
}

/** The message for `key` in the current locale (then the fallback locale), with `:name` replaced; the key itself when missing. */
export function trans(key: string, replace: Record<string, unknown> = {}, lang = locale): string {
  const found = messages.get(lang)?.[key] ?? messages.get(fallback)?.[key] ?? key;
  return found.replace(/:(\w+)/g, (match, name: string) => (name in replace ? String(replace[name]) : match));
}

/** Every message of a locale as a flat `{ key: text }` object, to share with a frontend. `prefix` keeps only that namespace. */
export function translations(lang = locale, prefix = ""): Messages {
  const all = { ...messages.get(fallback), ...messages.get(lang) };
  if (!prefix) return all;
  return Object.fromEntries(Object.entries(all).filter(([key]) => key === prefix || key.startsWith(`${prefix}.`)));
}

/**
 * Load `lang/<locale>.json` (keys as written) and, beside the pages, `lang.<locale>.json` in any route
 * folder: its keys get the folder's name in front (`routes/(auth)/login/lang.en.json` -> `login.title`).
 * Group, `[param]` and `_` folders add no segment.
 */
export function loadTranslations(basePath: string, defaults: { locale?: string; fallback?: string } = {}): void {
  if (defaults.locale) locale = defaults.locale;
  if (defaults.fallback) fallback = defaults.fallback;

  const lang = join(basePath, "lang");
  if (existsSync(lang)) {
    for (const file of readdirSync(lang)) {
      const match = /^([\w-]+)\.json$/.exec(file);
      if (match) addTranslations(match[1]!, JSON.parse(readFileSync(join(lang, file), "utf8")));
    }
  }

  const walk = (dir: string, parts: string[]): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry.startsWith("_") || entry.startsWith(".") || /^[A-Z]/.test(entry)) continue;
        const segment = /^[(\[]/.test(entry) ? [] : [entry];
        walk(full, [...parts, ...segment]);
        continue;
      }
      const match = /^lang\.([\w-]+)\.json$/.exec(entry);
      if (match) addTranslations(match[1]!, JSON.parse(readFileSync(full, "utf8")), parts.join("."));
    }
  };
  const tree = join(basePath, "routes");
  if (existsSync(tree)) walk(tree, []);
}
