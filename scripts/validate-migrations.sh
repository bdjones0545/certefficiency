#!/bin/sh
set -eu

# `drizzle-kit generate` is an offline validation: it loads every schema file
# and renders SQL without connecting to, or changing, a database.
migration_dir="$(mktemp -d ./lib/db/.drizzle-check.XXXXXX)"
trap 'rm -rf "$migration_dir"' EXIT HUP INT TERM

: "${DATABASE_URL:=postgresql://ci:ci@localhost:5432/certefficiency}"
export DATABASE_URL
DRIZZLE_OUT="./$(basename "$migration_dir")"
export DRIZZLE_OUT

cp -R ./lib/db/drizzle/. "$migration_dir/"

pnpm --filter @workspace/db exec drizzle-kit generate \
  --config ./drizzle.config.ts

if ! diff -ru ./lib/db/drizzle "$migration_dir"; then
  echo "Drizzle schema drift detected. Generate and commit a migration." >&2
  exit 1
fi

echo "Committed Drizzle migrations match the current schema."
