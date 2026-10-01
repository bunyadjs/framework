import { join } from "node:path";
import type { Application } from "@bunyad/core";

const CONFIG_NAMES = [
  "database",
  "session",
  "mail",
  "queue",
  "cache",
  "filesystems",
  "broadcasting",
  "inertia",
  "features",
  "logging",
  "cors",
  "auth",
] as const;

/**
 * Load `config/*.ts` into the application config repository.
 * Default exports may be plain objects or factories `(databasePath, app) => config`.
 */
export async function loadFrameworkConfig(app: Application): Promise<void> {
  for (const name of CONFIG_NAMES) {
    const file = join(app.configPath(), `${name}.ts`);
    if (!(await Bun.file(file).exists())) continue;
    try {
      const mod = await import(file);
      let value = mod.default;
      if (typeof value === "function") {
        value = value((path = "") => app.databasePath(path), app);
      }
      app.config.set(name, value);
    } catch {
      // Missing or broken optional config — providers use env defaults.
    }
  }
}
