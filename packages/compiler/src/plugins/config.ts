import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CompilerPlugin, GenerateContext } from "../types.ts";

type ConfigFileIR = {
  key: string;
  file: string;
  ident: string;
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

function safeIdent(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9_]/g, "_");
  return `config_${cleaned}`;
}

/**
 * Emit `.build/config.ts` with static imports so compiled boot loads config
 * without `readdirSync(config/)`.
 */
export function createConfigPlugin(): CompilerPlugin {
  return {
    name: "config",

    analyze(ctx) {
      const dir = join(ctx.root, "config");
      if (!existsSync(dir)) return;

      const byKey = new Map<string, ConfigFileIR>();
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".") || name.endsWith(".d.ts")) continue;
        if (!name.endsWith(".ts") && !name.endsWith(".js")) continue;
        const key = name.replace(/\.(ts|js)$/, "");
        const file = join(dir, name);
        const existing = byKey.get(key);
        if (existing?.file.endsWith(".ts") && name.endsWith(".js")) continue;
        byKey.set(key, { key, file, ident: safeIdent(key) });
      }

      const files = [...byKey.values()];
      if (files.length === 0) return;
      ctx.ir.set("config", { files });
    },

    generate(ctx: GenerateContext) {
      const ir = ctx.ir.get("config") as { files: ConfigFileIR[] } | undefined;
      if (!ir?.files.length) return;

      const outFile = "config.ts";
      const outPath = `${ctx.outDir}/${outFile}`;
      const imports = ir.files
        .map(
          (f) =>
            `import ${f.ident} from ${JSON.stringify(rel(outPath, f.file))};`,
        )
        .join("\n");
      const entries = ir.files
        .map((f) => `  ${JSON.stringify(f.key)}: ${f.ident},`)
        .join("\n");

      const source = `${imports}

/** Compiled config modules — boot applies these without readdir. */
export const compiledConfigModules: Record<string, unknown> = {
${entries}
};

export function applyCompiledConfig(
  set: (name: string, value: unknown) => void,
  databasePath: (path?: string) => string,
  application: unknown,
): void {
  for (const [name, mod] of Object.entries(compiledConfigModules)) {
    let value = mod;
    if (typeof value === "function") {
      value = (
        value as (
          databasePath: (path?: string) => string,
          application: unknown,
        ) => unknown
      )(databasePath, application);
    }
    if (value !== undefined) set(name, value);
  }
}
`;

      ctx.writeModule("config", outFile, source);
      ctx.setManifestModule("config", `./${outFile}`);
      ctx.setManifestMeta("config", { files: ir.files.length });
    },
  };
}
