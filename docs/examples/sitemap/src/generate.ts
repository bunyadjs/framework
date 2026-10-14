/** bun src/generate.ts — seed 100k rows, write both hosts' sitemaps to ./public. */
import { generateToDisk } from "@bunyad/sitemap/command";
import { config, disk, ROWS, seed } from "./app.ts";

await seed();
const start = performance.now();
const results = await generateToDisk(config, { disk });
for (const { domain, result } of results) {
  console.log(
    `${domain.host}: ${result.urls} URLs, ${result.files.length} parts → public/${domain.path}`,
  );
}
console.log(
  `${ROWS} rows in ${((performance.now() - start) / 1000).toFixed(2)} s`,
);
