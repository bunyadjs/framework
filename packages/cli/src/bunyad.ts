#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Inside an app, hand over to its own `./bunyad` launcher so the command runs
 * against the app's installed `@bunyad/*` versions, not a global copy. Outside
 * an app (and for `new`), this CLI runs the command itself.
 */
function appLauncher(command: string | undefined): string | null {
  if (command === "new") return null;
  const launcher = resolve(process.cwd(), "bunyad");
  try {
    if (!existsSync(launcher) || !statSync(launcher).isFile()) return null;
    return readFileSync(launcher, "utf8").includes("@bunyad/cli") ? launcher : null;
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const launcher = appLauncher(args[0]);
if (launcher) {
  const proc = Bun.spawn(["bun", launcher, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

const { run } = await import("./cli.ts");
await run();
