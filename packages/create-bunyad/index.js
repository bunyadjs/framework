#!/usr/bin/env bun
// `bun create bunyad my-app [--kit=react] [--database=pgsql] [--no-install] [--no-git]`
// is the same as `bunyad new` with the directory given first.

// `npm create bunyad` runs this file with Node, which cannot run Bunyad. Say so plainly.
if (typeof Bun === "undefined") {
  console.error(
    "Bunyad needs Bun, and this is not running on Bun.\n" +
      "Install it from https://bun.sh, then run: bun create bunyad my-app",
  );
  process.exit(1);
}

const { run } = await import("@bunyad/cli");

const args = process.argv.slice(2);
const dirIndex = args.findIndex((arg) => !arg.startsWith("--"));
const forwarded =
  dirIndex === -1
    ? args
    : [...args.slice(0, dirIndex), `--dir=${args[dirIndex]}`, ...args.slice(dirIndex + 1)];

await run(["new", ...forwarded]);
