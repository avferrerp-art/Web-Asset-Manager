import { pool } from "./index";
import { migrations } from "./migrations";

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies embedded SQL migrations (lib/db/src/migrations) that have not yet
 * run against this database. Tracking table: `_migrations`. Each migration
 * runs inside a transaction; an advisory lock prevents concurrent runners.
 */
export async function runMigrations(): Promise<MigrationRunResult> {
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM _migrations",
    );
    const done = new Set(rows.map((r) => r.name));

    for (const migration of migrations) {
      if (done.has(migration.name)) {
        skipped.push(migration.name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
          migration.name,
        ]);
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration "${migration.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
}
