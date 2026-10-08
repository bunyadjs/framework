# Bunyad

**A TypeScript-first web framework for Bun, compiled for speed.**

Bunyad gives you controllers, middleware, active-record models, views, queues, mail, validation and a command-line tool in one coherent stack, running on [Bun](https://bun.sh). A build-time compiler turns routes, views, the service container and middleware pipelines into plain optimized JavaScript, so a production app boots from compiled code instead of scanning the file system.

It is inspired by Laravel's developer experience. It does not copy Laravel's folder structure, and it is not a PHP-to-Bun translation: Bunyad is its own framework with its own names, written for TypeScript.

**Website and docs: [bunyadjs.com](https://bunyadjs.com)** · [Documentation](https://bunyadjs.com/docs/1.x) · [npm](https://www.npmjs.com/org/bunyad) · [GitHub](https://github.com/bunyadjs/framework)

> **Beta.** The current release is `0.2.0-beta.1`, published under the `beta` npm tag. `latest` still points at the old `0.1.0-alpha.0` and will not move until 1.0, so install with `@beta`. Public APIs change only in minor releases, with a changelog entry and an upgrade note: see the [stability policy](docs/STABILITY.md), the [changelog](CHANGELOG.md) and the [upgrade guide](docs/UPGRADING.md).

## Get started

Install [Bun](https://bun.sh) 1.4 or newer, then create an app:

```bash
bun create bunyad@beta my-app
cd my-app
bun run dev
```

You are asked for a starter kit (Views, Live, React, Vue or Svelte with Inertia, or API), a database (SQLite, PostgreSQL or MySQL), and whether to install dependencies and start a git repository. Or install the CLI once with `bun add -g @bunyad/cli` and run `bunyad new`.

The [installation guide](https://bunyadjs.com/docs/1.x/installation) covers the options.

Using only the database or ORM layer, in a Node or Bun project that isn't a Bunyad app? Install `@bunyad/orm` and `@bunyad/database`, see [Using the ORM outside Bunyad](https://bunyadjs.com/docs/1.x/orm-outside).

## How it works

```
Your TypeScript app
        ↓
  Bunyad compiler
        ↓
 Compiled code on Bun
```

```
bunyad compile  →  .build/ (routes, views, container, middleware, manifest)
bunyad start    →  loads only compiled code
```

## What is in the box

Every capability is a standalone `@bunyad/*` package, and `@bunyad/framework` brings them together:

| Area | Packages |
|------|----------|
| Web | `http`, `router`, `validation`, `view`, `inertia`, `live`, `session`, `auth`, `oauth` |
| Data | `database`, `orm`, `migrate`, `cache` |
| Background work | `queue`, `schedule`, `events`, `broadcasting`, `notifications`, `mail` |
| Platform | `core`, `container`, `config`, `compiler`, `cli`, `log`, `console`, `head`, `metrics`, `features`, `permissions`, `filesystem`, `image`, `search`, `billing`, `testing` |

`contracts`, `common`, `database` and `orm` also run on Node.js 20+. Everything else is Bun-only.

## Repository layout

```
bunyad/
├── apps/              # Playground, example apps, docs site
├── packages/          # @bunyad/* packages
├── docs/              # Stability policy and runnable examples (Express, Next.js)
├── api/               # Recorded public exports of every package
├── benchmarks/
├── templates/         # Starter kits (api, views, live, react, vue, svelte, saas, package)
├── tools/             # Internal generators and build utilities
└── scripts/           # Release, smoke-test and API-snapshot tooling
```

## Documentation

| Document | Purpose |
|----------|---------|
| [bunyadjs.com](https://bunyadjs.com/docs/1.x) | Installation, guides and package references |
| [docs/STABILITY.md](docs/STABILITY.md) | Versions, stability and the beta promise |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [docs/UPGRADING.md](docs/UPGRADING.md) | Steps for moving between releases |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |

## Design pillars

1. **Familiar developer experience**: controllers, middleware, active-record models, views and a `bunyad` command-line tool.
2. **Compile first**: routes, views, the container, middleware, config and discovery are computed at build time, and a compiled boot (`BUNYAD_COMPILED=1`) skips Glob and readdir.
3. **An ecosystem, not a monolith**: standalone `@bunyad/*` packages that compose into the framework.
4. **Contracts and drivers**: swappable cache, queue, mail, storage and session backends.

## Status

```bash
bun create bunyad@beta my-app   # new app
bun add @bunyad/orm@beta        # a single package
```

To work on the framework itself:

```bash
bun install
bun run serve              # playground app
bun run typecheck
bun test packages scripts
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
