import { spawn, type Subprocess } from "bun";
import { existsSync, readFileSync, watch } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const port = Number(process.env.PORT ?? loadDotEnv(root).PORT ?? 3000);

/** Parse `.env` / `.env.local` (Bun loads these once at process start). */
function loadDotEnv(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    const path = resolve(dir, name);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  }
  return out;
}

function serverEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...loadDotEnv(root),
    BUNYAD_DEV: "1",
    BUNYAD_HOT: "1",
  };
  // Missing APP_ENV/NODE_ENV is treated as production (snapshot signing, Secure cookies).
  if (!env.APP_ENV && env.NODE_ENV !== "production") {
    env.APP_ENV = "local";
  }
  return env;
}

/** True when nothing is accepting connections on the port. */
async function portFree(p: number): Promise<boolean> {
  try {
    const probe = Bun.listen({
      hostname: "127.0.0.1",
      port: p,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
    });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function waitForPortFree(p: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portFree(p)) return;
    await Bun.sleep(50);
  }
}

/** PIDs with a TCP LISTEN on `p` (macOS/Linux `lsof`). */
async function pidsListeningOn(p: number): Promise<number[]> {
  const proc = spawn({
    cmd: ["lsof", "-nP", `-iTCP:${p}`, "-sTCP:LISTEN", "-t"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Kill anything still bound to the dev port (orphans from a prior Ctrl+C). */
async function freePort(p: number): Promise<void> {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    const pids = await pidsListeningOn(p);
    for (const pid of pids) {
      if (pid === process.pid) continue;
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
    await waitForPortFree(p, signal === "SIGTERM" ? 2000 : 3000);
    if (await portFree(p)) return;
  }
}

async function build(): Promise<boolean> {
  const proc = spawn({
    cmd: ["bun", resolve(root, "scripts/build-frontend.ts")],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await proc.exited) === 0;
}

await freePort(port);
if (!(await build())) process.exit(1);

let server: Subprocess = spawnServer();
let restarting = false;
let pendingRestart: string | undefined;
let building = false;
let envTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;

function spawnServer(): Subprocess {
  // Soft-reload keeps the SSE live-reload socket alive across app edits.
  // Spawn the entry directly so kill() releases port 3000.
  return spawn({
    cmd: ["bun", "--hot", resolve(root, "server.ts")],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: serverEnv(),
  });
}

async function stopServer(proc: Subprocess): Promise<void> {
  try {
    proc.kill("SIGTERM");
  } catch {
    await freePort(port);
    return;
  }

  const exited = await Promise.race([
    proc.exited.then(() => true),
    Bun.sleep(2000).then(() => false),
  ]);

  if (!exited) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    await proc.exited.catch(() => undefined);
  }

  await freePort(port);
}

async function restartServer(reason: string): Promise<void> {
  if (shuttingDown) return;
  if (restarting) {
    pendingRestart = reason;
    return;
  }
  restarting = true;
  try {
    const time = new Date().toLocaleTimeString("en-US", { hour12: true });
    console.log(
      `\n${time} \x1b[32m[bunyad]\x1b[0m restarting server (${reason})\n`,
    );
    const previous = server;
    await stopServer(previous);
    if (shuttingDown) return;
    server = spawnServer();
  } finally {
    restarting = false;
    if (pendingRestart && !shuttingDown) {
      const next = pendingRestart;
      pendingRestart = undefined;
      await restartServer(next);
    }
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopServer(server);
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

const rebuild = async () => {
  if (building || shuttingDown) return;
  building = true;
  try {
    if (!(await build())) return;
    // fs.watch on public/build is unreliable after Bun.build overwrites;
    // tell the server to push an SSE reload explicitly.
    await fetch(`http://127.0.0.1:${port}/__bunyad/reload`, {
      method: "POST",
    }).catch(() => undefined);
  } finally {
    building = false;
  }
};

for (const dir of ["resources/js", "resources/css"]) {
  try {
    watch(resolve(root, dir), { recursive: true }, () => {
      void rebuild();
    });
  } catch {
    // ignore
  }
}

for (const name of [".env", ".env.local"]) {
  const path = resolve(root, name);
  if (!existsSync(path)) continue;
  try {
    watch(path, () => {
      // Editors often emit multiple events per save.
      clearTimeout(envTimer);
      envTimer = setTimeout(() => {
        void restartServer(name);
      }, 200);
    });
  } catch {
    // ignore
  }
}

// Stay alive across server restarts; exit when the child exits on its own
// (crash) and we are not mid-restart / shutting down.
while (true) {
  const current = server;
  const code = await current.exited;
  if (shuttingDown) break;
  if (restarting || current !== server) {
    await Bun.sleep(50);
    continue;
  }
  process.exitCode = code;
  break;
}
