import type { CompilerPlugin, GenerateContext } from "../types.ts";

export type ServerBootstrap = {
  applicationModule: string;
};

function rel(fromFile: string, toFile: string): string {
  const fromParts = fromFile.replace(/\\/g, "/").split("/");
  const toParts = toFile.replace(/\\/g, "/").split("/");
  let i = 0;
  while (i < fromParts.length - 1 && i < toParts.length - 1 && fromParts[i] === toParts[i]) {
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

function standalonePreamble(ctx: {
  ir: Map<string, unknown>;
}): string {
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
 * Generates `.build/server.ts` using compiled router + app bootstrap.
 */
export function createServerPlugin(bootstrap: ServerBootstrap): CompilerPlugin {
  return {
    name: "server",

    generate(ctx: GenerateContext) {
      const serverFile = "server.ts";
      const serverPath = `${ctx.outDir}/${serverFile}`;
      const appImport = rel(serverPath, bootstrap.applicationModule);
      const source = `${standalonePreamble(ctx)}import { serve } from "@bunyad/core";
import { createCompiledRouter } from "./routes.ts";
import { createApplication } from "${appImport}";

const app = await createApplication({ router: createCompiledRouter() });
serve(app);
`;

      ctx.writeModule("server", serverFile, source);
      ctx.setEntry("http", `./${serverFile}`);
      ctx.setManifestModule("server", `./${serverFile}`);
    },
  };
}
