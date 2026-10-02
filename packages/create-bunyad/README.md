# create-bunyad

Create a new [Bunyad](https://github.com/bunyadjs/framework) app from a starter kit. It runs `bunyad new` from `@bunyad/cli`, with the directory given first.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

## Usage

```bash
bunx create-bunyad@beta my-app
# or: bun create bunyad@beta my-app
```

You are asked, in order, for:

1. a starter kit: Views, Live, React, Vue or Svelte (the last three with Inertia), or API
2. a directory name (skipped when you pass one)
3. a database: SQLite (default), PostgreSQL or MySQL
4. whether to install dependencies (default yes)
5. whether to run `git init` (default yes)
6. a final confirmation

Skip the questions with flags. When both a kit and a directory are given, nothing is asked, and dependencies and git are only done if you pass `--install` / `--git`:

```bash
bunx create-bunyad@beta my-app --kit=react --database=pgsql --install --git
```

| Flag | Meaning |
|------|---------|
| `--kit=<name>` | `views`, `live`, `react`, `vue`, `svelte` or `api` (other bundled template folders also work) |
| `--database=<name>` | `sqlite`, `pgsql` or `mysql` (default `sqlite`) |
| `--install` / `--no-install` | run `bun install` after scaffolding |
| `--git` / `--no-git` | run `git init` after scaffolding |

The app gets a fresh `APP_KEY` in `.env`. Next steps: `cd my-app`, `bunyad migrate`, `bun run dev`.

## Notes

- Requires Bun 1.4 or newer. It fails if the target directory already exists.
- Any unknown `--option` is rejected.

## License

MIT
