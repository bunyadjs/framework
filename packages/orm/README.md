# @bunyad/orm

Active-record models on top of [`@bunyad/database`](https://www.npmjs.com/package/@bunyad/database): relations, casts, scopes, events, soft deletes and factories. The same model code runs on Node and Bun.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
npm install @bunyad/orm@beta @bunyad/database@beta better-sqlite3
```

## Quick start

```ts
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "@bunyad/orm";

const connection = connectSqlite({ path: "app.sqlite" });
Model.setConnection(connection);

await schemaFor(connection).create("users", (table) => {
  table.id();
  table.string("name");
  table.timestamps();
});

class User extends Model {
  static table = "users";
  static fillable = ["name"] as const;

  declare id: number;
  declare name: string;

  posts() {
    return this.hasMany(Post);
  }
}

class Post extends Model {
  static table = "posts";

  user() {
    return this.belongsTo(User);
  }
}

const ada = await User.create({ name: "Ada" });
await User.find(ada.id);
await User.where("name", "Ada").first();
await User.query().count();
```

Relations load lazily (`await user.posts().get()`) or eagerly (`User.with("posts")`).

## Large tables

```ts
for await (const user of User.where("active", true).cursor()) {
  // hydrated one model at a time from a single streamed query
}
```

`cursor()` keeps memory flat and fires `retrieved` events. `with()` relations are loaded per batch of `chunkSize` models (default 1000), not per row. Use `lazyById()` when the loop updates the rows it reads. See `@bunyad/database` for per-driver behavior.

## Drivers

Pick one and install it next to `@bunyad/database`: `better-sqlite3`, `pg` or `mysql2`. Bun uses its built-in drivers.

## Framework glue

- Express on Node: [`docs/examples/orm-node-express`](https://github.com/bunyadjs/framework/tree/main/docs/examples/orm-node-express)
- Next.js (server-only, one shared pool): [`docs/examples/orm-node-next`](https://github.com/bunyadjs/framework/tree/main/docs/examples/orm-node-next)
- NestJS: `@bunyad/nestjs` (`BunyadOrmModule`), in the monorepo and not published yet.

## Status

Beta scope: SQLite, PostgreSQL and MySQL are tested on Bun and Node 20+ (the PostgreSQL and MySQL suites run when `BUNYAD_TEST_POSTGRES_URL` / `BUNYAD_TEST_MYSQL_URL` are set). SQL Server is experimental and needs `mssql` installed. Conditional aggregate helpers (`sumCase`, `countCase`) are not available yet.

## License

MIT
