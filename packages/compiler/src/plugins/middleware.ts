import type { CompilerPlugin } from "../types.ts";

export type MiddlewarePluginOptions = {
  /**
   * Absolute path to `bootstrap/middleware.ts` exporting `registerMiddleware`.
   * Defaults to `${root}/bootstrap/middleware.ts`.
   */
  middlewareEntry?: string;
};

type MiddlewareIR = {
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
 * Compiler plugin — validate and emit `.build/middleware.ts` from
 * `bootstrap/middleware.ts` (`registerMiddleware`, Kernel-style).
 */
export function createMiddlewarePlugin(
  options: MiddlewarePluginOptions = {},
): CompilerPlugin {
  return {
    name: "middleware",

    async analyze(ctx) {
      const entry =
        options.middlewareEntry ?? `${ctx.root}/bootstrap/middleware.ts`;
      const present = await Bun.file(entry).exists();

      if (!present) {
        ctx.diagnostics.push({
          code: "BUNYAD_MW_001",
          severity: "warning",
          message: `No bootstrap/middleware.ts found; global middleware stays inline in createApplication (optional for API apps).`,
          file: entry,
        });
        ctx.ir.set("middleware", { entry, present: false } satisfies MiddlewareIR);
        return;
      }

      const mod = await import(entry);
      if (typeof mod.registerMiddleware !== "function") {
        ctx.diagnostics.push({
          code: "BUNYAD_MW_002",
          message: `bootstrap/middleware.ts must export registerMiddleware(app).`,
          file: entry,
        });
        ctx.ir.set("middleware", { entry, present: false } satisfies MiddlewareIR);
        return;
      }

      ctx.ir.set("middleware", { entry, present: true } satisfies MiddlewareIR);
    },

    generate(ctx) {
      const ir = ctx.ir.get("middleware") as MiddlewareIR | undefined;
      if (!ir?.present) return;

      const outFile = "middleware.ts";
      const outPath = `${ctx.outDir}/${outFile}`;
      const importPath = rel(outPath, ir.entry);

      const source = `/** Compiled middleware entry — re-exports Kernel-style registration. */
export { registerMiddleware } from ${JSON.stringify(importPath)};
`;

      ctx.writeModule("middleware", outFile, source);
      ctx.setManifestModule("middleware", `./${outFile}`);
      ctx.setManifestMeta("middleware", {
        entry: ir.entry,
        present: true,
      });
    },
  };
}
