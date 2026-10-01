import {
  Module,
  type DynamicModule,
  type Provider,
} from "@nestjs/common";
import {
  connect,
  DatabaseManager,
  setDefaultConnection,
  type Connection,
  type DatabaseConfig,
} from "@bunyad/database";
import { BunyadOrmLifecycle } from "./lifecycle.ts";
import {
  resolveModuleOptions,
  type BunyadOrmModuleAsyncOptions,
  type BunyadOrmModuleOptions,
  type BunyadOrmOptionsFactory,
  type ResolvedBunyadOrmModuleOptions,
} from "./options.ts";
import { BUNYAD_CONNECTION, BUNYAD_ORM_MODULE_OPTIONS } from "./tokens.ts";

function stripNestFlags(options: ResolvedBunyadOrmModuleOptions): DatabaseConfig {
  const { global: _g, setAsDefault: _s, ...config } = options;
  return config as DatabaseConfig;
}

function createConnection(options: ResolvedBunyadOrmModuleOptions): Connection {
  const connection = connect(stripNestFlags(options));
  if (options.setAsDefault) {
    setDefaultConnection(connection);
  }
  return connection;
}

function connectionProviders(): Provider[] {
  return [
    {
      provide: BUNYAD_CONNECTION,
      useFactory: (options: ResolvedBunyadOrmModuleOptions) =>
        createConnection(options),
      inject: [BUNYAD_ORM_MODULE_OPTIONS],
    },
    {
      provide: DatabaseManager,
      useFactory: (connection: Connection) => new DatabaseManager(connection),
      inject: [BUNYAD_CONNECTION],
    },
    BunyadOrmLifecycle,
  ];
}

/**
 * Nest DI glue for Bunyad `Connection` / `DatabaseManager`.
 * Models remain Bunyad classes — no Nest `@Entity()` fork.
 *
 * Injects {@link BunyadOrmLifecycle} so Nest always instantiates it and runs
 * `OnModuleDestroy` → `connection.close()`.
 */
@Module({})
export class BunyadOrmModule {
  constructor(_lifecycle: BunyadOrmLifecycle) {
    // Force lifecycle provider instantiation (Nest hooks only run when created).
  }

  /**
   * Register a Bunyad database connection for Nest DI.
   */
  static forRoot(options: BunyadOrmModuleOptions): DynamicModule {
    const resolved = resolveModuleOptions(options);
    return {
      module: BunyadOrmModule,
      global: resolved.global,
      providers: [
        { provide: BUNYAD_ORM_MODULE_OPTIONS, useValue: resolved },
        ...connectionProviders(),
      ],
      exports: [BUNYAD_CONNECTION, DatabaseManager],
    };
  }

  /** Async variant — load `DatabaseConfig` from ConfigService / secrets, etc. */
  static forRootAsync(options: BunyadOrmModuleAsyncOptions): DynamicModule {
    const isGlobal = options.global !== false;
    return {
      module: BunyadOrmModule,
      global: isGlobal,
      imports: options.imports ?? [],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        ...connectionProviders(),
      ],
      exports: [BUNYAD_CONNECTION, DatabaseManager],
    };
  }

  private static createAsyncOptionsProviders(
    options: BunyadOrmModuleAsyncOptions,
  ): Provider[] {
    const setAsDefault = options.setAsDefault !== false;
    const isGlobal = options.global !== false;

    if (options.useFactory) {
      return [
        {
          provide: BUNYAD_ORM_MODULE_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const config = await options.useFactory!(...args);
            return resolveModuleOptions({
              ...config,
              global: isGlobal,
              setAsDefault,
            });
          },
          inject: options.inject ?? [],
        },
      ];
    }

    const injectTarget = options.useExisting ?? options.useClass;
    if (!injectTarget) {
      throw new Error(
        "BunyadOrmModule.forRootAsync requires useFactory, useClass, or useExisting.",
      );
    }

    const providers: Provider[] = [
      {
        provide: BUNYAD_ORM_MODULE_OPTIONS,
        useFactory: async (factory: BunyadOrmOptionsFactory) => {
          const config = await factory.createBunyadOrmOptions();
          return resolveModuleOptions({
            ...config,
            global: isGlobal,
            setAsDefault,
          });
        },
        inject: [injectTarget],
      },
    ];

    if (options.useClass) {
      providers.push({ provide: options.useClass, useClass: options.useClass });
    }

    return providers;
  }
}
