# @bunyad/orm

Active-record models on top of [`@bunyad/database`](https://www.npmjs.com/package/@bunyad/database): relations, casts, scopes, events, soft deletes and factories. The same model code runs on Node and Bun.

> **Alpha.** APIs may change between `0.x` releases.

```bash
npm install @bunyad/orm@alpha @bunyad/database@alpha better-sqlite3
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

## Drivers

Pick one and install it next to `@bunyad/database`: `better-sqlite3`, `pg` or `mysql2`. Bun uses its built-in drivers.

## Framework glue

- Express on Node: [`docs/examples/orm-node-express`](https://github.com/bunyadjs/framework/tree/main/docs/examples/orm-node-express)
- Next.js (server-only, one shared pool): [`docs/examples/orm-node-next`](https://github.com/bunyadjs/framework/tree/main/docs/examples/orm-node-next)
- NestJS: `@bunyad/nestjs` (`BunyadOrmModule`), in the monorepo and not published yet.

## Status

Alpha. SQLite is the most tested driver; PostgreSQL and MySQL tests need a live database and are skipped by default. Aggregate helpers such as `sumCase`/`countCase` are not implemented yet.

## License

MIT
