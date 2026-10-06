import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  connectFromEnv,
  migrate,
  rollback,
  fresh,
  status,
  wipe,
  setDefaultConnection,
} from "@bunyad/database";
import { Crypt } from "@bunyad/common";
import { compile } from "@bunyad/compiler";
import { createViewPlugin } from "@bunyad/view";
import { getQueue } from "@bunyad/queue";
import {
  getSchedule,
  setScheduleCommandRunner,
} from "@bunyad/schedule";
import { Route, loadRouteModule } from "@bunyad/router";
import {
  installShutdownHandlers,
  shutdownSignal,
  startWorkers,
} from "@bunyad/core";
import { makeCommands } from "./make.ts";
import { migrateConvert, migrateReport } from "./migrate.ts";
import { writeAppKey } from "./key.ts";
import { newProject } from "./new.ts";
import {
  describeAppCommands,
  loadAppCommandHandlers,
} from "./app-commands.ts";
import {
  getClosureCommandHandlers,
  getProviderCommandHandlers,
} from "./command-registry.ts";
import { setCommandRunner } from "./command.ts";

function argValue(args: string[], flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

function cliMigrationsPath(args: string[]): string {
  return resolve(process.cwd(), argValue(args, "--path") ?? "database/migrations");
}

/** Env for `bunyad serve`. Unset APP_ENV would otherwise be treated as production. */
function devServeEnv(hot = false): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    BUNYAD_DEV: "1",
    ...(hot ? { BUNYAD_HOT: "1" } : {}),
  };
  if (!env.APP_ENV && env.NODE_ENV !== "production") {
    env.APP_ENV = "local";
  }
  return env;
}

function openCliConnection() {
  const root = process.cwd();
  const env = { ...process.env };
  if (!env.DB_CONNECTION || env.DB_CONNECTION === "sqlite") {
    if (!env.DATABASE_PATH && !env.DB_DATABASE) {
      env.DATABASE_PATH = resolve(root, "database/database.sqlite");
    }
  }
  const connection = connectFromEnv(env);
  setDefaultConnection(connection);
  return connection;
}

async function bootApp() {
  const { createApplication } = await import(
    resolve(process.cwd(), "bootstrap/app.ts")
  );
  await createApplication();
}

