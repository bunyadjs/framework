export {
  BunyadOrmModule,
} from "./bunyad-orm.module.ts";
export {
  BUNYAD_CONNECTION,
  BUNYAD_ORM_MODULE_OPTIONS,
} from "./tokens.ts";
export {
  type BunyadOrmModuleOptions,
  type BunyadOrmModuleAsyncOptions,
  type BunyadOrmOptionsFactory,
  type ResolvedBunyadOrmModuleOptions,
  resolveModuleOptions,
} from "./options.ts";
export { BunyadOrmLifecycle } from "./lifecycle.ts";

/** Re-exports for Nest apps that want one import surface. */
export {
  DatabaseManager,
  setDefaultConnection,
  getDefaultConnection,
  type Connection,
  type DatabaseConfig,
} from "@bunyad/database";
