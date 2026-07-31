// Ordered list of embedded SQL migrations. Each module exports { name, sql }.
//
// HOW TO ADD A MIGRATION (when lib/db/src/schema changes):
// 1. Create lib/db/src/migrations/NNNN_short_description.ts (next sequential
//    number) exporting `name` (must match the filename, minus .ts) and `sql`.
//    Write idempotent DDL (IF NOT EXISTS / guarded constraints) — task-branch
//    databases may already have parts of it from `drizzle-kit push`.
// 2. Append the module to the `migrations` array below, in order.
// 3. Restart the api-server workflow: migrations run automatically at boot
//    and are tracked in the `_migrations` table (applied once per database).
import * as baseline from "./0000_baseline";

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [baseline];
