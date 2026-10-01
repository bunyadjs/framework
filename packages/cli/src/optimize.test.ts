import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.ts";

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

test("optimize and optimize:clear", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-optimize-"));
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(root, "routes"), { recursive: true });
  await writeFile(
    join(root, "config/app.ts"),
    `export default { name: "OptimizeTest" };\n`,
  );
  // Side-effect free — route:cache only needs a loadable module.
  await writeFile(join(root, "routes/web.ts"), `export {};\n`);

  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    await withCwd(root, async () => {
      process.exitCode = 0;
      await run(["optimize"]);
      expect(await Bun.file(join(root, ".build/config.json")).exists()).toBe(
        true,
      );
      expect(await Bun.file(join(root, ".build/routes.json")).exists()).toBe(
        true,
      );

      logs.length = 0;
      await run(["optimize:clear"]);
      expect(await Bun.file(join(root, ".build/config.json")).exists()).toBe(
        false,
      );
      expect(await Bun.file(join(root, ".build/routes.json")).exists()).toBe(
        false,
      );
      expect(logs.some((l) => l.includes("Caches cleared"))).toBe(true);
    });
  } finally {
    console.log = original;
  }
});
