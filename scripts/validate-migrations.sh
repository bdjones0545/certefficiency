#!/bin/sh
set -eu

# `drizzle-kit generate` is an offline validation: it loads every schema file
# and renders SQL without connecting to, or changing, a database.
migration_dir="$(mktemp -d)"
trap 'rm -rf "$migration_dir"' EXIT HUP INT TERM

: "${DATABASE_URL:=postgresql://ci:ci@localhost:5432/certefficiency}"
export DATABASE_URL
DRIZZLE_OUT="$migration_dir"
export DRIZZLE_OUT

pnpm --filter @workspace/db exec drizzle-kit generate \
  --config ./drizzle.config.ts

if ! find "$migration_dir" -type f -name '*.sql' -print -quit | grep -q .; then
  echo "Drizzle did not generate a migration from the current schema." >&2
  exit 1
fi

echo "Drizzle schema and migration generation are valid."
