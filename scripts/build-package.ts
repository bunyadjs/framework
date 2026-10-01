/**
 * Build one publishable package: `bun scripts/build-package.ts packages/orm`
 *
 * Emits `dist/` (JS + .d.ts) with tsc, then rewrites relative `.ts` specifiers
 * inside the .d.ts files to `.js` (tsc only rewrites them in the JS output).
 * Imports of other `@bunyad/*` packages resolve to their built `dist/*.d.ts`,
 * so build dependencies first (`bun run build:publishable` does this in order).
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const pkgDir = resolve(process.argv[2] ?? ".");
const dist = join(pkgDir, "dist");

/** `@bunyad/x` and `@bunyad/x/sub` -> that package's built declaration file. */
function workspacePaths(): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const dir of readdirSync(join(root, "packages"))) {
    const file = join(root, "packages", dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries<any>(pkg.exports ?? {})) {
      const types = typeof value === "string" ? value : (value.types ?? value.default);
      const built = resolve(root, "packages", dir, types.replace("./src/", "./dist/").replace(/\.ts$/, ".d.ts"));
      paths[key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`] = [built];
    }
  }
  return paths;
}

rmSync(dist, { recursive: true, force: true });

const configPath = join(pkgDir, "tsconfig.build.generated.json");
writeFileSync(
  configPath,
  JSON.stringify({
    extends: join(root, "tsconfig.base.json"),
    compilerOptions: {
      noEmit: false,
      outDir: join(pkgDir, "dist"),
      rootDir: join(pkgDir, "src"),
      declaration: true,
      rewriteRelativeImportExtensions: true,
      baseUrl: root,
      paths: workspacePaths(),
    },
    include: [join(pkgDir, "src/**/*.ts")],
    exclude: [join(pkgDir, "src/**/*.test.ts"), join(pkgDir, "src/**/*.node-test.ts")],
  }),
);

const tsc = Bun.spawnSync(["bunx", "tsc", "-p", configPath], { stdout: "inherit", stderr: "inherit" });
rmSync(configPath, { force: true });
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
