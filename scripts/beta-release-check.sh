#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> TypeScript workspace check"
pnpm run typecheck

echo "==> Production artifact builds"
pnpm --filter @workspace/api-server run build
NODE_ENV=production PORT=24024 BASE_PATH=/ \
  pnpm --filter @workspace/logistics run build

echo "==> Deterministic critical unit tests (no database or running server)"
DATABASE_URL=postgresql://release-check.invalid/release_check \
pnpm --filter @workspace/e2e exec vitest run \
  --config vitest.config.ts \
  tests/health.test.ts \
  tests/authorization-policy.test.ts \
  tests/audit-middleware.test.ts \
  tests/odoo-synchronization-coordinator.test.ts \
  tests/odoo-route-busy.test.ts \
  tests/odoo-sync-status.test.ts \
  tests/carga-calculadora.test.ts \
  tests/fleet-split.test.ts

echo "==> Isolated PostgreSQL integration tests"
bash scripts/beta-isolated-integration-check.sh

echo "Beta release check passed."