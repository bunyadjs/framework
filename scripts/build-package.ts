/**
 * Build one publishable package: `bun scripts/build-package.ts packages/orm`
 *
 * Emits `dist/` (JS + .d.ts) with tsc, then rewrites relative `.ts` specifiers
 * inside the .d.ts files to `.js` (tsc only rewrites them in the JS output).
 */
import { rmSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const pkgDir = resolve(process.argv[2] ?? ".");
const dist = join(pkgDir, "dist");

rmSync(dist, { recursive: true, force: true });

const tsc = Bun.spawnSync(["bunx", "tsc", "-p", join(pkgDir, "tsconfig.build.json")], {
  stdout: "inherit",
  stderr: "inherit",
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

const relativeTs = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']*?)\.ts\2/g;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

for (const file of await walk(dist)) {
  const src = await readFile(file, "utf8");
  const next = src.replace(relativeTs, "$1$2$3.js$2");
  if (next !== src) await writeFile(file, next);
}
console.log(`built ${pkgDir}`);
