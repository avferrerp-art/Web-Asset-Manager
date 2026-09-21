#!/usr/bin/env bash
set -euo pipefail

# This intentionally never reads DATABASE_URL. It validates only the local
# PostgreSQL dump/restore toolchain with synthetic data in an ephemeral cluster.
workdir="$(mktemp -d)"
data_dir="$workdir/data"
socket_dir="$workdir/socket"
dump_file="$workdir/synthetic.dump"
mkdir -p "$socket_dir"

cleanup() {
  if [[ -d "$data_dir" ]]; then
    pg_ctl -D "$data_dir" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

initdb -D "$data_dir" --username=beta_admin --auth=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$data_dir" \
  -o "-k $socket_dir -c listen_addresses='' -p 55439" \
  -w start >/dev/null

createdb -h "$socket_dir" -p 55439 -U beta_admin beta_source
psql -h "$socket_dir" -p 55439 -U beta_admin -d beta_source -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE restore_fixture (
  id integer PRIMARY KEY,
  payload text NOT NULL
);
INSERT INTO restore_fixture (id, payload)
VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma');
SQL

pg_dump -h "$socket_dir" -p 55439 -U beta_admin -d beta_source \
  --format=custom --file="$dump_file"
createdb -h "$socket_dir" -p 55439 -U beta_admin beta_restored
pg_restore -h "$socket_dir" -p 55439 -U beta_admin -d beta_restored \
  --exit-on-error "$dump_file"

actual="$(
  psql -h "$socket_dir" -p 55439 -U beta_admin -d beta_restored \
    -Atqc "SELECT count(*) || ':' || md5(string_agg(id || ':' || payload, ',' ORDER BY id)) FROM restore_fixture"
)"
expected="3:$(printf '1:alpha,2:beta,3:gamma' | md5sum | cut -d' ' -f1)"

if [[ "$actual" != "$expected" ]]; then
  echo "Synthetic restore verification failed: expected $expected, got $actual" >&2
  exit 1
fi

echo "Synthetic isolated PostgreSQL dump/restore rehearsal passed ($actual)."