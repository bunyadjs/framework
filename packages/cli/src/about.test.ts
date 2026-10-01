import { expect, test } from "bun:test";
import { run } from "./cli.ts";

test("about --json prints runtime information", async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await run(["about", "--json"]);
  } finally {
    console.log = original;
  }
  const parsed = JSON.parse(logs.join("\n")) as {
    application: { name: string };
    runtime: { bun: string };
    flock: { dumpUrl: string | null };
  };
  expect(parsed.application.name.length).toBeGreaterThan(0);
  expect(parsed.runtime.bun.length).toBeGreaterThan(0);
  expect("dumpUrl" in parsed.flock).toBe(true);
});
