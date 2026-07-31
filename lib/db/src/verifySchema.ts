import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { pool } from "./index";
import * as schema from "./schema";

export interface SchemaProblem {
  kind: "missing_table" | "missing_column" | "missing_unique";
  table: string;
  detail: string;
}

/**
 * Compares every table defined in the Drizzle schema (lib/db/src/schema)
 * against the live database: table existence, column existence, and
 * single-column UNIQUE constraints (matched by column, not by name).
 * Returns a list of problems; it never throws for mismatches.
 */
export async function verifySchema(): Promise<SchemaProblem[]> {
  const problems: SchemaProblem[] = [];

  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];

  const { rows: colRows } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const dbColumns = new Map<string, Set<string>>();
  for (const r of colRows) {
    if (!dbColumns.has(r.table_name)) dbColumns.set(r.table_name, new Set());
    dbColumns.get(r.table_name)!.add(r.column_name);
  }

  const { rows: uniqueRows } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT i.indrelid::regclass::text AS table_name, a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indisunique AND i.indnkeyatts = 1
       AND i.indrelid::regclass::text NOT LIKE 'pg_%'`,
  );
  const dbUniques = new Set(uniqueRows.map((r) => `${r.table_name}.${r.column_name}`));

  for (const table of tables) {
    const config = getTableConfig(table);
    const tableName = config.name;
    const existing = dbColumns.get(tableName);
    if (!existing) {
      problems.push({
        kind: "missing_table",
        table: tableName,
        detail: `table "${tableName}" does not exist in the database`,
      });
      continue;
    }
    for (const column of config.columns) {
      if (!existing.has(column.name)) {
        problems.push({
          kind: "missing_column",
          table: tableName,
          detail: `column "${tableName}"."${column.name}" is missing`,
        });
      } else if (
        (column.isUnique || column.primary) &&
        !dbUniques.has(`${tableName}.${column.name}`)
      ) {
        problems.push({
          kind: "missing_unique",
          table: tableName,
          detail: `UNIQUE constraint/index on "${tableName}"."${column.name}" is missing (upserts with ON CONFLICT on this column will fail)`,
        });
      }
    }
  }

  return problems;
}
