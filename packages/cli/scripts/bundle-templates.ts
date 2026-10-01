/**
 * Copy the starter kits into `packages/cli/templates/` so the published CLI can
 * scaffold apps without the monorepo. Run by the CLI's `build` script.
 */
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isRuntimeArtifact } from "../src/new.ts";

const cliDir = resolve(import.meta.dir, "..");
const source = resolve(cliDir, "../../templates");
const dest = join(cliDir, "templates");

rmSync(dest, { recursive: true, force: true });

// `package` is a template for writing new packages, not an app starter.
const kits = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "package")
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(source, name, "package.json")));

for (const kit of kits) {
  const from = join(source, kit);
  cpSync(from, join(dest, kit), {
    recursive: true,
    filter: (path) => !isRuntimeArtifact(relative(from, path)),
  });
}
// Kits extend this; a scaffolded app inlines it (see makeStandalone in new.ts).
cpSync(resolve(cliDir, "../../tsconfig.base.json"), join(dest, "tsconfig.base.json"));

console.log(`bundled ${kits.length} starter kits: ${kits.join(", ")}`);
