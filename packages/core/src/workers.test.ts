import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdir, rm, writeFile, chmod } from "node:fs/promises";
import {
  resolveWorkerLaunch,
  startWorkers,
} from "../src/workers.ts";
import {
  requestShutdown,
  resetShutdownForTests,
} from "../src/shutdown.ts";

test("startWorkers requires compiled manifest", async () => {
  resetShutdownForTests();
  const dir = resolve(import.meta.dir, ".tmp-workers-missing");
  await rm(dir, { recursive: true, force: true });
  await expect(
    startWorkers({ cwd: dir, buildDir: resolve(dir, ".build"), http: 1 }),
  ).rejects.toThrow(/bunyad compile/);
});

test("startWorkers rejects empty worker request", async () => {
  resetShutdownForTests();
  const dir = resolve(import.meta.dir, ".tmp-workers-empty");
  const buildDir = resolve(dir, ".build");
  await rm(dir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  await writeFile(
    resolve(buildDir, "manifest.json"),
    JSON.stringify({
      version: 1,
      entries: {
        http: "./server.ts",
        queue: "./queue-worker.ts",
        scheduler: "./schedule-worker.ts",
      },
    }),
  );
  await expect(
    startWorkers({ cwd: dir, buildDir, http: 0, queue: 0, schedule: false }),
  ).rejects.toThrow(/No workers requested/);
  await rm(dir, { recursive: true, force: true });
});

test("resolveWorkerLaunch prefers binary when present", async () => {
  const dir = resolve(import.meta.dir, ".tmp-workers-bin");
  const buildDir = resolve(dir, ".build");
  await rm(dir, { recursive: true, force: true });
  await mkdir(resolve(buildDir, "bin"), { recursive: true });
  const bin = resolve(buildDir, "bin/bunyad-http");
  await writeFile(bin, "#!/bin/sh\necho ok\n");
  await chmod(bin, 0o755);

  const launch = await resolveWorkerLaunch(resolve(buildDir, "server.ts"), {
    bun: process.execPath,
    buildDir,
    role: "http",
    binary: "auto",
  });
  expect(launch.mode).toBe("binary");
  expect(launch.cmd[0]).toBe(bin);

  const script = await resolveWorkerLaunch(resolve(buildDir, "server.ts"), {
    bun: process.execPath,
    buildDir,
    role: "http",
    binary: false,
  });
  expect(script.mode).toBe("script");

  await expect(
    resolveWorkerLaunch(resolve(buildDir, "queue-worker.ts"), {
      bun: process.execPath,
      buildDir,
      role: "queue",
      binary: true,
    }),
  ).rejects.toThrow(/Missing compiled binary/);

  await rm(dir, { recursive: true, force: true });
});

test("startWorkers restarts then shuts down exhausted workers", async () => {
  resetShutdownForTests();
  const dir = resolve(import.meta.dir, ".tmp-workers-restart");
  const buildDir = resolve(dir, ".build");
  await rm(dir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  const entry = resolve(buildDir, "server.ts");
  await writeFile(entry, "process.exit(1);\n");
  await writeFile(
    resolve(buildDir, "manifest.json"),
    JSON.stringify({
      version: 1,
      entries: { http: "./server.ts" },
    }),
  );

  const code = await startWorkers({
    cwd: dir,
    buildDir,
    http: 1,
    queue: 0,
    schedule: false,
    restart: true,
    maxRestarts: 2,
    shutdownTimeoutMs: 500,
    binary: false,
  });

  expect(code).toBe(1);
  await rm(dir, { recursive: true, force: true });
  resetShutdownForTests();
});

test("startWorkers stops on shutdown signal", async () => {
  resetShutdownForTests();
  const dir = resolve(import.meta.dir, ".tmp-workers-signal");
  const buildDir = resolve(dir, ".build");
  await rm(dir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  const entry = resolve(buildDir, "server.ts");
  await writeFile(
    entry,
    `
const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await Bun.sleep(60_000);
`,
  );
  await writeFile(
    resolve(buildDir, "manifest.json"),
    JSON.stringify({
      version: 1,
      entries: { http: "./server.ts" },
    }),
  );

  const run = startWorkers({
    cwd: dir,
    buildDir,
    http: 1,
    queue: 0,
    schedule: false,
    restart: false,
    shutdownTimeoutMs: 1000,
    binary: false,
  });

  await Bun.sleep(100);
  requestShutdown("test");
  const code = await run;
  expect(code).toBe(0);
  await rm(dir, { recursive: true, force: true });
  resetShutdownForTests();
});
