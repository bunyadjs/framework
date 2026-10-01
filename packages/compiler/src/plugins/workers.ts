import { readFileSync } from "node:fs";
import type { CompilerPlugin, GenerateContext } from "../types.ts";

export type WorkersBootstrap = {
  applicationModule: string;
  /** Path to `routes/console.ts` when present (schedule worker). */
  consoleModule?: string;
};

function rel(fromFile: string, toFile: string): string {
  const fromParts = fromFile.replace(/\\/g, "/").split("/");
  const toParts = toFile.replace(/\\/g, "/").split("/");
  let i = 0;
  while (
    i < fromParts.length - 1 &&
    i < toParts.length - 1 &&
    fromParts[i] === toParts[i]
  ) {
    i++;
  }
  const ups = fromParts.length - 1 - i;
  return `${"../".repeat(ups)}${toParts.slice(i).join("/")}`;
}

function viewsPreamble(hasViews: boolean): string {
  if (!hasViews) return "";
  return `import { setPreloadedViews } from "@bunyad/view";
import { views as compiledViews } from "./views/index.js";
setPreloadedViews(compiledViews);

`;
}

function migrationsPreamble(hasMigrations: boolean): string {
  if (!hasMigrations) return "";
  return `import { setPreloadedMigrations } from "@bunyad/database";
import { migrations as compiledMigrations } from "./migrations.js";
setPreloadedMigrations(compiledMigrations);

`;
}

function discoveryPreamble(hasDiscovery: boolean): string {
  if (!hasDiscovery) return "";
  return `import { applyPreloadedDiscovery } from "./discovery.ts";
applyPreloadedDiscovery();

`;
}

function compiledEnvPreamble(): string {
  return `process.env.BUNYAD_COMPILED ??= "1";

`;
}

function entryPreamble(ctx: { ir: Map<string, unknown> }): string {
  return (
    compiledEnvPreamble() +
    viewsPreamble(ctx.ir.has("view")) +
    migrationsPreamble(
      Boolean(
        (ctx.ir.get("migrations") as { migrations?: unknown[] } | undefined)
          ?.migrations?.length,
      ),
    ) +
    discoveryPreamble(ctx.ir.has("discovery"))
  );
}

/**
 * Where a generated entry imports `getQueue` / `getSchedule` from: the
 * framework (every app on it has it) rather than packages the app may not list.
 */
function runtimeModule(root: string, pkg: string): string {
  try {
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    if (manifest.dependencies?.["@bunyad/framework"]) return "@bunyad/framework";
  } catch {
    // No manifest: import the package itself.
  }
  return pkg;
}

/**
 * Generates `.build/queue-worker.ts`, `.build/schedule-worker.ts`,
 * and `.build/standalone.ts` (http | queue | scheduler in one entry).
 */
export function createWorkersPlugin(
  bootstrap: WorkersBootstrap,
): CompilerPlugin {
  return {
    name: "workers",

    generate(ctx: GenerateContext) {
      const preamble = entryPreamble(ctx);
      const queueModule = runtimeModule(ctx.root, "@bunyad/queue");
      const scheduleModule = runtimeModule(ctx.root, "@bunyad/schedule");
      const appImport = rel(
        `${ctx.outDir}/queue-worker.ts`,
        bootstrap.applicationModule,
      );

      const queueSource = `${preamble}import { installShutdownHandlers, shutdownSignal } from "@bunyad/core";
import { getQueue } from "${queueModule}";
import { createCompiledRouter } from "./routes.ts";
import { createApplication } from "${appImport}";

installShutdownHandlers();
await createApplication({ router: createCompiledRouter() });

const queueName = process.env.QUEUE_NAME ?? "default";
const sleep = Number(process.env.QUEUE_SLEEP ?? 1) * 1000;

console.log(\`  INFO  queue worker starting (queue=\${queueName})\`);
await getQueue().daemon({
  queue: queueName,
  sleep,
  signal: shutdownSignal(),
});
`;

      ctx.writeModule("queue-worker", "queue-worker.ts", queueSource);
      ctx.setEntry("queue", "./queue-worker.ts");
      ctx.setManifestModule("queue-worker", "./queue-worker.ts");

      const consoleImport = bootstrap.consoleModule
        ? rel(`${ctx.outDir}/schedule-worker.ts`, bootstrap.consoleModule)
        : null;

      const scheduleSource = `${preamble}import { installShutdownHandlers, shutdownSignal } from "@bunyad/core";
import { getSchedule } from "${scheduleModule}";
import { createCompiledRouter } from "./routes.ts";
import { createApplication } from "${appImport}";
${
  consoleImport
    ? `import { registerSchedule } from "${consoleImport}";`
    : ""
}

installShutdownHandlers();
await createApplication({ router: createCompiledRouter() });
${consoleImport ? "registerSchedule();\n" : ""}
console.log("  INFO  schedule worker starting");
await getSchedule().work({ signal: shutdownSignal() });
`;

      ctx.writeModule("schedule-worker", "schedule-worker.ts", scheduleSource);
      ctx.setEntry("scheduler", "./schedule-worker.ts");
      ctx.setManifestModule("schedule-worker", "./schedule-worker.ts");

      const standaloneAppImport = rel(
        `${ctx.outDir}/standalone.ts`,
        bootstrap.applicationModule,
      );
      const standaloneConsoleImport = bootstrap.consoleModule
        ? rel(`${ctx.outDir}/standalone.ts`, bootstrap.consoleModule)
        : null;

      const standaloneSource = `${preamble}import { installShutdownHandlers, serve, shutdownSignal } from "@bunyad/core";
import { getQueue } from "${queueModule}";
import { getSchedule } from "${scheduleModule}";
import { createCompiledRouter } from "./routes.ts";
import { createApplication } from "${standaloneAppImport}";
${
  standaloneConsoleImport
    ? `import { registerSchedule } from "${standaloneConsoleImport}";`
    : ""
}

const mode = (process.argv[2] ?? "http").replace(/^--/, "");

if (mode === "help" || mode === "-h") {
  console.log("Usage: bunyad [http|queue|scheduler]");
  process.exit(0);
}

installShutdownHandlers();
const app = await createApplication({ router: createCompiledRouter() });

if (mode === "queue") {
  const queueName = process.env.QUEUE_NAME ?? "default";
  const sleep = Number(process.env.QUEUE_SLEEP ?? 1) * 1000;
  console.log(\`  INFO  queue worker starting (queue=\${queueName})\`);
  await getQueue().daemon({
    queue: queueName,
    sleep,
    signal: shutdownSignal(),
  });
} else if (mode === "scheduler" || mode === "schedule") {
${standaloneConsoleImport ? "  registerSchedule();\n" : ""}  console.log("  INFO  schedule worker starting");
  await getSchedule().work({ signal: shutdownSignal() });
} else if (mode === "http" || mode === "serve" || mode === "start") {
  serve(app);
} else {
  console.error(\`Unknown mode [\${mode}]. Use http, queue, or scheduler.\`);
  process.exitCode = 1;
}
`;

      ctx.writeModule("standalone", "standalone.ts", standaloneSource);
      ctx.setEntry("app", "./standalone.ts");
      ctx.setManifestModule("standalone", "./standalone.ts");

      ctx.setManifestMeta("workers", {
        queue: true,
        scheduler: true,
        console: Boolean(consoleImport),
        standalone: true,
      });
    },
  };
}
