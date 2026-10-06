import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

test("a command registered by a provider while the app boots is found", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-provider-cmd-"));
  await mkdir(join(root, "bootstrap"), { recursive: true });
  await writeFile(
    join(root, "bootstrap/app.ts"),
    `import { registerProviderCommand } from ${JSON.stringify(import.meta.resolve("@bunyad/core"))};
export async function createApplication() {
  registerProviderCommand("provider-test:hello", async (args) => {
    console.log("hello " + args.join(","));
  });
}
`,
  );

  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await withCwd(root, async () => {
      process.exitCode = 0;
      await run(["provider-test:hello", "a", "b"]);
      expect(process.exitCode).toBe(0);
    });
  } finally {
    console.log = original;
  }
  expect(logs).toContain("hello a,b");
});

test("an unknown command still fails clearly, with or without an app", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-provider-cmd-"));
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    await withCwd(root, async () => {
      process.exitCode = 0;
      await run(["nope:nothing"]);
      expect(process.exitCode).toBe(1);
    });

    await mkdir(join(root, "bootstrap"), { recursive: true });
    await writeFile(join(root, "bootstrap/app.ts"), `export async function createApplication() {}\n`);
    await withCwd(root, async () => {
      process.exitCode = 0;
      await run(["nope:nothing"]);
      expect(process.exitCode).toBe(1);
    });

    await writeFile(join(root, "bootstrap/app.ts"), `throw new Error("boot failed");\n`);
    await withCwd(root, async () => {
      process.exitCode = 0;
      await run(["nope:nothing"]);
      expect(process.exitCode).toBe(1);
    });
  } finally {
    console.error = original;
    process.exitCode = 0;
  }
  expect(errors.filter((line) => line.includes('Command "nope:nothing" is not defined.'))).toHaveLength(3);
});
