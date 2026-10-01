import type {
  CompileOptions,
  Diagnostic,
  GenerateContext,
  ManifestV1,
} from "./types.ts";
import { assertNoErrors, createRouterPlugin } from "./plugins/router.ts";
import { createServerPlugin } from "./plugins/server.ts";
import { createMiddlewarePlugin } from "./plugins/middleware.ts";
import { createProvidersPlugin } from "./plugins/providers.ts";
import { createWorkersPlugin } from "./plugins/workers.ts";
import { createMigrationsPlugin } from "./plugins/migrations.ts";
import { createDiscoveryPlugin } from "./plugins/discovery.ts";
import { createConfigPlugin } from "./plugins/config.ts";
import { resolve } from "node:path";
import { access } from "node:fs/promises";

async function resolveConsoleModule(root: string): Promise<string | undefined> {
  const path = resolve(root, "routes/console.ts");
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
}

function resolveRouteEntries(options: CompileOptions): string[] {
  if (options.routesEntries?.length) return options.routesEntries;
  if (options.routesEntry) return [options.routesEntry];
  return [];
}

export async function compile(options: CompileOptions): Promise<ManifestV1> {
  const outDir = options.outDir ?? `${options.root}/.build`;
  await Bun.write(`${outDir}/.gitkeep`, "");

  const diagnostics: Diagnostic[] = [];
  const ir = new Map<string, unknown>();
  const modules: Record<string, string> = {};
  const entries: Record<string, string> = {};
  const meta: Record<string, unknown> = {};
  const written = new Map<string, string>();

  const analyzeCtx = {
    root: options.root,
    outDir,
    diagnostics,
    ir,
  };

  const routesEntries = resolveRouteEntries(options);
  const consoleModule = await resolveConsoleModule(options.root);

  const plugins = [
    createRouterPlugin({
      routesEntries,
      optimize: options.optimize === true,
    }),
    createMiddlewarePlugin(),
    createProvidersPlugin(),
    createMigrationsPlugin(),
    createDiscoveryPlugin(),
    createConfigPlugin(),
    createServerPlugin(options.bootstrap),
    createWorkersPlugin({
      applicationModule: options.bootstrap.applicationModule,
      consoleModule,
    }),
    ...options.plugins,
  ];

  for (const plugin of plugins) {
    await plugin.analyze?.(analyzeCtx);
  }

  const warnings = diagnostics.filter((d) => d.severity === "warning");
  for (const warning of warnings) {
    console.warn(`${warning.code}: ${warning.message}`);
  }

  assertNoErrors(diagnostics);

  const generateCtx: GenerateContext = {
    ...analyzeCtx,
    writeModule(name, fileName, contents) {
      written.set(fileName, contents);
      modules[name] = `./${fileName}`;
    },
    setManifestModule(name, relativePath) {
      modules[name] = relativePath;
    },
    setManifestMeta(plugin, data) {
      meta[plugin] = data;
    },
    setEntry(name, relativePath) {
      entries[name] = relativePath;
    },
  };

  for (const plugin of plugins) {
    await plugin.generate?.(generateCtx);
  }

  assertNoErrors(diagnostics);

  for (const [fileName, contents] of written) {
    await Bun.write(`${outDir}/${fileName}`, contents);
  }

  const manifest: ManifestV1 = {
    version: 1,
    app: options.appName ?? "app",
    generatedAt: new Date().toISOString(),
    entries,
    modules,
    meta,
    plugins: plugins.map((p) => p.name),
  };

  await Bun.write(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

export type {
  CompileOptions,
  CompilerPlugin,
  ManifestV1,
  Diagnostic,
} from "./types.ts";
export { createRouterPlugin } from "./plugins/router.ts";
export { createServerPlugin } from "./plugins/server.ts";
export { createMiddlewarePlugin } from "./plugins/middleware.ts";
export { createProvidersPlugin } from "./plugins/providers.ts";
export { createWorkersPlugin } from "./plugins/workers.ts";
export { createMigrationsPlugin } from "./plugins/migrations.ts";
export { createDiscoveryPlugin } from "./plugins/discovery.ts";
export { createConfigPlugin } from "./plugins/config.ts";
