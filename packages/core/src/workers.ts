import { resolve } from "node:path";
import {
  installShutdownHandlers,
  requestShutdown,
  shutdownSignal,
} from "./shutdown.ts";

export type StartWorkersOptions = {
  /** HTTP processes (default 1). Sets `BUNYAD_REUSE_PORT=1` when > 1. */
  http?: number;
  /** Queue worker processes (default 0). */
  queue?: number;
  /** Run one schedule worker (default false). */
  schedule?: boolean;
  /** App cwd (default `process.cwd()`). */
  cwd?: string;
  /** Compiled output dir (default `{cwd}/.build`). */
  buildDir?: string;
  /** Queue name for queue workers (`QUEUE_NAME`). */
  queueName?: string;
  /** Bun binary (default `process.execPath`). */
  bun?: string;
  /**
   * Prefer compiled binaries under `{buildDir}/bin/bunyad-*` when present.
   * Pass `true` to require binaries, or omit to auto-detect.
   */
  binary?: boolean | "auto";
  /** Restart crashed workers until shutdown (default true). */
  restart?: boolean;
  /** Max restarts per worker slot (default 10). */
  maxRestarts?: number;
  /** Wait this many ms after SIGTERM before SIGKILL (default 10_000). */
  shutdownTimeoutMs?: number;
};

type ManifestEntries = {
  entries?: Record<string, string>;
};

type WorkerSlot = {
  role: string;
  id: string;
  entry: string;
  binaryPath?: string;
  env: Record<string, string | undefined>;
  restarts: number;
  proc?: ReturnType<typeof Bun.spawn>;
};

/**
 * Resolve the command used to launch a compiled entry (script or binary).
 * Exported for tests.
 */
export async function resolveWorkerLaunch(
  entryPath: string,
  options: {
    bun: string;
    buildDir: string;
    role: string;
    binary?: boolean | "auto";
  },
): Promise<{ cmd: string[]; mode: "script" | "binary" }> {
  const binaryName = `bunyad-${options.role === "scheduler" ? "scheduler" : options.role}`;
  const binaryPath = resolve(options.buildDir, "bin", binaryName);
  const prefer =
    options.binary === true ||
    options.binary === "auto" ||
    options.binary === undefined;
  const requireBinary = options.binary === true;
  const exists = prefer ? await Bun.file(binaryPath).exists() : false;

  if (requireBinary && !exists) {
    throw new Error(
      `Missing compiled binary [${binaryPath}]. Run \`bunyad compile --binary\`.`,
    );
  }

  if (exists && prefer) {
    return { cmd: [binaryPath], mode: "binary" };
  }

  return { cmd: [options.bun, entryPath], mode: "script" };
}

/**
 * Supervisor: spawn compiled HTTP / queue / scheduler workers and forward shutdown.
 */
