import type { DatabaseConfig } from "@bunyad/database";
import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from "@nestjs/common";

/** Nest glue options on top of `@bunyad/database` `connect()` config. */
export type BunyadOrmModuleOptions = DatabaseConfig & {
  /**
   * Register as a global Nest module so feature modules need not re-import.
   * @default true
   */
  global?: boolean;
  /**
   * Call `setDefaultConnection` so `@bunyad/orm` models resolve this connection.
   * @default true
   */
  setAsDefault?: boolean;
};

export interface BunyadOrmOptionsFactory {
  createBunyadOrmOptions(): Promise<DatabaseConfig> | DatabaseConfig;
}

export type BunyadOrmModuleAsyncOptions = Pick<ModuleMetadata, "imports"> & {
  global?: boolean;
  setAsDefault?: boolean;
  useFactory?: (
    ...args: unknown[]
  ) => Promise<DatabaseConfig> | DatabaseConfig;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useClass?: Type<BunyadOrmOptionsFactory>;
  useExisting?: Type<BunyadOrmOptionsFactory>;
};

/** Options after Nest defaults are applied (factory always receives this shape). */
export type ResolvedBunyadOrmModuleOptions = DatabaseConfig & {
  global: boolean;
  setAsDefault: boolean;
};

export function resolveModuleOptions(
  options: BunyadOrmModuleOptions,
): ResolvedBunyadOrmModuleOptions {
  const { global: isGlobal = true, setAsDefault = true, ...config } = options;
  return {
    ...(config as DatabaseConfig),
    global: isGlobal,
    setAsDefault,
  };
}
