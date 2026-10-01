# Bunyad Playground

```bash
bunyad serve
bunyad migrate
```

## Highlights

- `GET /` — JSON hello
- `GET /welcome` — HTML via layout (`@extends` / `@section` / `@yield`)
- `POST /users` — validation + session flash (`Created Ada`)
- Sessions via `startSession` middleware
- `GET /notes` — Live notes (tenant-scoped)
- `GET /bench/hello` · `GET /bench/select` · `POST /bench/insert` — Bunyad kernel JSON / ORM
- `GET /bench/bun/hello` · `GET /bench/bun/select` · `POST /bench/bun/insert` — `Bun.serve` + `bun:sqlite` (same process)

```bash
# HTTP RPS vs Bun.serve + bun:sqlite (self-contained, no playground listen)
bun benchmarks/hello-and-sqlite.ts
```

