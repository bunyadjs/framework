# `@bunyad/orm`

Eloquent-style models on top of `@bunyad/database` `Connection`.

Runtime-agnostic: same model/query code on Bun and Node. Node apps install
`@bunyad/database` optional peers (`pg` / `mysql2` / `better-sqlite3`) and use
`connect(...)` from the Node entry (conditional exports).

## Nest / Next

- Nest DI: `@bunyad/nestjs` (`BunyadOrmModule`) — models stay Bunyad classes (no `@Entity()`).
- Next.js: see `docs/examples/orm-node-next` (`server-only`, shared pool).

