import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "public/build");

await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "resources/js/app.tsx")],
  outdir,
  target: "browser",
  format: "esm",
  sourcemap: "linked",
  minify: process.env.NODE_ENV === "production",
  naming: {
    entry: "app.js",
    chunk: "chunk-[hash].js",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("Frontend build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Copy CSS beside the bundle (imported from app.tsx as text side-effect via Bun).
const cssIn = resolve(root, "resources/css/app.css");
const cssOut = resolve(outdir, "app.css");
await Bun.write(cssOut, Bun.file(cssIn));

console.log(`Built frontend → public/build (${result.outputs.length} outputs)`);