async function loadConsoleSchedule() {
  const appHandlers = await loadAppCommandHandlers();
  const closures = getClosureCommandHandlers();
  const providers = getProviderCommandHandlers();
  const merged = { ...commands, ...providers, ...appHandlers, ...closures };
  setScheduleCommandRunner(async (command, args) => {
    const handler = merged[command];
    if (!handler) {
      throw new Error(`Command "${command}" is not defined.`);
    }
    await handler(args);
  });

  const consoleEntry = resolve(process.cwd(), "routes/console.ts");
  try {
    getSchedule().clear();
    const mod = await import(consoleEntry);
    mod.registerSchedule?.();
    mod.registerCommands?.();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "ERR_MODULE_NOT_FOUND"
    ) {
      return;
    }
    // Bun may throw with message containing "Cannot find module"
    if (
      error instanceof Error &&
      /Cannot find module|Unable to resolve/.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async list() {
    console.log("Usage: bunyad <command> [options]   (bunyad <command> --help for one command)");
    console.log("");
    console.log("Available commands:");
    console.log("  serve          Start the HTTP server (dev)");
    console.log("                 --hot    Soft-reload with bun --hot");
    console.log("                 --watch  Restart process on file changes");
    console.log("  console        Interactive shell");
    console.log("  compile        Compile app into .build/ (radix optimize on; --no-optimize, --binary)");
    console.log("                 --binary  Single .build/bin/bunyad [http|queue|scheduler]");
    console.log("                 --with-sqlsrv / --with-inertia-ssr  Keep optional deps in binary");
    console.log("  start          Run compiled entry (default http)");
    console.log("                 --entry=http|queue|scheduler");
    console.log("                 --workers=N  HTTP cluster (SO_REUSEPORT)");
    console.log("  workers        Production supervisor (http/queue/schedule)");
    console.log("                 --http=N --queue=N --schedule --queue-name=");
    console.log(
      "                 --binary|--no-binary --no-restart --max-restarts=N",
    );
    console.log("                 --shutdown-timeout=SEC");
    console.log("  inertia:start-ssr  Start the Inertia SSR server (bootstrap/ssr.js)");
    console.log("  features:purge Purge stored feature flag values");
    console.log("  migrate        Run database migrations (--path=)");
    console.log("  migrate:rollback  Roll back the last migration batch (--step --path=)");
    console.log("  migrate:fresh     Drop all tables and re-run migrations (--path=)");
    console.log("  migrate:status    Show migration status (--path=)");
    console.log("  key:generate   Set APP_KEY in .env (--show --force)");
    console.log("  db:seed        Seed the database");
    console.log("  db:wipe        Drop all tables");
    console.log("  queue:work     Process queued jobs");
    console.log("  queue:failed   List failed jobs");
    console.log("  queue:retry    Retry a failed job (or --all)");
    console.log("  queue:flush    Delete all failed jobs");
    console.log("  queue:status   Show pending / failed job counts");
    console.log("  schedule:run   Run due scheduled events");
    console.log("  schedule:work  Run scheduler daemon (every minute)");
    console.log("  schedule:list  List scheduled events");
    console.log("  route:list     List registered routes (--json --method= --name= --path=)");
    console.log("  types:generate Write typed routes, shared props, and page props (--watch)");
    console.log("  route:cache    Cache routes to .build/routes.json");
    console.log("  route:clear    Clear the route cache");
    console.log("  config:cache   Cache config to .build/config.json");
    console.log("  config:clear   Clear the config cache");
    console.log("  optimize       Cache config + routes and compile views");
    console.log("  optimize:clear Clear config/route/view caches (+ flush app cache)");
    console.log("  view:cache     Compile views to .build/views");
    console.log("  view:clear     Clear compiled views");
    console.log("  event:list     List registered event listeners");
    console.log("  publish       Publish provider assets/config into the app");
    console.log("  model:prune    Prune models that use @Prunable / @MassPrunable");
    console.log("  storage:link   Symlink public/storage → storage/app/public");
    console.log(
      "  make:*         controller|model|mailable|job|middleware|notification|event|listener|request|resource|migration|seeder|factory|policy|command|test|provider",
    );
    console.log("  list           List commands");
    console.log("  about          Environment information (--json)");
    console.log("  new            Create an app from a starter kit (views|live|react|vue|svelte|api)");
    console.log("  migrate:report Scan PHP project for Bunyad compatibility");
    console.log("  migrate:convert Emit TS controller stub from a PHP file");
    const appCommands = await describeAppCommands();
    if (appCommands.length > 0) {
      console.log("");
      console.log("Application commands:");
      for (const row of appCommands) {
        const desc = row.description ? `  ${row.description}` : "";
        console.log(`  ${row.name.padEnd(16)}${desc}`.trimEnd());
      }
    }
  },

  async serve(args) {
    const serverEntry = resolve(process.cwd(), "server.ts");
    const hot = args.includes("--hot");
    const watch = args.includes("--watch");

    if (hot || watch) {
      const flag = hot ? "--hot" : "--watch";
      const proc = Bun.spawn({
        cmd: ["bun", flag, serverEntry],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
        env: devServeEnv(hot),
      });
      // Forward termination to the server so it is never orphaned holding the
      // port. `bun --hot` can ignore SIGTERM/SIGINT, so escalate to SIGKILL.
      const forward = (signal: NodeJS.Signals) => () => {
        proc.kill(signal);
        setTimeout(() => proc.kill("SIGKILL"), 1500);
      };
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(signal, forward(signal));
      }
      process.on("exit", () => proc.kill());
      const code = await proc.exited;
      process.exitCode = code;
      return;
    }

    const env = devServeEnv(false);
    process.env.BUNYAD_DEV = env.BUNYAD_DEV;
    if (env.APP_ENV !== undefined) process.env.APP_ENV = env.APP_ENV;
    await import(serverEntry);
  },

  async console() {
    await bootApp();
    const { startConsole } = await import("@bunyad/console");
    await startConsole({
      banner: [
        "Bunyad console ready.",
        "(Restart after changing app code.)",
        "Exit: .exit or Ctrl+D",
      ].join("\n"),
    });
  },

  async compile(args) {
    const root = process.cwd();
    const { access } = await import("node:fs/promises");
    const routesEntries: string[] = [];
    for (const name of ["web.ts", "api.ts"]) {
      const path = resolve(root, "routes", name);
      try {
        await access(path);
        routesEntries.push(path);
      } catch {
        // optional entry
      }
    }
    if (routesEntries.length === 0) {
      console.error("No routes/web.ts or routes/api.ts found.");
      process.exitCode = 1;
      return;
    }

    // Radix optimize on by default; `--no-optimize` for debug linear matching.
    const optimize = !args.includes("--no-optimize");
    const binary = args.includes("--binary");
    const withSqlsrv = args.includes("--with-sqlsrv");
    const withInertiaSsr = args.includes("--with-inertia-ssr");

    const manifest = await compile({
      root,
      appName: "app",
      routesEntries,
      optimize,
      plugins: [createViewPlugin()],
      bootstrap: {
        applicationModule: resolve(root, "bootstrap/app.ts"),
      },
    });
    const routeCount =
      (manifest.meta.router as { count: number } | undefined)?.count ?? 0;
    const viewCount =
      (manifest.meta.view as { count: number } | undefined)?.count ?? 0;
    console.log(
      `Compiled ${routeCount} routes → .build/${optimize ? " (optimized)" : ""}`,
    );
    if (viewCount > 0) {
      console.log(`Compiled ${viewCount} views → .build/views/`);
    }
    const entryNames = Object.keys(manifest.entries);
    if (entryNames.length) {
      console.log(
        `Entries: ${entryNames.map((k) => `${k}=${manifest.entries[k]}`).join(", ")}`,
      );
    }
    console.log(`Entry: ${manifest.entries.http}`);

    if (binary) {
      await compileBinaries(root, manifest.entries, {
        withSqlsrv,
        withInertiaSsr,
      });
    }
  },

  async start(args) {
    const workersIdx = args.findIndex((a) => a.startsWith("--workers"));
    let httpWorkers: number | undefined;
    if (workersIdx !== -1) {
      const raw = args[workersIdx]!;
      httpWorkers = raw.includes("=")
        ? Number(raw.split("=")[1] ?? 1)
        : Number(args[workersIdx + 1] ?? 1);
    }

    if (httpWorkers != null && !Number.isNaN(httpWorkers) && httpWorkers > 0) {
      const code = await startWorkers({
        http: httpWorkers,
        queue: 0,
        schedule: false,
      });
      process.exitCode = code;
      return;
    }

    const entryArg = args.find((a) => a.startsWith("--entry"));
    let entryKey = "http";
    if (entryArg) {
      entryKey = entryArg.includes("=")
        ? (entryArg.split("=")[1] ?? "http")
        : (args[args.indexOf(entryArg) + 1] ?? "http");
    }

    const buildDir = resolve(process.cwd(), ".build");
    const manifestPath = resolve(buildDir, "manifest.json");
    let entryPath = resolve(buildDir, "server.ts");

    if (await Bun.file(manifestPath).exists()) {
      const manifest = (await Bun.file(manifestPath).json()) as {
        entries?: Record<string, string>;
      };
      const rel = manifest.entries?.[entryKey];
      if (!rel) {
        console.error(
          `Unknown entry [${entryKey}]. Available: ${Object.keys(manifest.entries ?? {}).join(", ") || "(none)"}`,
        );
        process.exitCode = 1;
        return;
      }
      entryPath = resolve(buildDir, rel);
    } else if (entryKey !== "http") {
      console.error("Missing .build/manifest.json. Run `bunyad compile` first.");
      process.exitCode = 1;
      return;
    }

    process.env.NODE_ENV ??= "production";
    await import(entryPath);
  },

  async workers(args) {
    const http = flagNumber(args, "--http", 1);
    const queue = flagNumber(args, "--queue", 0);
    const queueName = flagString(args, "--queue-name") ?? "default";
    const schedule = args.includes("--schedule");
    const binary = args.includes("--binary")
      ? true
      : args.includes("--no-binary")
        ? false
        : "auto";
    const restart = !args.includes("--no-restart");
    const maxRestarts = flagNumber(args, "--max-restarts", 10);
    const shutdownTimeoutMs =
      flagNumber(args, "--shutdown-timeout", 10) * 1000;

    try {
      const code = await startWorkers({
        http,
        queue,
        schedule,
        queueName,
        binary,
        restart,
        maxRestarts,
        shutdownTimeoutMs,
      });
      process.exitCode = code;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },

  async "inertia:start-ssr"(args) {
    const entry =
      flagString(args, "--entry") ??
      resolve(process.cwd(), "bootstrap/ssr.js");
    if (!(await Bun.file(entry).exists())) {
      console.error(
        `SSR bundle not found at ${entry}. Run \`bun scripts/build-ssr.ts\` first.`,
      );
      process.exitCode = 1;
      return;
    }
    const port = flagString(args, "--port");
    const proc = Bun.spawn({
      cmd: [process.execPath, entry],
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        ...(port ? { PORT: port, INERTIA_SSR_PORT: port } : {}),
      },
    });
    process.exitCode = await proc.exited;
  },

  async "features:purge"(args) {
    await bootApp();
    const { Feature } = await import("@bunyad/features");
    if (args.length === 0) {
      await Feature.purge();
      console.log("Purged all feature values.");
      return;
    }
    await Feature.purge(args);
    console.log(`Purged: ${args.join(", ")}`);
  },

  async migrate(args) {
    const connection = openCliConnection();
    const applied = await migrate(connection, cliMigrationsPath(args));
    if (applied.length === 0) {
      console.log("Nothing to migrate.");
    } else {
      for (const file of applied) console.log(`Migrated: ${file}`);
    }
    await connection.close();
  },

  async "migrate:rollback"(args) {
    const stepRaw = argValue(args, "--step");
    const steps = stepRaw != null ? Number(stepRaw) : 1;
    const connection = openCliConnection();
    const rolled = await rollback(
      connection,
      cliMigrationsPath(args),
      steps,
    );
    if (rolled.length === 0) {
      console.log("Nothing to rollback.");
    } else {
      for (const file of rolled) console.log(`Rolled back: ${file}`);
    }
    await connection.close();
  },

  async "migrate:fresh"(args) {
    const seed = args.includes("--seed");
    const connection = openCliConnection();
    const applied = await fresh(connection, cliMigrationsPath(args));
    for (const file of applied) console.log(`Migrated: ${file}`);
    await connection.close();

    if (seed) {
      await commands["db:seed"]([]);
    }
  },

  async "migrate:status"(args) {
    const connection = openCliConnection();
    const rows = await status(connection, cliMigrationsPath(args));
    await connection.close();

    if (rows.length === 0) {
      console.log("No migrations found.");
      return;
    }

    const nameWidth = Math.max(...rows.map((r) => r.migration.length), 9);
    console.log(`${"Migration".padEnd(nameWidth)}  Batch / Status`);
    console.log(`${"-".repeat(nameWidth)}  -------------`);
    for (const row of rows) {
      const label =
        row.batch != null ? `Batch ${row.batch}` : "Pending";
      console.log(`${row.migration.padEnd(nameWidth)}  ${label}`);
    }
  },

  async "key:generate"(args) {
    if (args.includes("--show")) {
      console.log(Crypt.generateKey());
      return;
    }
    const { key, written } = await writeAppKey(process.cwd(), {
      force: args.includes("--force"),
    });
    console.log(
      written
        ? "Application key set."
        : `Application key already set (${key.slice(0, 12)}…). Use --force to replace it.`,
    );
  },

  async "db:seed"(args) {
    const classIdx = args.indexOf("--class");
    const seederName =
      classIdx !== -1 ? (args[classIdx + 1] ?? "DatabaseSeeder") : "DatabaseSeeder";

    await bootApp();

    const seederPath = resolve(
      process.cwd(),
      "database/seeders",
      `${seederName}.ts`,
    );
    try {
      const mod = await import(seederPath);
      const Ctor = mod.default as new () => { run(): void | Promise<void> };
      if (!Ctor) {
        console.error(`Seeder [${seederName}] has no default export.`);
        process.exitCode = 1;
        return;
      }
      await new Ctor().run();
      console.log(`Database seeded: ${seederName}`);
    } catch (error) {
      if (
        error instanceof Error &&
        /Cannot find module|Unable to resolve/.test(error.message)
      ) {
        console.error(`Seeder not found: database/seeders/${seederName}.ts`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  },

  async "db:wipe"(args) {
    const seed = args.includes("--seed");
    const dropViews = args.includes("--drop-views");
    void dropViews;
    const connection = openCliConnection();
    const dropped = await wipe(connection);
    await connection.close();
    if (dropped.length === 0) {
      console.log("No tables to drop.");
    } else {
      for (const table of dropped) console.log(`Dropped: ${table}`);
    }
    if (seed) {
      await commands.migrate([]);
      await commands["db:seed"]([]);
    }
  },

  async "storage:link"(args) {
    const { mkdir, symlink, lstat, rm } = await import("node:fs/promises");
    const root = process.cwd();
    const target = resolve(root, "storage/app/public");
    const link = resolve(root, "public/storage");
    const force = args.includes("--force");

    await mkdir(target, { recursive: true });
    await mkdir(resolve(root, "public"), { recursive: true });

    try {
      const existing = await lstat(link);
      if (existing.isSymbolicLink() || existing.isDirectory()) {
        if (!force) {
          console.log(`The [${link}] link already exists.`);
          return;
        }
        await rm(link, { recursive: true, force: true });
      }
    } catch {
      // missing
    }

    await symlink(target, link, "dir");
    console.log(
      "The [public/storage] link has been connected to [storage/app/public].",
    );
  },

  async "queue:work"(args) {
    const once = args.includes("--once");
    const sleepIdx = args.indexOf("--sleep");
    const sleep =
      sleepIdx !== -1 ? Number(args[sleepIdx + 1] ?? 1) * 1000 : 1000;
    const queueIdx = args.indexOf("--queue");
    const queueName =
      queueIdx !== -1 ? (args[queueIdx + 1] ?? "default") : "default";
    const triesIdx = args.indexOf("--tries");
    const tries =
      triesIdx !== -1 ? Number(args[triesIdx + 1] ?? 1) : undefined;
    const timeoutIdx = args.indexOf("--timeout");
    const timeout =
      timeoutIdx !== -1 ? Number(args[timeoutIdx + 1] ?? 60) : undefined;

    await bootApp();
    const queue = getQueue();
    if (tries !== undefined && Number.isFinite(tries)) {
      queue.tries = tries;
    }
    installShutdownHandlers();

    console.log(
      `queue:work starting (connection=${process.env.QUEUE_CONNECTION ?? "sync"}, queue=${queueName}${once ? ", once" : ""}${tries !== undefined ? `, tries=${tries}` : ""}${timeout !== undefined ? `, timeout=${timeout}` : ""})`,
    );

    const total = await queue.daemon({
      queue: queueName,
      sleep,
      once,
      timeout,
      signal: once ? undefined : shutdownSignal(),
    });

    if (once) {
      console.log(`Processed ${total} job(s).`);
    }
  },

  async "queue:failed"() {
    await bootApp();
    const failed = getQueue().failed;
    if (!failed) {
      console.log("No failed job repository configured.");
      return;
    }
    const jobs = await failed.all();
    if (jobs.length === 0) {
      console.log("No failed jobs.");
      return;
    }
    console.log("UUID                                  Queue    Job");
    console.log("------------------------------------  -------  ---");
    for (const job of jobs) {
      console.log(
        `${job.id.padEnd(38)}${job.queue.padEnd(9)}${job.payload.name}`,
      );
    }
  },

  async "queue:retry"(args) {
    await bootApp();
    const queue = getQueue();
    if (args.includes("--all")) {
      const n = await queue.retryAll();
      console.log(`Retried ${n} job(s).`);
      return;
    }
    const id = args[0];
    if (!id) {
      console.error("Usage: queue:retry <uuid> | queue:retry --all");
      process.exitCode = 1;
      return;
    }
    const ok = await queue.retry(id);
    console.log(ok ? `Retried ${id}.` : `Failed job [${id}] not found.`);
    if (!ok) process.exitCode = 1;
  },

  async "queue:flush"() {
    await bootApp();
    const failed = getQueue().failed;
    if (!failed) {
      console.log("No failed job repository configured.");
      return;
    }
    await failed.flush();
    console.log("All failed jobs deleted.");
  },

  async "queue:status"(args) {
    await bootApp();
    const queue = getQueue();
    const name = args[0] ?? "default";
    const pending = await queue.size(name);
    const failed = queue.failed ? (await queue.failed.all()).length : 0;
    console.log(`Queue [${name}]`);
    console.log(`  pending: ${pending}`);
    console.log(`  failed:  ${failed}`);
  },

  async "schedule:run"() {
    await bootApp();
    await loadConsoleSchedule();
    const ran = await getSchedule().run();
    console.log(`Ran ${ran} scheduled event(s).`);
  },

  async "schedule:work"(args) {
    const once = args.includes("--once");
    await bootApp();
    await loadConsoleSchedule();
    installShutdownHandlers();
    console.log(
      `schedule:work starting${once ? " (once)" : " (daemon, every minute)"}`,
    );
    await getSchedule().work({
      once,
      signal: once ? undefined : shutdownSignal(),
      onTick: (ran) => {
        if (ran > 0) console.log(`Ran ${ran} scheduled event(s).`);
      },
    });
  },

  async "schedule:list"() {
    await bootApp();
    await loadConsoleSchedule();
    const events = getSchedule().list();
    if (events.length === 0) {
      console.log("No scheduled events.");
      return;
    }
    console.log("Expression           Next Run              Description");
    console.log("-------------------  --------------------  -----------");
    for (const event of events) {
      const next = event.nextRun
        ? new Date(event.nextRun).toISOString().replace("T", " ").slice(0, 19)
        : "-";
      console.log(
        `${event.expression.padEnd(20)}${next.padEnd(22)}${event.description}`,
      );
    }
  },

  async "types:generate"(args) {
    if (args.includes("--watch")) return watchTypes();
    const { access } = await import("node:fs/promises");
    const { generateTypes, writeGenerated } = await import("./types-generate.ts");
    Route.clear();
    const root = process.cwd();
    for (const name of ["web.ts", "api.ts"]) {
      const routesEntry = resolve(root, "routes", name);
      try {
        await access(routesEntry);
      } catch {
        continue;
      }
      await loadRouteModule(routesEntry, Route);
    }
    const named: Record<string, string> = {};
    for (const route of Route.routes) {
      if (route.name) named[route.name] = route.uri.startsWith("/") ? route.uri : `/${route.uri}`;
    }

    const files = await generateTypes(root, named);
    const written = await writeGenerated(root, files);
    for (const file of files) {
      console.log(`  ${written.includes(file.path) ? "wrote    " : "unchanged"} ${file.path}`);
    }
  },

  async "route:list"(args) {
    const { access } = await import("node:fs/promises");
    Route.clear();
    const root = process.cwd();
    for (const name of ["web.ts", "api.ts"]) {
      const routesEntry = resolve(root, "routes", name);
      try {
        await access(routesEntry);
      } catch {
        continue;
      }
      await loadRouteModule(routesEntry, Route);
    }

    const asJson = args.includes("--json");
    const methodFilter = (flagString(args, "--method") ?? "").toUpperCase();
    const nameFilter = flagString(args, "--name") ?? "";
    const pathFilter = flagString(args, "--path") ?? "";

    type Row = {
      method: string;
      uri: string;
      name: string;
      action: string;
      middleware: string;
    };

    const formatAction = (route: (typeof Route.routes)[number]): string => {
      if (Array.isArray(route.action)) {
        const [ctrl, method] = route.action;
        const name =
          typeof ctrl === "function"
            ? ctrl.name || "Controller"
            : String(ctrl);
        return `${name}@${String(method)}`;
      }
      if (typeof route.action === "string") return route.action;
      return "Closure";
    };

    const formatMiddleware = (route: (typeof Route.routes)[number]): string => {
      // Prefer string aliases. Tagged factories without alias are omitted.
      return route.middleware
        .filter((mw): mw is string => typeof mw === "string")
        .join(",");
    };

    let rows: Row[] = Route.routes.map((route) => ({
      method: route.methods.filter((m) => m !== "HEAD").join("|"),
      uri: route.uri,
      name: route.name ?? "",
      action: formatAction(route),
      middleware: formatMiddleware(route),
    }));

    if (methodFilter) {
      rows = rows.filter((r) => r.method.includes(methodFilter));
    }
    if (nameFilter) {
      rows = rows.filter((r) => r.name.includes(nameFilter));
    }
    if (pathFilter) {
      rows = rows.filter((r) => r.uri.includes(pathFilter));
    }

    if (asJson) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log("Your application has no matching routes.");
      return;
    }

    const headers = ["Method", "URI", "Name", "Action", "Middleware"] as const;
    const keys = ["method", "uri", "name", "action", "middleware"] as const;
    const widths = keys.map((key, i) =>
      Math.max(headers[i]!.length, ...rows.map((r) => r[key].length)),
    );

    console.log(headers.map((h, i) => h.padEnd(widths[i]!)).join("  "));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of rows) {
      console.log(keys.map((k, i) => row[k].padEnd(widths[i]!)).join("  "));
    }
  },

  async "route:cache"() {
    const { mkdir, access } = await import("node:fs/promises");
    Route.clear();
    const root = process.cwd();
    for (const name of ["web.ts", "api.ts"]) {
      const routesEntry = resolve(root, "routes", name);
      try {
        await access(routesEntry);
      } catch {
        continue;
      }
      await loadRouteModule(routesEntry, Route);
    }

    const payload = Route.routes.map((route) => {
      let action = "[closure]";
      if (Array.isArray(route.action)) {
        const [ctrl, method] = route.action;
        const name =
          typeof ctrl === "function"
            ? ctrl.name || "Controller"
            : String(ctrl);
        action = `${name}@${String(method)}`;
      } else if (typeof route.action === "string") {
        action = route.action;
      }
      return {
        methods: route.methods.filter((m) => m !== "HEAD"),
        uri: route.uri,
        name: route.name ?? null,
        action,
      };
    });

    const outDir = resolve(process.cwd(), ".build");
    await mkdir(outDir, { recursive: true });
    const out = resolve(outDir, "routes.json");
    await Bun.write(out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Routes cached: ${payload.length} → .build/routes.json`);
  },

  async "route:clear"() {
    const { unlink } = await import("node:fs/promises");
    const out = resolve(process.cwd(), ".build/routes.json");
    try {
      await unlink(out);
      console.log("Route cache cleared.");
    } catch {
      console.log("Route cache was not present.");
    }
  },

  async "config:cache"() {
    const { mkdir, readdir } = await import("node:fs/promises");
    const configDir = resolve(process.cwd(), "config");
    const items: Record<string, unknown> = {};

    try {
      const files = await readdir(configDir);
      for (const file of files) {
        if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
        const key = file.replace(/\.(ts|js)$/, "");
        const mod = await import(resolve(configDir, file));
        items[key] = mod.default ?? mod;
      }
    } catch {
      console.error("No config/ directory found.");
      process.exitCode = 1;
      return;
    }

    const outDir = resolve(process.cwd(), ".build");
    await mkdir(outDir, { recursive: true });
    const out = resolve(outDir, "config.json");
    await Bun.write(out, `${JSON.stringify(items, null, 2)}\n`);
    console.log(
      `Configuration cached (${Object.keys(items).length} file(s)) → .build/config.json`,
    );
  },

  async "config:clear"() {
    const { unlink } = await import("node:fs/promises");
    const out = resolve(process.cwd(), ".build/config.json");
    try {
      await unlink(out);
      console.log("Configuration cache cleared.");
    } catch {
      console.log("Configuration cache was not present.");
    }
  },

  async optimize() {
    await commands["config:cache"]!([]);
    await commands["route:cache"]!([]);

    const { access, mkdir } = await import("node:fs/promises");
    const root = process.cwd();
    const viewsDir = resolve(root, "resources/views");
    try {
      await access(viewsDir);
    } catch {
      console.log("No resources/views — skipping view compile.");
      console.log("Optimized.");
      return;
    }

    const routesEntries: string[] = [];
    for (const name of ["web.ts", "api.ts"]) {
      const path = resolve(root, "routes", name);
      try {
        await access(path);
        routesEntries.push(path);
      } catch {
        // optional
      }
    }

    await mkdir(resolve(root, ".build"), { recursive: true });
    if (routesEntries.length === 0) {
      console.log("No routes/web.ts or routes/api.ts — skipping view compile.");
      console.log("Optimized.");
      return;
    }

    const manifest = await compile({
      root,
      appName: "app",
      routesEntries,
      optimize: true,
      plugins: [createViewPlugin()],
      bootstrap: {
        applicationModule: resolve(root, "bootstrap/app.ts"),
      },
    });
    const viewCount =
      (manifest.meta.view as { count: number } | undefined)?.count ?? 0;
    console.log(`Compiled ${viewCount} views → .build/views/`);
    console.log("Optimized.");
  },

  async "optimize:clear"() {
    const { rm, unlink } = await import("node:fs/promises");
    const root = process.cwd();
    for (const rel of [".build/config.json", ".build/routes.json"]) {
      try {
        await unlink(resolve(root, rel));
        console.log(`Removed ${rel}`);
      } catch {
        // absent is fine
      }
    }
    try {
      await rm(resolve(root, ".build/views"), { recursive: true, force: true });
      console.log("Removed .build/views");
    } catch {
      // absent is fine
    }
    try {
      await unlink(resolve(root, ".build/events.json"));
      console.log("Removed .build/events.json");
    } catch {
      // absent is fine
    }
    try {
      await bootApp();
      const { Cache } = await import("@bunyad/cache");
      await Cache.flush();
      console.log("Application cache flushed.");
    } catch {
      // cache optional
    }
    console.log("Caches cleared.");
  },

  async "view:cache"() {
    const { access, mkdir } = await import("node:fs/promises");
    const root = process.cwd();
    const routesEntries: string[] = [];
    for (const name of ["web.ts", "api.ts"]) {
      const path = resolve(root, "routes", name);
      try {
        await access(path);
        routesEntries.push(path);
      } catch {
        // optional
      }
    }
    await mkdir(resolve(root, ".build"), { recursive: true });
    if (routesEntries.length === 0) {
      console.log("No routes/web.ts or routes/api.ts — nothing to compile.");
      return;
    }
    const manifest = await compile({
      root,
      appName: "app",
      routesEntries,
      optimize: true,
      plugins: [createViewPlugin()],
      bootstrap: {
        applicationModule: resolve(root, "bootstrap/app.ts"),
      },
    });
    const viewCount =
      (manifest.meta.view as { count: number } | undefined)?.count ?? 0;
    console.log(`Compiled ${viewCount} views → .build/views/`);
  },

  async "view:clear"() {
    const { rm } = await import("node:fs/promises");
    try {
      await rm(resolve(process.cwd(), ".build/views"), {
        recursive: true,
        force: true,
      });
      console.log("Compiled views cleared.");
    } catch {
      console.log("Compiled views were not present.");
    }
  },

  async "event:list"() {
    await bootApp();
    const { getEventDispatcher } = await import("@bunyad/events");
    const dispatcher = getEventDispatcher();
    const raw = dispatcher.getRawListeners?.() ?? {};
    const entries = Object.entries(raw as Record<string, unknown[]>);
    if (entries.length === 0) {
      console.log("No event listeners registered.");
      return;
    }
    for (const [event, listeners] of entries) {
      console.log(event);
      for (const listener of listeners) {
        const label =
          typeof listener === "function"
            ? listener.name || "(anonymous)"
            : String(listener);
        console.log(`  - ${label}`);
      }
    }
  },

  async "event:cache"() {
    await bootApp();
    const { mkdir } = await import("node:fs/promises");
    const { getEventDispatcher } = await import("@bunyad/events");
    const dispatcher = getEventDispatcher();
    const raw = dispatcher.getRawListeners?.() ?? {};
    const serialized: Record<string, string[]> = {};
    for (const [event, listeners] of Object.entries(
      raw as Record<string, unknown[]>,
    )) {
      serialized[event] = listeners.map((listener) =>
        typeof listener === "function"
          ? listener.name || "(anonymous)"
          : String(listener),
      );
    }
    await mkdir(resolve(process.cwd(), ".build"), { recursive: true });
    await Bun.write(
      resolve(process.cwd(), ".build/events.json"),
      `${JSON.stringify(serialized, null, 2)}\n`,
    );
    console.log(
      `Events cached (${Object.keys(serialized).length} event(s)) → .build/events.json`,
    );
  },

  async "event:clear"() {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(resolve(process.cwd(), ".build/events.json"));
      console.log("Event cache cleared.");
    } catch {
      console.log("Event cache was not present.");
    }
  },

  async publish(args) {
    await bootApp();
    const { cp, mkdir } = await import("node:fs/promises");
    const { app } = await import("@bunyad/core");
    type PublishEntry = { group: string; from: string; to: string };
    const entries = app().has("bunyad.publishing")
      ? app().make<PublishEntry[]>("bunyad.publishing")
      : [];
    const tag = flagString(args, "--tag") ?? flagString(args, "--provider");
    const force = args.includes("--force");
    const filtered = tag
      ? entries.filter((e) => e.group === tag)
      : entries;
    if (filtered.length === 0) {
      console.log("Nothing to publish.");
      return;
    }
    const root = process.cwd();
    for (const entry of filtered) {
      const from = resolve(root, entry.from);
      const to = resolve(root, entry.to);
      await mkdir(resolve(to, ".."), { recursive: true });
      try {
        await cp(from, to, { recursive: true, force });
        console.log(`Copied ${entry.from} → ${entry.to}`);
      } catch (error) {
        console.error(`Failed to publish ${entry.from}: ${error}`);
        process.exitCode = 1;
      }
    }
  },

  async "model:prune"(args) {
    await bootApp();
    const { Glob } = await import("bun");
    const modelsGlob = new Glob("app/Models/**/*.{ts,js}");
    for await (const file of modelsGlob.scan({ cwd: process.cwd() })) {
      await import(resolve(process.cwd(), file));
    }
    const { prune, pruneAll } = await import("@bunyad/orm");
    const chunkFlag = args.find((a) => a.startsWith("--chunk="));
    const chunk = chunkFlag
      ? Number(chunkFlag.split("=")[1] ?? 1000)
      : flagNumber(args, "--chunk", 1000);
    const modelFlag =
      args.find((a) => a.startsWith("--model="))?.split("=")[1] ??
      flagString(args, "--model");

    if (modelFlag) {
      const { prunableModelClasses, massPrunableModelClasses } =
        await import("@bunyad/orm");
      const all = [
        ...prunableModelClasses(),
        ...massPrunableModelClasses(),
      ];
      const ModelClass = all.find((m) => m.name === modelFlag);
      if (!ModelClass) {
        console.error(
          `Model [${modelFlag}] is not registered as prunable. Use @Prunable() / @MassPrunable() and ensure it is imported.`,
        );
        process.exitCode = 1;
        return;
      }
      const count = await prune(ModelClass, { chunk });
      console.log(`Pruned [${count}] ${ModelClass.name} records.`);
      return;
    }

    const results = await pruneAll({ chunk });
    if (results.length === 0) {
      console.log("No prunable models registered.");
      return;
    }
    for (const row of results) {
      console.log(`Pruned [${row.count}] ${row.model} records.`);
    }
  },

  async about(args) {
    const asJson = args.includes("--json");
    let pkg: Record<string, unknown> = {};
    try {
      pkg = (await Bun.file(resolve(process.cwd(), "package.json")).json()) as Record<
        string,
        unknown
      >;
    } catch {
      pkg = {};
    }
    const info = {
      application: {
        name: process.env.APP_NAME ?? (typeof pkg.name === "string" ? pkg.name : "Bunyad"),
        version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "local",
        debug: process.env.APP_DEBUG !== "false",
      },
      runtime: {
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
      },
      flock: {
        dumpUrl: process.env.FLOCK_DUMP_URL ?? null,
        site: process.env.FLOCK_SITE ?? null,
      },
    };
    if (asJson) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    console.log(`${info.application.name} ${info.application.version}`);
    console.log(`Environment: ${info.application.environment}`);
    console.log(`Bun: ${info.runtime.bun} (${info.runtime.platform}/${info.runtime.arch})`);
    if (info.flock.dumpUrl) {
      console.log(`Flock dumps: ${info.flock.dumpUrl}`);
    }
  },

  ...makeCommands,

  async new(args: string[]) {
    await newProject(args);
  },

  async "migrate:report"(args: string[]) {
    await migrateReport(args);
  },

  async "migrate:convert"(args: string[]) {
    await migrateConvert(args);
  },
};

/** `bunyad <command> --help`: show that command's lines from the command list. */
async function printCommandHelp(
  name: string,
  handlers: Record<string, (args: string[]) => Promise<void>>,
): Promise<void> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };
  try {
    await handlers.list!([]);
  } finally {
    console.log = original;
  }
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const head = /^  (\S+)/.exec(line);
    const continuation = /^ {17}/.test(line);
    if (head && !continuation) inBlock = head[1] === name || (name.startsWith("make:") && head[1] === "make:*");
    if (inBlock && (head || continuation)) out.push(line);
  }
  if (out.length === 0) {
    console.log(`bunyad ${name}: no extra help. Run \`bunyad list\` to see every command.`);
    return;
  }
  console.log(`Usage: bunyad ${name} [options]\n`);
  for (const line of out) console.log(line);
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  // Load routes/console.ts closures before merging handlers
  try {
    const consoleEntry = resolve(process.cwd(), "routes/console.ts");
    const mod = await import(consoleEntry);
    mod.registerCommands?.();
  } catch {
    // optional
  }

  const appHandlers = await loadAppCommandHandlers();
  const merged = {
    ...commands,
    ...getProviderCommandHandlers(),
    ...appHandlers,
    ...getClosureCommandHandlers(),
  };
  setCommandRunner(async (name, args) => {
    const handler = merged[name];
    if (!handler) {
      throw new Error(`Command "${name}" is not defined.`);
    }
    const prev = process.exitCode;
    process.exitCode = 0;
    await handler(args);
    const code = process.exitCode ?? 0;
    process.exitCode = prev;
    return code;
  });

  const wantsHelp = (a: string) => a === "--help" || a === "-h";
  if (argv[0] === "help" || wantsHelp(argv[0] ?? "")) {
    argv = ["list"];
  } else if (argv.slice(1).some(wantsHelp) && merged[argv[0] ?? ""]) {
    await printCommandHelp(argv[0]!, merged);
    return;
  }

  const command = argv[0] ?? "list";
  let handler: ((args: string[]) => Promise<void>) | undefined = merged[command];
  if (!handler) {
    // Providers register their commands while the app boots, which hasn't happened yet.
    handler = await providerCommandAfterBoot(command);
  }
  if (!handler) {
    console.error(`Command "${command}" is not defined.`);
    process.exitCode = 1;
    return;
  }
  await handler(argv.slice(1));
}

/**
 * Boot the app and look the command up again. Returns undefined outside an app
 * (no `bootstrap/app.ts`) or when no provider registered it.
 */
async function providerCommandAfterBoot(
  command: string,
): Promise<((args: string[]) => Promise<void>) | undefined> {
  if (!existsSync(resolve(process.cwd(), "bootstrap/app.ts"))) return undefined;
  try {
    await bootApp();
  } catch {
    return undefined;
  }
  return getProviderCommandHandlers()[command];
}

function flagNumber(args: string[], name: string, fallback: number): number {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return Number(eq.split("=")[1] ?? fallback);
  const idx = args.indexOf(name);
  if (idx !== -1) return Number(args[idx + 1] ?? fallback);
  return fallback;
}

/**
 * `types:generate --watch`: generate now, then again whenever routes, server
 * code, or pages change. Each run is a fresh process, so edited route files
 * are read anew.
 */
async function watchTypes(): Promise<void> {
  const { watch } = await import("node:fs");
  const root = process.cwd();
  const run = async () => {
    const child = Bun.spawn([process.execPath, resolve(root, "bunyad"), "types:generate"], { cwd: root, stdout: "pipe", stderr: "inherit" });
    const output = await new Response(child.stdout).text();
    // Only say something when a file actually changed.
    for (const line of output.split("\n")) if (line.includes("wrote")) console.log(line.trim());
  };
  await run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const dir of ["routes", "app", "resources/js/pages"]) {
    if (!existsSync(resolve(root, dir))) continue;
    watch(resolve(root, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(run, 300);
    });
  }
  console.log("Watching routes, app, and resources/js/pages for type changes.");
  await new Promise(() => {});
}

