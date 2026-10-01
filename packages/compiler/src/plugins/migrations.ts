import type { CompilerPlugin } from "../types.ts";

type MigrationIR = {
  name: string;
  absolutePath: string;
};

function safeIdent(name: string): string {
  return `m_${name.replaceAll(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Bundle `database/migrations/*.ts` into `.build/migrations.js` so standalone
 * binaries can migrate without reading migration files from disk.
 */
export function createMigrationsPlugin(): CompilerPlugin {
  return {
    name: "migrations",

    async analyze(ctx) {
      const root = `${ctx.root}/database/migrations`.replace(/\/+/g, "/");
      const migrations: MigrationIR[] = [];
      const glob = new Bun.Glob("*.ts");
      try {
        for await (const file of glob.scan({ cwd: root, absolute: false })) {
          const name = file.replace(/\.ts$/i, "");
          migrations.push({
            name,
            absolutePath: `${root}/${file}`,
          });
        }
      } catch {
        // no migrations directory
      }
      migrations.sort((a, b) => a.name.localeCompare(b.name));
      ctx.ir.set("migrations", { migrations });
    },

    generate(ctx) {
      const ir = ctx.ir.get("migrations") as
        | { migrations: MigrationIR[] }
        | undefined;
      if (!ir || ir.migrations.length === 0) return;

      const importLines: string[] = [];
      const listLines: string[] = [];
      for (const migration of ir.migrations) {
        const ident = safeIdent(migration.name);
        const rel = migration.absolutePath.startsWith(ctx.outDir)
          ? migration.absolutePath
          : (() => {
              const from = `${ctx.outDir}/migrations.js`;
              const fromParts = from.replace(/\\/g, "/").split("/");
              const toParts = migration.absolutePath.replace(/\\/g, "/").split("/");
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
            })();
        importLines.push(`import * as ${ident} from ${JSON.stringify(rel)};`);
        listLines.push(
          `  { migration: ${JSON.stringify(`${migration.name}.ts`)}, up: ${ident}.up, down: ${ident}.down },`,
        );
      }

      const source = `${importLines.join("\n")}

export const migrations = [
${listLines.join("\n")}
];
`;

      ctx.writeModule("migrations", "migrations.js", source);
      ctx.setManifestModule("migrations", "./migrations.js");
      ctx.setManifestMeta("migrations", {
        count: ir.migrations.length,
        names: ir.migrations.map((m) => m.name),
      });
    },
  };
}
