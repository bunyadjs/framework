import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "../../../apps/my-api");

function run(args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync([process.execPath, "./bunyad", ...args], { cwd: app, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

test("schema:check and schema:types read the real database of an app", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunyad-schema-"));
  const env = { DB_DATABASE: join(dir, "app.sqlite") };
  try {
    expect(run(["migrate"], env).code).toBe(0);

    const check = run(["schema:check"], env);
    expect(check.code).toBe(0);
    expect(check.out).toContain("0 errors");

    const out = join(dir, "models.generated.ts");
    const types = run(["schema:types", `--out=${out}`], env);
    expect(types.code).toBe(0);
    const file = readFileSync(out, "utf8");
    expect(file).toContain("export interface UserColumns {");
    expect(file).toMatch(/email: string;/);
    expect(file).toContain("export interface PersonalAccessTokenColumns {");

    // running it again leaves the file alone
    expect(run(["schema:types", `--out=${out}`], env).out).toContain("unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
