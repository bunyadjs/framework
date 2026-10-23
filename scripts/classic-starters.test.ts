import { expect, test } from "bun:test";
import { rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { newProject } from "../packages/cli/src/new.ts";

/** Each kit's classic layout, scaffolded the way `bunyad new --structure=classic` does it, must boot and pass its own tests. */
for (const kit of ["react", "vue", "svelte", "api", "views", "live", "saas"]) {
  test(`the classic ${kit} starter passes its own tests`, async () => {
    // Next to the starters, so the app's `../../tsconfig.base.json` is the repo's, as it is for the templates.
    const parent = resolve(import.meta.dir, "../templates");
    const target = resolve(parent, `classic-smoke-${kit}`);
    await rm(target, { recursive: true, force: true });
    const cwd = process.cwd();
    process.chdir(parent);
    try {
      await newProject([kit, `classic-smoke-${kit}`, "--structure=classic", "--no-install", "--no-git"]);
      // The workspace's links stand in for `bun install`.
      await symlink(resolve(import.meta.dir, `../templates/${kit}/node_modules`), resolve(target, "node_modules"));
      // The generated files ship with the starter, so the app runs and tests before anything is generated.
      const result = Bun.spawnSync(["bun", "test"], { cwd: target, stdout: "pipe", stderr: "pipe" });
      expect(result.stderr.toString() + result.stdout.toString()).toContain(" 0 fail");
      expect(result.exitCode).toBe(0);
      // ...and they are what `types:generate` would write now, so a change to the starter's routes or pages cannot leave them stale.
      const types = Bun.spawnSync(["bun", resolve(import.meta.dir, "../packages/cli/src/bunyad.ts"), "types:generate"], { cwd: target, stdout: "pipe", stderr: "pipe" });
      expect(types.exitCode).toBe(0);
      expect(types.stdout.toString()).not.toContain("wrote");
    } finally {
      process.chdir(cwd);
      await rm(target, { recursive: true, force: true });
    }
  }, 120_000);
}
