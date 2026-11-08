import { existsSync } from "node:fs";
import { join } from "node:path";
import { ServiceProvider, isBunEmbeddedPath } from "@bunyad/core";
import {
  connect,
  DB,
  migrate,
  migrateCompiled,
  takePreloadedMigrations,
} from "@bunyad/database";
import { Model } from "@bunyad/orm";
import { setPresenceVerifier, presenceVerifierFor } from "@bunyad/validation";
import { resolveDatabaseConfig } from "./database-config.ts";

function migrationsDirectory(app: {
  databasePath(path?: string): string;
}): string | null {
  if (isBunEmbeddedPath(import.meta.dir)) {
    const embedded = join(import.meta.dir, "database", "migrations");
    if (existsSync(embedded)) return embedded;
  }
  const disk = app.databasePath("migrations");
  if (existsSync(disk)) return disk;
  return null;
}

export class DatabaseServiceProvider extends ServiceProvider {
  register(): void {
    const config = resolveDatabaseConfig(this.app);

    for (const [name, connectionConfig] of Object.entries(config.connections)) {
      DB.addConnectionResolver(name, () => connect(connectionConfig));
    }

    DB.setDefaultConnection(config.default);
    const connection = DB.connection(config.default);
    Model.setConnection(connection);
    this.app.instance("db", connection);
    setPresenceVerifier(presenceVerifierFor(connection));
  }

  async boot(): Promise<void> {
    const config = resolveDatabaseConfig(this.app);
    const names = config.migrate ?? [config.default];
    const preloaded = takePreloadedMigrations();
    const migrationsPath = preloaded ? null : migrationsDirectory(this.app);

    for (const name of names) {
      if (!config.connections[name]) continue;
      const connection = DB.connection(name);
      if (preloaded) {
        await migrateCompiled(connection, preloaded);
      } else if (migrationsPath) {
        await migrate(connection, migrationsPath);
      }
    }
  }
}
