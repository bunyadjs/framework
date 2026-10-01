import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "bootstrap");

await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "resources/js/ssr.tsx")],
  outdir,
  target: "node",
  format: "esm",
  sourcemap: "linked",
  minify: false,
  naming: {
    entry: "ssr.js",
    chunk: "ssr-chunk-[hash].js",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("SSR build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Built SSR → bootstrap/ssr.js (${result.outputs.length} outputs)`);
