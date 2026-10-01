import type { Connection } from "@bunyad/database";
import { migrate, wipe } from "@bunyad/database";

export type RefreshDatabaseOptions = {
  connection: Connection;
  migrationsPath: string;
  /** Run seed after migrate. */
  seed?: () => void | Promise<void>;
  /** When true (default), wipe via rollback + migrate. Set false to run pending only. */
  fresh?: boolean;
};

/**
 * Reset the database for an isolated test (fresh migrate + optional seed).
 */
export async function refreshDatabase(
  options: RefreshDatabaseOptions,
): Promise<void> {
  if (options.fresh !== false) {
    await wipe(options.connection);
    await migrate(options.connection, options.migrationsPath);
  } else {
    await migrate(options.connection, options.migrationsPath);
  }
  if (options.seed) await options.seed();
}