export async function startWorkers(
  options: StartWorkersOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const buildDir = options.buildDir ?? resolve(cwd, ".build");
  const httpN = Math.max(0, options.http ?? 1);
  const queueN = Math.max(0, options.queue ?? 0);
  const runSchedule = options.schedule === true;
  const bun = options.bun ?? process.execPath;
  const restart = options.restart !== false;
  const maxRestarts = Math.max(0, options.maxRestarts ?? 10);
  const shutdownTimeoutMs = Math.max(0, options.shutdownTimeoutMs ?? 10_000);
  const binaryMode = options.binary ?? "auto";

  const manifestPath = resolve(buildDir, "manifest.json");
  if (!(await Bun.file(manifestPath).exists())) {
    throw new Error(
      `Missing ${manifestPath}. Run \`bunyad compile\` before \`bunyad workers\`.`,
    );
  }

  const manifest = (await Bun.file(manifestPath).json()) as ManifestEntries;
  const entries = manifest.entries ?? {};

  const resolveEntry = (key: string): string => {
    const rel = entries[key];
    if (!rel) {
      throw new Error(
        `Missing compiled entry [${key}] in .build/manifest.json. Re-run \`bunyad compile\`.`,
      );
    }
    return resolve(buildDir, rel);
  };

  const slots: WorkerSlot[] = [];

  if (httpN > 0) {
    const entry = resolveEntry("http");
    for (let i = 0; i < httpN; i++) {
      slots.push({
        role: "http",
        id: String(i),
        entry,
        env: {
          BUNYAD_REUSE_PORT: httpN > 1 ? "1" : "0",
          BUNYAD_WORKER_ROLE: "http",
          BUNYAD_WORKER_ID: String(i),
        },
        restarts: 0,
      });
    }
  }

  if (queueN > 0) {
    const entry = resolveEntry("queue");
    for (let i = 0; i < queueN; i++) {
      slots.push({
        role: "queue",
        id: `queue-${i}`,
        entry,
        env: {
          QUEUE_NAME: options.queueName ?? "default",
          BUNYAD_WORKER_ROLE: "queue",
          BUNYAD_WORKER_ID: `queue-${i}`,
        },
        restarts: 0,
      });
    }
  }

  if (runSchedule) {
    slots.push({
      role: "scheduler",
      id: "scheduler",
      entry: resolveEntry("scheduler"),
      env: {
        BUNYAD_WORKER_ROLE: "scheduler",
        BUNYAD_WORKER_ID: "scheduler",
      },
      restarts: 0,
    });
  }

  if (slots.length === 0) {
    throw new Error(
      "No workers requested. Pass --http=N, --queue=N, and/or --schedule.",
    );
  }

  let shuttingDown = false;
  let exitCode = 0;

  const spawnSlot = async (slot: WorkerSlot): Promise<void> => {
    const launch = await resolveWorkerLaunch(slot.entry, {
      bun,
      buildDir,
      role: slot.role,
      binary: binaryMode,
    });
    if (launch.mode === "binary") {
      slot.binaryPath = launch.cmd[0];
    }

    const proc = Bun.spawn({
      cmd: launch.cmd,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        BUNYAD_DEV: "0",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        ...slot.env,
      },
    });
    slot.proc = proc;

    void proc.exited.then(async (code) => {
      slot.proc = undefined;
      if (code !== 0) exitCode = code;

      if (shuttingDown) return;

      if (!restart || slot.restarts >= maxRestarts) {
        if (restart && slot.restarts >= maxRestarts) {
          console.error(
            `  ERROR  Worker ${slot.role}#${slot.id} exceeded max restarts (${maxRestarts}).`,
          );
        }
        // If every slot is idle, shut the supervisor down.
        if (slots.every((s) => !s.proc)) {
          requestShutdown("workers-exhausted");
        }
        return;
      }

      slot.restarts += 1;
      console.log(
        `  INFO  Restarting ${slot.role}#${slot.id} (restart ${slot.restarts}/${maxRestarts}, exit ${code}).`,
      );
      await spawnSlot(slot);
    });
  };

  for (const slot of slots) {
    await spawnSlot(slot);
  }

  const modes = await Promise.all(
    slots.map(async (slot) => {
      const launch = await resolveWorkerLaunch(slot.entry, {
        bun,
        buildDir,
        role: slot.role,
        binary: binaryMode,
      });
      return launch.mode;
    }),
  );
  const binaryCount = modes.filter((m) => m === "binary").length;

  console.log("");
  console.log(
    `  INFO  Started ${slots.length} worker(s) (http=${httpN}, queue=${queueN}, schedule=${runSchedule ? 1 : 0}${binaryCount ? `, binary=${binaryCount}` : ""}).`,
  );
  console.log(
    `  INFO  Restart=${restart ? `on (max ${maxRestarts})` : "off"}; shutdown timeout=${shutdownTimeoutMs}ms`,
  );
  console.log("  Press Ctrl+C to stop");
  console.log("");

  const signal = installShutdownHandlers();

  const killAll = async (force = false) => {
    shuttingDown = true;
    const sig = force ? "SIGKILL" : "SIGTERM";
    for (const slot of slots) {
      const child = slot.proc;
      if (!child) continue;
      try {
        child.kill(sig);
      } catch {
        // already exited
      }
    }
  };

  const waitForExitOrTimeout = async (): Promise<void> => {
    const pending = slots
      .map((s) => s.proc)
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => p.exited);
    if (pending.length === 0) return;

    await Promise.race([
      Promise.all(pending),
      Bun.sleep(shutdownTimeoutMs).then(() => undefined),
    ]);

    const stillAlive = slots.some((s) => s.proc != null);
    if (stillAlive) {
      console.log("  INFO  Forcing remaining workers (SIGKILL)…");
      await killAll(true);
      await Promise.all(
        slots
          .map((s) => s.proc)
          .filter((p): p is NonNullable<typeof p> => p != null)
          .map((p) => p.exited),
      );
    }
  };

  await new Promise<void>((resolvePromise) => {
    const run = () => {
      void (async () => {
        if (!shuttingDown) {
          console.log("  INFO  Shutting down workers…");
        }
        await killAll(false);
        await waitForExitOrTimeout();
        resolvePromise();
      })();
    };
    if (signal.aborted) run();
    else signal.addEventListener("abort", run, { once: true });
  });

  requestShutdown("workers-exited");
  return exitCode;
}

export {
  installShutdownHandlers,
  onShutdown,
  requestShutdown,
  shutdownSignal,
} from "./shutdown.ts";
