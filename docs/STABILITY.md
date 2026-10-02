# Versions and stability

Bunyad follows semantic versioning with the usual `0.x` caveat: while the major
version is `0`, a **minor** release (`0.2` → `0.3`) may contain breaking changes
and a **patch** release (`0.2.0` → `0.2.1`) never does.

## Stages

| Stage | Meaning | npm tag |
| --- | --- | --- |
| alpha | Works, but the API can change in any release without notice. | `alpha` |
| beta | The public API of beta packages changes only through documented breaking changes. | `beta` |
| 1.0 | Semantic versioning in full: breaking changes only in major releases. | `latest` |

`latest` does not move during the beta. Install a beta explicitly:
`npm install @bunyad/orm@beta`.

## What the beta covers

Every published `@bunyad/*` package and `create-bunyad` are in the beta. They are
versioned together and always carry the same version number.

**Runtime support**

| Packages | Runtime |
| --- | --- |
| `contracts`, `common`, `database`, `orm` | Node.js 20, 22 and 24, and Bun 1.4+ |
| All other packages | Bun 1.4+ only |

**Databases:** SQLite, PostgreSQL and MySQL are tested in CI on every change. SQL Server
is experimental and needs `mssql` installed alongside `@bunyad/database`.

## The beta promise

- The documented public exports of the beta packages are the beta API. Anything not
  exported from a package entry point, or marked `@internal`, can change at any time.
- A breaking change ships only in a minor release, never a patch.
- Every breaking change has a changelog entry and a migration note that says what to
  change.
- Where possible an API is deprecated for at least one minor release before removal,
  with a runtime or type-level warning.
- Bug fixes and security fixes may change behaviour that was clearly a bug.
- Published versions are never overwritten or re-tagged after release.

## What the beta does not promise

- Stability of alpha packages.
- Stability of the database schema that your own migrations generate, beyond what
  the migration notes describe.
- Support for runtimes older than the ones listed above.
