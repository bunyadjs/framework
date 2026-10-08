import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Strict names are a compile-time feature, so these tests run the TypeScript compiler.
const root = resolve(import.meta.dir, "../../..");
const orm = resolve(import.meta.dir, "..");
const tsc = resolve(root, "node_modules/.bin/tsc");

function compile(args: string[]) {
  const proc = Bun.spawnSync([tsc, ...args], { stdout: "pipe", stderr: "pipe" });
  return proc.stdout.toString() + proc.stderr.toString();
}

function errorLines(output: string, file: string): number[] {
  const pattern = new RegExp(`${file.replace(".", "\\.")}\\((\\d+),\\d+\\): error`, "g");
  return [...new Set([...output.matchAll(pattern)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

function markedLines(source: string): number[] {
  return source.split("\n").flatMap((line, i) => (line.includes("// ERROR") ? [i + 1] : []));
}

test("with strict names on, typos fail and valid names compile; the ORM's own source stays clean", () => {
  const dir = resolve(orm, "test-fixtures/strict-names");
  const output = compile(["-p", dir]);
  const expected = markedLines(readFileSync(resolve(dir, "app.ts"), "utf8"));

  expect(expected.length).toBeGreaterThan(0);
  // Exactly the marked lines fail: no valid line is rejected, no typo slips through.
  expect(errorLines(output, "app.ts")).toEqual(expected);
  // The library itself must compile with the flag on (apps that build the ORM from source enable it too).
  expect(output.split("\n").filter((l) => /^(src|\.\.\/\.\.\/src)\/.*error TS/.test(l))).toEqual([]);
}, 60_000);

test("a published-style consumer (emitted .d.ts, augmenting @bunyad/orm) gets the same checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunyad-strict-"));
  try {
    const dist = join(dir, "dist");
    compile(["-p", orm, "--declaration", "--emitDeclarationOnly", "--noEmit", "false", "--outDir", dist]);
    const app = `import { Model } from "@bunyad/orm";
declare module "@bunyad/orm" {
  interface OrmTypeOptions { strictNames: true }
}
class Post extends Model {
  static table = "posts";
  declare title: string;
  author() { return this.belongsTo(Post, "author_id"); }
}
Post.with("author", "author.posts");
Post.where("title", "x").orderBy("created_at");
Post.with("autor"); // ERROR
Post.where("titel", 1); // ERROR
`;
    writeFileSync(join(dir, "app.ts"), app);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: resolve(root, "tsconfig.base.json"),
        compilerOptions: { noEmit: true, types: [], typeRoots: [resolve(root, "node_modules/@types")], baseUrl: ".", paths: { "@bunyad/orm": [join(dist, "index.d.ts")] } },
        include: ["app.ts"],
      }),
    );
    const output = compile(["-p", dir]);
    expect(errorLines(output, "app.ts")).toEqual(markedLines(app));
    expect(output.split("\n").filter((l) => /error TS/.test(l) && !l.includes("app.ts"))).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
