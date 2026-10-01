#!/usr/bin/env bash
# Dual-runtime ORM CI (Node path) — Phase 5 publish note.
# Monorepo has no GitHub Actions yet; call this from CI when added, or locally:
#   ./scripts/ci-node-orm.sh
#
# Bun regression suites remain: `bun test` / package `test` scripts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> @bunyad/database Node conformance + ORM whereHas smoke (node:test)"
( cd packages/database && bun run test:node )

echo "==> @bunyad/nestjs unit smoke (bun:test; module shape + sqlite factory)"
( cd packages/nestjs && bun test )

echo "OK ci-node-orm"