function flagString(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = args.indexOf(name);
  if (idx !== -1) return args[idx + 1];
  return undefined;
}

async function compileBinaries(
  root: string,
  entries: Record<string, string>,
  options: { withSqlsrv?: boolean; withInertiaSsr?: boolean } = {},
): Promise<void> {
  const buildDir = resolve(root, ".build");
  const outDir = resolve(buildDir, "bin");
  await Bun.write(resolve(outDir, ".gitkeep"), "");

  /** Native `sharp` cannot boot inside a compiled binary; stub it at compile time. */
  const sharpStubPlugin: import("bun").BunPlugin = {
    name: "bunyad-stub-sharp",
    setup(build) {
      build.onResolve({ filter: /^sharp$/ }, () => ({
        path: "sharp",
        namespace: "bunyad-sharp-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "bunyad-sharp-stub" }, () => ({
        contents: `
const fail = () => {
  throw new Error(
    "Image processing (sharp) is unavailable in bunyad --binary builds. Run with \`bun\` or omit Image APIs.",
  );
};
const stub = new Proxy(function sharp() { return fail(); }, {
  apply: () => fail(),
  construct: () => fail(),
  get: (_t, prop) => (prop === "then" ? undefined : fail),
});
export default stub;
`,
        loader: "js",
      }));
    },
  };

  const plugins: import("bun").BunPlugin[] = [sharpStubPlugin];

  if (!options.withSqlsrv) {
    plugins.push({
      name: "bunyad-stub-mssql",
      setup(build) {
        build.onResolve({ filter: /^mssql$/ }, () => ({
          path: "mssql",
          namespace: "bunyad-mssql-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "bunyad-mssql-stub" }, () => ({
          contents: `
const fail = () => {
  throw new Error(
    "SQL Server (mssql) is unavailable in bunyad --binary builds. Run with \`bun\`, use sqlite/postgres/mysql, or rebuild with \`bunyad compile --binary --with-sqlsrv\`.",
  );
};
class Stub {
  constructor() { fail(); }
}
export default {
  ConnectionPool: Stub,
  Transaction: Stub,
  Request: Stub,
};
`,
          loader: "js",
        }));
      },
    });
  }

  if (!options.withInertiaSsr) {
    plugins.push({
      name: "bunyad-stub-inertia-ssr",
      setup(build) {
        build.onResolve({ filter: /inertia-ssr\.tsx$/ }, () => ({
          path: "inertia-ssr",
          namespace: "bunyad-inertia-ssr-stub",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "bunyad-inertia-ssr-stub" },
          () => ({
            contents: `
export async function renderInertiaPage() {
  throw new Error(
    "Inline Inertia SSR is unavailable in bunyad --binary builds. Set INERTIA_SSR_MODE=http, run a separate SSR worker, or rebuild with \`bunyad compile --binary --with-inertia-ssr\`.",
  );
}
`,
            loader: "js",
          }),
        );
      },
    });
  }

  const publicDir = resolve(root, "public");
  const assets: string[] = [];
  try {
    const { stat } = await import("node:fs/promises");
    if ((await stat(publicDir)).isDirectory()) {
      // Relative path so Bun embeds as `public/` under import.meta.dir.
      assets.push("public");
    }
  } catch {
    // no public/
  }
  // Migrations are bundled as JS modules (.build/migrations.js), not assets.

  // Prefer the all-in-one `app` entry when present.
  const preferred = entries.app
    ? { app: entries.app }
    : entries;

  for (const [name, rel] of Object.entries(preferred)) {
    const entry = resolve(buildDir, rel);
    const outfile = resolve(
      outDir,
      name === "app" ? "bunyad" : `bunyad-${name}`,
    );
    console.log(`Building binary ${name} → ${outfile}`);
    const result = await Bun.build({
      entrypoints: [entry],
      compile: {
        outfile,
        ...(assets.length > 0 ? { assets } : {}),
      },
      target: "bun",
      minify: true,
      plugins,
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        "process.env.BUNYAD_COMPILED": JSON.stringify("1"),
      },
    });
    if (!result.success) {
      for (const log of result.logs) {
        console.error(log);
      }
      console.error(`Binary build failed for [${name}].`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`Binaries written to .build/bin/`);
  if (preferred.app) {
    console.log(`  Single app: .build/bin/bunyad [http|queue|scheduler]`);
    console.log(
      `  Embedded: views, public/, migrations. Writable sqlite/storage use cwd (or BUNYAD_BASE_PATH / DATABASE_PATH=:memory:).`,
    );
  }
}
