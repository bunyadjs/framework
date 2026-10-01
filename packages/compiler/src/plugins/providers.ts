import type { CompilerPlugin } from "../types.ts";

export type ProvidersPluginOptions = {
  /**
   * Absolute path to `bootstrap/providers.ts` exporting `registerProviders`.
   * Defaults to `${root}/bootstrap/providers.ts`.
   */
  providersEntry?: string;
};

type ProvidersIR = {
  entry: string;
  present: boolean;
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

/**
 * Compiler plugin — emit `.build/providers.ts` from `bootstrap/providers.ts`
 * (`registerProviders`, service provider list).
 */
export function createProvidersPlugin(
  options: ProvidersPluginOptions = {},
): CompilerPlugin {
  return {
    name: "providers",

    async analyze(ctx) {
      const entry =
        options.providersEntry ?? `${ctx.root}/bootstrap/providers.ts`;
      const present = await Bun.file(entry).exists();

      if (!present) {
        ctx.diagnostics.push({
          code: "BUNYAD_PROV_001",
          severity: "warning",
          message: `No bootstrap/providers.ts found; service providers stay inline in createApplication (optional).`,
          file: entry,
        });
        ctx.ir.set("providers", { entry, present: false } satisfies ProvidersIR);
        return;
      }

      const mod = await import(entry);
      if (typeof mod.registerProviders !== "function") {
        ctx.diagnostics.push({
          code: "BUNYAD_PROV_002",
          message: `bootstrap/providers.ts must export registerProviders(app).`,
          file: entry,
        });
        ctx.ir.set("providers", { entry, present: false } satisfies ProvidersIR);
        return;
      }

      ctx.ir.set("providers", { entry, present: true } satisfies ProvidersIR);
    },

    generate(ctx) {
      const ir = ctx.ir.get("providers") as ProvidersIR | undefined;
      if (!ir?.present) return;

      const outFile = "providers.ts";
      const outPath = `${ctx.outDir}/${outFile}`;
      const importPath = rel(outPath, ir.entry);

      const source = `/** Compiled providers entry — re-exports ServiceProvider registration. */
export { registerProviders } from ${JSON.stringify(importPath)};
`;

      ctx.writeModule("providers", outFile, source);
      ctx.setManifestModule("providers", `./${outFile}`);
      ctx.setManifestMeta("providers", {
        entry: ir.entry,
        present: true,
      });
    },
  };
}
