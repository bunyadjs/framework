# `@bunyad/nestjs`

Minimal NestJS module for Bunyad’s dual-runtime database layer (`@bunyad/database`) and active-record models (`@bunyad/orm`).

**Non-goals:** Nest `@Entity()` fork, Nest CLI schematics, porting Bunyad HTTP into Nest.

## Install

```bash
# Nest app on Node — install Nest peers + a Node DB peer
npm i @bunyad/nestjs @bunyad/database @bunyad/orm @nestjs/common reflect-metadata pg
# or mysql2 / better-sqlite3 instead of / in addition to pg
```

`@nestjs/common` and `reflect-metadata` are **optional peers** so Bun-first apps that never import this package do not pull Nest.

## API

```ts
import { Module, Inject, Injectable } from "@nestjs/common";
import {
  BunyadOrmModule,
  BUNYAD_CONNECTION,
  type Connection,
  DatabaseManager,
} from "@bunyad/nestjs";

@Module({
  imports: [
    BunyadOrmModule.forRoot({
      driver: "postgres", // or pgsql | mysql | mariadb | sqlite | sqlsrv
      url: process.env.DATABASE_URL,
      max: 10,
    }),
  ],
})
export class AppModule {}

@Injectable()
export class UsersService {
  constructor(
    @Inject(BUNYAD_CONNECTION) private readonly db: Connection,
    private readonly manager: DatabaseManager,
  ) {}

  list() {
    return this.manager.table("users").limit(10).get();
  }
}
```

### `forRoot` / `forRootAsync`

| Option | Default | Meaning |
|--------|---------|---------|
| `DatabaseConfig` fields | — | Passed to `connect()` (`driver`, `url` / host fields, `max`, read/write replicas, …) |
| `global` | `true` | Register as a global Nest module |
| `setAsDefault` | `true` | Call `setDefaultConnection` so `@bunyad/orm` `Model` resolves this connection |

```ts
BunyadOrmModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    driver: "postgres",
    url: config.getOrThrow("DATABASE_URL"),
    max: 10,
  }),
  inject: [ConfigService],
});
```

### Providers / lifecycle

- **`BUNYAD_CONNECTION`** — `Connection` from `connect(options)`
- **`DatabaseManager`** — `new DatabaseManager(connection)` (optional QB helper)
- Connects when Nest builds the module (factory); **`close()` on `OnModuleDestroy`**
- Models stay Bunyad classes — **no Nest `@Entity()`**

## Dual runtime

Same models/queries as Bun. Under Node, `@bunyad/database` resolves Node drivers (`pg` / `mysql2` / `better-sqlite3`).

## Publish / peers note

Consumers install only the DB peer they need. Missing peers fail fast from `@bunyad/database` with an install hint. Nest is not required for Bun apps using `@bunyad/database` / `@bunyad/orm` alone.
