import type { Application } from "@bunyad/core";
import { DatabaseServiceProvider } from "./DatabaseServiceProvider.ts";
import { EventServiceProvider } from "./EventServiceProvider.ts";
import { ViewServiceProvider } from "./ViewServiceProvider.ts";
import { CacheServiceProvider } from "./CacheServiceProvider.ts";
import { FilesystemServiceProvider } from "./FilesystemServiceProvider.ts";
import { HttpServiceProvider } from "./HttpServiceProvider.ts";
import { LogServiceProvider } from "./LogServiceProvider.ts";
import { SessionServiceProvider } from "./SessionServiceProvider.ts";
import { MailServiceProvider } from "./MailServiceProvider.ts";
import { QueueServiceProvider } from "./QueueServiceProvider.ts";
import { NotificationServiceProvider } from "./NotificationServiceProvider.ts";
import { BroadcastServiceProvider } from "./BroadcastServiceProvider.ts";
import { AuthServiceProvider } from "./AuthServiceProvider.ts";
import { LiveServiceProvider } from "./LiveServiceProvider.ts";
import { HeadServiceProvider } from "./HeadServiceProvider.ts";
import { InertiaServiceProvider } from "./InertiaServiceProvider.ts";
import { FeatureServiceProvider } from "./FeatureServiceProvider.ts";
import { PermissionServiceProvider } from "./PermissionServiceProvider.ts";
import { DumpServiceProvider } from "./DumpServiceProvider.ts";
import { loadFrameworkConfig } from "./load-config.ts";

export { loadFrameworkConfig } from "./load-config.ts";
export {
  defaultDatabaseConfig,
  defaultRedisConfig,
  mysqlConnectionFromEnv,
  mariadbConnectionFromEnv,
  normalizeConnectionName,
  pgsqlConnectionFromEnv,
  sqlsrvConnectionFromEnv,
  resolveDatabaseConfig,
  resolveRedisUrl,
  standardDatabaseConnections,
  type DatabaseConnectionsConfig,
  type RedisConnectionConfig,
} from "./database-config.ts";
export { DatabaseServiceProvider } from "./DatabaseServiceProvider.ts";
export { EventServiceProvider } from "./EventServiceProvider.ts";
export { ViewServiceProvider } from "./ViewServiceProvider.ts";
export { CacheServiceProvider } from "./CacheServiceProvider.ts";
export { FilesystemServiceProvider } from "./FilesystemServiceProvider.ts";
export { HttpServiceProvider } from "./HttpServiceProvider.ts";
export { LogServiceProvider } from "./LogServiceProvider.ts";
export { SessionServiceProvider } from "./SessionServiceProvider.ts";
export type { SessionConfig } from "./SessionServiceProvider.ts";
export { MailServiceProvider } from "./MailServiceProvider.ts";
export { QueueServiceProvider } from "./QueueServiceProvider.ts";
export { NotificationServiceProvider } from "./NotificationServiceProvider.ts";
export { BroadcastServiceProvider } from "./BroadcastServiceProvider.ts";
export { AuthServiceProvider } from "./AuthServiceProvider.ts";
export { LiveServiceProvider } from "./LiveServiceProvider.ts";
export { HeadServiceProvider } from "./HeadServiceProvider.ts";
export { InertiaServiceProvider } from "./InertiaServiceProvider.ts";
export { DumpServiceProvider, registerDumpQueryListener } from "./DumpServiceProvider.ts";
export { FeatureServiceProvider } from "./FeatureServiceProvider.ts";
export { PermissionServiceProvider, type PermissionsConfig } from "./PermissionServiceProvider.ts";

/** Providers `registerFrameworkProviders` can skip. Order is boot order. */
export const FRAMEWORK_PROVIDERS = [
  ["database", DatabaseServiceProvider],
  ["dump", DumpServiceProvider],
  ["events", EventServiceProvider],
  ["view", ViewServiceProvider],
  ["cache", CacheServiceProvider],
  ["filesystems", FilesystemServiceProvider],
  ["log", LogServiceProvider],
  ["http", HttpServiceProvider],
  ["session", SessionServiceProvider],
  ["mail", MailServiceProvider],
  ["queue", QueueServiceProvider],
  ["notifications", NotificationServiceProvider],
  ["broadcasting", BroadcastServiceProvider],
  ["auth", AuthServiceProvider],
  ["permissions", PermissionServiceProvider],
  ["live", LiveServiceProvider],
  ["head", HeadServiceProvider],
  ["inertia", InertiaServiceProvider],
  ["features", FeatureServiceProvider],
] as const;

export type FrameworkProviderName = (typeof FRAMEWORK_PROVIDERS)[number][0];

export type BootFrameworkOptions = {
  /** Skip providers this app does not use. Unknown names throw. */
  except?: readonly FrameworkProviderName[];
};

/**
 * Register framework service providers.
 * Call after `loadFrameworkConfig(app)` and before app `providers.ts`.
 */
export function registerFrameworkProviders(
  app: Application,
  options: BootFrameworkOptions = {},
): void {
  const skip = new Set(options.except ?? []);
  for (const name of skip) {
    if (!FRAMEWORK_PROVIDERS.some(([providerName]) => providerName === name)) {
      throw new Error(`Unknown framework provider [${name}].`);
    }
  }

  for (const [name, Provider] of FRAMEWORK_PROVIDERS) {
    if (skip.has(name)) continue;
    app.register(Provider);
  }
}

/** Load config/*.ts then register framework providers. */
export async function bootFrameworkProviders(
  app: Application,
  options: BootFrameworkOptions = {},
): Promise<void> {
  await loadFrameworkConfig(app);
  registerFrameworkProviders(app, options);
}
