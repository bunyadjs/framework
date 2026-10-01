# Bunyad

**Laravel-inspired framework for Bun — same DX, compiled for speed.**

Bunyad is a TypeScript-first web framework that mirrors Laravel's folder structure, syntax, and developer experience while running on [Bun](https://bun.sh). A build-time compiler turns routes, view views, DI graphs, and middleware pipelines into optimized JavaScript — Laravel familiarity with NestJS/Next.js-level performance.

> **Not a PHP-to-Bun translation.** Bunyad reimplements Laravel behavior feature-by-feature with compatible APIs, not by converting Laravel source.

## Quick mental model

```
Developer Code (Laravel-like TS)
        ↓
   Bunyad Compiler
        ↓
 Optimized Bun Runtime
```

```
bun compile   →  .build/ (routes, views, container, middleware, manifest)
bun run start →  loads only compiled code
```

## Repository layout

```
bunyad/
├── apps/              # Playground, benchmarks, docs site
├── packages/          # @bunyad/* packages
├── benchmarks/
├── templates/         # Starter kits (API, MVC, SaaS, package)
├── tools/             # Internal generators & build utilities
└── scripts/
```

## Documentation

| Document | Purpose |
|----------|---------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

## Design pillars

1. **Familiar DX** — Controllers, middleware, Eloquent-like models, views, `bunyad` / `@bunyad/cli`
2. **Compile-first** — Precompute routes, views, DI, middleware, config, discovery; compiled boot (`BUNYAD_COMPILED=1`) skips Glob/readdir
3. **Ecosystem, not a monolith** — Standalone `@bunyad/*` packages that compose into the framework
4. **Contracts & drivers** — Swappable cache, queue, mail, storage, session backends

## Status

**Phase 1 hello-world shipped.** Run:

```bash
bun install
bun run serve              # dev
bun run compile            # → apps/playground/.build/
bun run start:compiled     # production-style boot from .build
bun run routes             # list routes
# GET http://localhost:3000/  → {"message":"Hello, Bunyad","framework":"bunyad"}
```

Or from the app: `cd apps/playground && bunyad serve`

## Design pillars

MIT (planned)
