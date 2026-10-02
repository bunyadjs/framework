/**
 * Public API snapshot: the runtime export names of every package entry point.
 * A change here is a change to the beta API, so it must be deliberate:
 *
 *   UPDATE_API=1 bun test scripts/api-snapshot.test.ts
 *
 * then review the diff in `api/` (removed names are breaking changes).
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const apiDir = join(root, "api");
const update = process.env.UPDATE_API === "1";

for (const dir of readdirSync(join(root, "packages")).sort()) {
  const pkgPath = join(root, "packages", dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const entry = typeof pkg.exports?.["."] === "string" ? pkg.exports["."] : pkg.exports?.["."]?.default ?? pkg.exports?.["."]?.bun;
  if (pkg.private || typeof entry !== "string") continue;

  test(`${pkg.name} public exports`, async () => {
    const mod = await import(join(root, "packages", dir, entry));
    const names = Object.keys(mod).sort();
    const file = join(apiDir, `${dir}.json`);
    if (update) {
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(file, JSON.stringify(names, null, 2) + "\n");
    }
    expect(names).toEqual(JSON.parse(readFileSync(file, "utf8")));
  });
}
