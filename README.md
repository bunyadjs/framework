# Bunyad

**Laravel-inspired framework for Bun — same DX, compiled for speed.**

Bunyad is a TypeScript-first web framework that mirrors Laravel's folder structure, syntax, and developer experience while running on [Bun](https://bun.sh). A build-time compiler turns routes, view views, DI graphs, and middleware pipelines into optimized JavaScript — Laravel familiarity with NestJS/Next.js-level performance.

**Website and docs: [bunyadjs.com](https://bunyadjs.com)** · [Documentation](https://bunyadjs.com/docs/1.x) · [npm](https://www.npmjs.com/org/bunyad) · [GitHub](https://github.com/bunyadjs/framework)

> **Alpha.** Bunyad is published as `0.1.0-alpha.0`. APIs may change between `0.x` releases.

> **Not a PHP-to-Bun translation.** Bunyad reimplements Laravel behavior feature-by-feature with compatible APIs, not by converting Laravel source.

## Get started

Install [Bun](https://bun.sh), then create an app:

```bash
bun create bunyad my-app
cd my-app
bun run dev
```

You are asked for a starter kit (Views, Live, React, Vue or Svelte with Inertia, or API), a database (SQLite, PostgreSQL or MySQL), and whether to install dependencies and start a git repository. Or install the CLI once with `bun add -g @bunyad/cli` and run `bunyad new`.

The [installation guide](https://bunyadjs.com/docs/1.x/installation) covers the options.

Using only the database or ORM layer, in a Node or Bun project that isn't a Bunyad app? Install `@bunyad/orm` and `@bunyad/database`, see [Using the ORM outside Bunyad](https://bunyadjs.com/docs/1.x/orm-outside).

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
├── docs/              # Runnable examples (Express, Next.js)
├── benchmarks/
├── templates/         # Starter kits (API, MVC, SaaS, package)
├── tools/             # Internal generators & build utilities
└── scripts/
```

## Documentation

| Document | Purpose |
|----------|---------|
| [bunyadjs.com](https://bunyadjs.com/docs/1.x) | Documentation site: installation, guides, and package references |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

## Design pillars

1. **Familiar DX** — Controllers, middleware, Eloquent-like models, views, `bunyad` / `@bunyad/cli`
2. **Compile-first** — Precompute routes, views, DI, middleware, config, discovery; compiled boot (`BUNYAD_COMPILED=1`) skips Glob/readdir
3. **Ecosystem, not a monolith** — Standalone `@bunyad/*` packages that compose into the framework
4. **Contracts & drivers** — Swappable cache, queue, mail, storage, session backends

## Status

Alpha. All `@bunyad/*` packages and `create-bunyad` are on npm under the `alpha` tag:

```bash
bun add @bunyad/orm@alpha
```

To work on the framework itself:

```bash
bun install
bun run serve              # playground app
bun test packages
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
