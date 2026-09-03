# Database migrations

Drizzle migrations in `drizzle/` are the source of truth for application-owned
tables in the PostgreSQL `public` schema. Stripe Sync owns its separate `stripe`
schema and is not managed here.

## New databases

Set `DATABASE_URL`, then run:

```sh
pnpm --filter @workspace/db run migrate
```

This applies the full baseline followed by every later migration.

## Existing databases created before this baseline

Do not run `0000_baseline.sql` against an existing CertEfficiency database: its
tables already exist. First back up the database and verify that its public
schema matches `0000_snapshot.json`. Then record only the baseline as applied:

```sql
BEGIN;
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
  'c4afe5b14664e7c0bcd0d4a91ce8a0adc54324bd63d84ce4ed442531e91fc470',
  1788409060895
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE created_at >= 1788409060895
);
COMMIT;
```

After that, run the normal `migrate` command. It starts with
`0001_integrity_constraints.sql`. Unique indexes intentionally fail rather than
silently discard duplicate production records; resolve any reported duplicates
and rerun the migration.

## Making schema changes

1. Edit the TypeScript schema under `src/schema/`.
2. Run `pnpm --filter @workspace/db run generate`.
3. Review both the generated SQL and snapshot metadata.
4. Run `pnpm run migrations:check` at the workspace root.
5. Commit the schema, SQL migration, and metadata together.

Never use `push-force` in production. It bypasses the reviewed migration
history and can perform destructive changes.
