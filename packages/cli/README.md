# @bunyad/cli

The `bunyad` command line: scaffold apps, run migrations, serve and compile, run queue workers and the scheduler, and generate code with `make:*` commands.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

## Install

Install it globally to get the `bunyad` command anywhere, mainly for `bunyad new`:

```bash
bun add -g @bunyad/cli@beta
# or: npm install -g @bunyad/cli@beta
```

Inside an app you normally do not need the global copy. Every app has a `./bunyad` launcher and `@bunyad/cli` as a dependency. When you run `bunyad <command>` from an app directory, the global binary hands the command over to that app's `./bunyad`, so it runs against the app's own `@bunyad/*` versions. `bunyad new` is the one command that never hands off.

## Usage

```bash
bunyad new views my-app      # scaffold from a starter kit (views, live, react, vue, svelte, api)
cd my-app
bunyad migrate               # run database migrations
bunyad serve --hot           # start the dev server with soft reload
bunyad make:controller Post  # generate code (controller, model, job, mailable, ...)
bunyad route:list --json     # list registered routes
bunyad queue:work            # process queued jobs
bunyad list                  # every command, including your own
```

Programmatic entry points are exported too: `run`, `Command`, `command`, and the prompt helpers (`text`, `select`, `confirm`, ...), used to define app commands.

## Notes

- Runs on Bun only (1.4 or newer).
- `bunyad new` options: `--kit=`, `--dir=`, `--database=sqlite|pgsql|mysql`, `--install` / `--no-install`, `--git` / `--no-git`. See [create-bunyad](https://www.npmjs.com/package/create-bunyad) for the prompts.
- Other groups: `compile`, `start`, `workers`, `key:generate`, `db:seed`, `queue:*`, `schedule:*`, `config:cache`, `route:cache`, `optimize`, `migrate:report` and `migrate:convert` (PHP project helpers).

## License

MIT
