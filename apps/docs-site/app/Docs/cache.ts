import { statSync } from "node:fs";
import { buildPage, contentFile, loadPages, renderDocument, searchIndex, type BuiltPage } from "./site.ts";
import { flatPages } from "./nav.ts";

let pages: BuiltPage[] | null = null;
let indexJson = "[]";
const mtimes = new Map<string, number>();

export async function warm(): Promise<BuiltPage[]> {
  pages = await loadPages();
  for (const page of flatPages()) {
    mtimes.set(page.slug, statSync(contentFile(page.file)).mtimeMs);
  }
  indexJson = JSON.stringify(searchIndex(pages));
  return pages;
}

export function searchJson(): string {
  return indexJson;
}

export function documents(): BuiltPage[] {
  if (!pages) throw new Error("Call warm() before serving docs.");
  return pages;
}

export async function documentFor(slug: string): Promise<string | null> {
  const all = documents();
  const index = all.findIndex((item) => item.slug === slug);
  if (index === -1) return null;
  const source = flatPages().find((item) => item.slug === slug);
  if (source) {
    const mtime = statSync(contentFile(source.file)).mtimeMs;
    if (mtimes.get(slug) !== mtime) {
      all[index] = await buildPage(source);
      mtimes.set(slug, mtime);
      indexJson = JSON.stringify(searchIndex(all));
    }
  }
  return renderDocument(all[index]!, all);
}
