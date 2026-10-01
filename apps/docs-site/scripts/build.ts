/**
 * `bun run build` — render every docs page to static HTML under `dist/`,
 * alongside the search index and a redirect stub at the site root.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { documentFor, documents, searchJson, warm } from "../app/Docs/cache.ts";
import { flatPages } from "../app/Docs/nav.ts";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");

await warm();

cpSync(join(root, "public"), dist, { recursive: true });
writeFileSync(join(dist, "assets/search-index.json"), searchJson());
writeFileSync(
  join(dist, "index.html"),
  `<!DOCTYPE html><meta charset="utf-8"/><meta http-equiv="refresh" content="0; url=/docs/1.x"/><title>Bunyad Docs</title><p><a href="/docs/1.x">Bunyad Docs</a></p>`,
);

for (const page of flatPages()) {
  const body = await documentFor(page.slug);
  if (!body) throw new Error(`Missing page ${page.slug}`);
  const file = page.slug
    ? join(dist, "docs/1.x", page.slug, "index.html")
    : join(dist, "docs/1.x/index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

console.log(`Wrote ${documents().length} pages to ${dist}`);
