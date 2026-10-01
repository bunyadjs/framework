# Benchmark app

Runnable benchmark harness. Scenarios live in `/benchmarks`.

```bash
# Hello JSON (Bun.serve vs Bunyad) + SQLite select/insert (bun:sqlite vs ORM)
bun benchmarks/hello-and-sqlite.ts

# All registered suites
bun benchmarks/run.ts
```

Playground live routes (after `bunyad serve`):

- `GET /bench/hello` and `GET /bench/bun/hello`
- `GET /bench/select` and `GET /bench/bun/select`
- `POST /bench/insert` and `POST /bench/bun/insert`
