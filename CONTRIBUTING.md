# Contributing

Thank you for helping build Bunyad.

## Development setup

```bash
# Requires Bun
bun install
bun test
bun run typecheck
```

(Exact scripts land with Phase 0 monorepo tooling.)

## Pull requests

- One concern per PR (single package or single cross-cutting fix).
- Include or update tests that assert Laravel-compatible behavior where applicable.
- Do not bypass the compiler plugin contract by hardcoding package logic into `@bunyad/compiler`.

## Code of conduct

Be respectful. Disagreement belongs in RFCs and review comments, not personal attacks.

## License

By contributing, you agree your work is licensed under the project license (MIT).
