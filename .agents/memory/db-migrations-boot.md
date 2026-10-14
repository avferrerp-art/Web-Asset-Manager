---
name: DB migrations run at api-server boot
description: How schema changes must be shipped so they survive task merges
---
The api-server applies embedded SQL migrations at startup (`runMigrations()` from `@workspace/db`; SQL lives in `lib/db/src/migrations/*.ts`, tracked in the `_migrations` table) and then runs `verifySchema()` which logs `SCHEMA MISMATCH` for any missing table/column/single-column UNIQUE.

**Why:** manual `drizzle-kit push` fixes did not survive merges to main (products UNIQUE constraint was lost twice), causing opaque 500s in the Odoo sync upserts.

**How to apply:** when changing `lib/db/src/schema/`, also add a numbered idempotent migration file in `lib/db/src/migrations/` and register it in that dir's `index.ts`; restart the api-server workflow to apply. Write DDL idempotently (IF NOT EXISTS, guarded constraints) because task DBs may already have parts of it from push. Don't rely on `drizzle-kit push` alone.
