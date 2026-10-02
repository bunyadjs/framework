# Contributing

Thank you for helping build Bunyad.

## Development setup

You need [Bun](https://bun.sh) (latest) and Node.js 20 or newer. The ORM and database packages are also tested on Node.

```bash
bun install
bun run typecheck      # every package must have 0 errors
bun test packages scripts
```

`bun run test` additionally runs the apps and starter kits in this repo.

### PostgreSQL and MySQL tests

Those suites run only when a database is reachable. Create empty databases and set:

```bash
export BUNYAD_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/bunyad_test
export BUNYAD_TEST_MYSQL_URL=mysql://user:pass@127.0.0.1:3306/bunyad_test
bun test packages
cd packages/database && bun run test:node   # same drivers on Node
```

CI runs them against PostgreSQL 16 and MySQL 8.4 service containers.

### Trying a change in a real app

```bash
bun scripts/release.ts pack     # builds and packs every package into .packs/
bun scripts/smoke.ts --kit=api  # scaffolds an app from those tarballs, migrates, serves, requests /
```

## Public API changes

The runtime exports of every package are recorded in `api/*.json`, and a test fails when they change. If you add or remove an export on purpose:

```bash
UPDATE_API=1 bun test scripts/api-snapshot.test.ts
```

Review the diff. Added names are fine in any release. Removed or renamed names are breaking changes: see [docs/STABILITY.md](docs/STABILITY.md) for what a breaking change needs (a changelog entry, a migration note, and a deprecation first where possible).

## Pull requests

- One concern per pull request.
- Add or update tests. Type errors and failing tests block merging.
- Keep package boundaries: do not hardcode one package's logic into `@bunyad/compiler` or `@bunyad/core`.
- Use Bunyad's own names in code, comments and docs, not borrowed product names.

## Reporting bugs and security issues

Bugs: open an issue using the template. Security problems: follow [SECURITY.md](SECURITY.md), not a public issue.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing, you agree your work is licensed under the project license (MIT).
