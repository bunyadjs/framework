import { expect, test } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { newProject } from "../packages/cli/src/new.ts";

/** Each kit's classic layout, scaffolded the way `bunyad new --structure=classic` does it, must boot and pass its own tests. */
for (const kit of ["react", "vue", "svelte", "api", "views", "live", "saas"]) {
  test(`the classic ${kit} starter passes its own tests`, async () => {
    const parent = resolve(import.meta.dir, "../templates/.classic-smoke");
    const target = resolve(parent, kit);
    await rm(parent, { recursive: true, force: true });
    await mkdir(parent, { recursive: true });
    const cwd = process.cwd();
    process.chdir(parent);
    try {
      await newProject([kit, kit, "--structure=classic", "--no-install", "--no-git"]);
      // The workspace's links stand in for `bun install`.
      await symlink(resolve(import.meta.dir, `../templates/${kit}/node_modules`), resolve(target, "node_modules"));
      const types = Bun.spawnSync(["bun", resolve(import.meta.dir, "../packages/cli/src/bunyad.ts"), "types:generate"], { cwd: target });
      expect(types.exitCode).toBe(0);
      const result = Bun.spawnSync(["bun", "test"], { cwd: target, stdout: "pipe", stderr: "pipe" });
      expect(result.stderr.toString() + result.stdout.toString()).toContain(" 0 fail");
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(cwd);
      await rm(parent, { recursive: true, force: true });
    }
  }, 120_000);
}
