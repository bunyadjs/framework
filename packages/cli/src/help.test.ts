import { expect, test } from "bun:test";
import { run } from "./cli.ts";

async function capture(args: string[]): Promise<string> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  };
  try {
    await run(args);
  } finally {
    console.log = original;
  }
  return logs.join("\n");
}

test("--help and help show the command list", async () => {
  for (const flag of ["--help", "-h", "help"]) {
    const out = await capture([flag]);
    expect(out).toContain("Usage: bunyad <command> [options]");
    expect(out).toContain("migrate:rollback");
  }
});

test("<command> --help shows only that command", async () => {
  const out = await capture(["serve", "--help"]);
  expect(out).toContain("Usage: bunyad serve");
  expect(out).toContain("--hot");
  expect(out).not.toContain("migrate:rollback");
});

test("make:<kind> --help falls back to the make:* entry", async () => {
  const out = await capture(["make:model", "--help"]);
  expect(out).toContain("controller|model");
});
