import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Strict names are a compile-time feature, so the test compiles a fixture that turns them on.
test("strict names accept valid names and reject typos at compile time", () => {
  const dir = resolve(import.meta.dir, "../test-fixtures/strict-names");
  const tsc = resolve(import.meta.dir, "../../../node_modules/.bin/tsc");
  const proc = Bun.spawnSync([tsc, "-p", dir], { stdout: "pipe", stderr: "pipe" });
  const output = proc.stdout.toString() + proc.stderr.toString();

  const source = readFileSync(resolve(dir, "app.ts"), "utf8").split("\n");
  const expectedLines = source.flatMap((line, i) => (line.includes("// ERROR") ? [i + 1] : []));
  const failingLines = [...output.matchAll(/app\.ts\((\d+),\d+\): error/g)].map((m) => Number(m[1]));

  expect(expectedLines.length).toBeGreaterThan(0);
  // Exactly the marked lines fail: no valid line is rejected, no typo slips through.
  expect([...new Set(failingLines)].sort((a, b) => a - b)).toEqual(expectedLines);
}, 60_000);
