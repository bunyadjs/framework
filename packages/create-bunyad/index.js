#!/usr/bin/env bun
// `bun create bunyad my-app [--kit=react] [--database=pgsql] [--no-install] [--no-git]`
// is the same as `bunyad new` with the directory given first.
import { run } from "@bunyad/cli";

const args = process.argv.slice(2);
const dirIndex = args.findIndex((arg) => !arg.startsWith("--"));
const forwarded =
  dirIndex === -1
    ? args
    : [...args.slice(0, dirIndex), `--dir=${args[dirIndex]}`, ...args.slice(dirIndex + 1)];

await run(["new", ...forwarded]);
