import { existsSync, readFileSync } from "node:fs";
import type { CompilerPlugin } from "@bunyad/compiler";
import { compileToModuleSource } from "./compiler.ts";
import { resolveLayouts } from "./layouts.ts";

export type ViewPluginOptions = {
  /** Relative to app root (default `resources/views`). */
  viewsPath?: string;
};

type ViewIR = {
  name: string;
  absolutePath: string;
  relativePath: string;
};

function fileToViewName(relativePath: string): string {
  return relativePath
    .replace(/\.view$/i, "")
    .replaceAll("\\", "/")
    .replaceAll("/", ".");
}

function viewNameToOutFile(name: string): string {
  return `views/${name.replaceAll(".", "/")}.js`;
}

function safeIdent(name: string): string {
  return `v_${name.replaceAll(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Compiler plugin — precompile resources/views into .build/views.
 */
export function createViewPlugin(
  options: ViewPluginOptions = {},
): CompilerPlugin {
  const viewsPath = options.viewsPath ?? "resources/views";

  return {
    name: "view",

    async analyze(ctx) {
      const root = `${ctx.root}/${viewsPath}`.replace(/\/+/g, "/");
      const views: ViewIR[] = [];
      // An app without views (an API): nothing to compile, and the entry skips view preloading.
      if (!existsSync(root)) return;
      const glob = new Bun.Glob("**/*.view");

      for await (const file of glob.scan({ cwd: root, absolute: false })) {
        const relativePath = file.replaceAll("\\", "/");
        views.push({
          name: fileToViewName(relativePath),
          absolutePath: `${root}/${relativePath}`,
          relativePath,
        });
      }

      views.sort((a, b) => a.name.localeCompare(b.name));
      ctx.ir.set("view", { views, viewsPath });
    },

    generate(ctx) {
      const ir = ctx.ir.get("view") as
        | { views: ViewIR[]; viewsPath: string }
        | undefined;
      if (!ir) return;

      const byName = new Map(ir.views.map((v) => [v.name, v]));

      const load = (name: string): string => {
        const hit = byName.get(name);
        if (!hit) {
          ctx.diagnostics.push({
            code: "BUNYAD_VIEW_002",
            message: `Layout or include view [${name}] not found while compiling views.`,
          });
          return "";
        }
        return readFileSync(hit.absolutePath, "utf8");
      };

      const importLines: string[] = [];
      const mapLines: string[] = [];

      for (const view of ir.views) {
        const source = resolveLayouts(
          readFileSync(view.absolutePath, "utf8"),
          load,
        );
        const moduleSource = compileToModuleSource(source);
        const outFile = viewNameToOutFile(view.name);
        ctx.writeModule(`view:${view.name}`, outFile, moduleSource);

        const ident = safeIdent(view.name);
        // Index lives at views/index.js — import sibling modules, not views/views/...
        const importPath = `./${view.name.replaceAll(".", "/")}.js`;
        importLines.push(
          `import { render as ${ident} } from ${JSON.stringify(importPath)};`,
        );
        mapLines.push(`  ${JSON.stringify(view.name)}: ${ident},`);
      }

      const indexSource = `${importLines.join("\n")}

/** Precompiled view renderers (name → render). */
export const views = {
${mapLines.join("\n")}
};
`;

      ctx.writeModule("views", "views/index.js", indexSource);
      ctx.setManifestModule("views", "./views/index.js");
      ctx.setManifestMeta("view", {
        count: ir.views.length,
        names: ir.views.map((v) => v.name),
        viewsPath: ir.viewsPath,
      });
    },
  };
}
