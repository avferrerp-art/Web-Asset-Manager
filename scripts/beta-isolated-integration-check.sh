#!/usr/bin/env bash
set -euo pipefail

# This harness never reads or copies the caller's DATABASE_URL. It creates a
# source-only Drizzle schema in an ephemeral local PostgreSQL cluster.
unset DATABASE_URL

cd "$(dirname "$0")/.."

workdir="$(mktemp -d)"
data_dir="$workdir/data"
socket_dir="$workdir/socket"
setup_name=".beta-isolated-setup-$$.ts"
config_name=".beta-isolated-vitest-$$.config.ts"
setup_file="$PWD/e2e/$setup_name"
config_file="$PWD/e2e/$config_name"
mkdir -p "$socket_dir"

cleanup() {
  if [[ -d "$data_dir" ]]; then
    pg_ctl -D "$data_dir" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -f "$setup_file" "$config_file"
  rm -rf "$workdir"
}
trap cleanup EXIT

initdb -D "$data_dir" --username=beta_admin --auth=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$data_dir" \
  -o "-k $socket_dir -c listen_addresses='' -p 55440" \
  -w start >/dev/null
createdb -h "$socket_dir" -p 55440 -U beta_admin beta_integration

encoded_socket="${socket_dir//\//%2F}"
export DATABASE_URL="postgresql://beta_admin@localhost/beta_integration?host=$encoded_socket&port=55440"
# Authorization fails closed unless an administrator bootstrap is configured.
# This synthetic value is local to the test process and is not a credential.
export ADMIN_EMAILS="release-admin@test.invalid"

cat >"$setup_file" <<'SETUP'
import { beforeEach } from "vitest";

beforeEach(() => {
  process.env.ADMIN_EMAILS = "release-admin@test.invalid";
});
SETUP
cat >"$config_file" <<CONFIG
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({ test: { setupFiles: ["./$setup_name"] } }),
);
CONFIG

echo "    Bootstrapping isolated database from the Drizzle schema"
pnpm --filter @workspace/db run push-force

echo "    Running critical integration files sequentially"
pnpm --filter @workspace/e2e exec vitest run \
  --config "$config_name" \
  --maxWorkers=1 \
  --no-file-parallelism \
  tests/dispatches-traslados.test.ts \
  tests/viajes.test.ts \
  tests/actas-llegada.test.ts \
  tests/almacen-access-api.test.ts

echo "Isolated PostgreSQL integration check passed."