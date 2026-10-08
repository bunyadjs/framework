/**
 * Bundle-size guard: bundles a one-model app with `bun build --minify` and checks that
 * the ORM pulls in only its own packages and stays within a size budget. If a number
 * legitimately grows, raise it deliberately and say why in the commit.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function bundle(source: string): Promise<{ bytes: number; packages: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "bunyad-bundle-"));
  try {
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, source);
    const out = join(dir, "out.js");
    const meta = join(dir, "meta.json");
    const proc = Bun.spawnSync([
      "bun", "build", entry, "--target=bun", "--minify", `--outfile=${out}`, `--metafile=${meta}`,
    ], { cwd: root, stderr: "pipe" });
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
    const metafile = JSON.parse(readFileSync(meta, "utf8")) as {
      outputs: Record<string, { bytes: number; inputs: Record<string, unknown> }>;
    };
    const output = Object.values(metafile.outputs)[0]!;
    const packages = new Set<string>();
    for (const input of Object.keys(output.inputs)) {
      if (input.endsWith("entry.ts")) continue;
      const abs = resolve(root, input);
      const match = /\/packages\/([^/]+)\//.exec(abs);
      packages.add(match ? `@bunyad/${match[1]}` : input.includes("node_modules") ? "node_modules" : "other");
    }
    return { bytes: output.bytes, packages: [...packages].sort() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const orm = (rel: string) => JSON.stringify(join(root, "packages/orm/src", rel));

test("a one-model app bundles only the ORM, database and common packages", async () => {
  const { packages } = await bundle(
    `import { Model } from ${orm("index.ts")};\nclass User extends Model { static table = "users"; }\nconsole.log(User.table);\n`,
  );
  expect(packages).toEqual(["@bunyad/common", "@bunyad/database", "@bunyad/orm"]);
});

test("the ORM bundle stays within its size budget", async () => {
  const { bytes } = await bundle(
    `import { Model } from ${orm("index.ts")};\nclass User extends Model { static table = "users"; }\nconsole.log(User.table);\n`,
  );
  // About 228 KB minified when this check was added.
  expect(bytes).toBeLessThan(300 * 1024);
});

test("an app that only uses the query builder does not pay for the ORM", async () => {
  const entry = `import { connectSqlite } from ${JSON.stringify(join(root, "packages/database/src/index.ts"))};\nconsole.log(typeof connectSqlite);\n`;
  const { bytes, packages } = await bundle(entry);
  expect(packages).not.toContain("@bunyad/orm");
  expect(bytes).toBeLessThan(200 * 1024);
});
