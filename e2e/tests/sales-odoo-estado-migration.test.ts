import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { sql as migrationSql } from "../../lib/db/src/migrations/0019_sales_odoo_estado";

describe("0019_sales_odoo_estado migration", () => {
  it("is repeatable, nullable without a default, and backfills existing sales", async () => {
    const client = await pool.connect();
    const schemaName = `sales_odoo_estado_${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE sales (
          id serial PRIMARY KEY,
          cliente text NOT NULL
        );
        INSERT INTO sales (cliente) VALUES ('venta anterior');
      `);

      await client.query(migrationSql);
      await client.query(
        `INSERT INTO sales (cliente, odoo_estado) VALUES ('cotización conservada', 'draft')`,
      );
      await client.query(migrationSql);
      await client.query(`INSERT INTO sales (cliente) VALUES ('venta posterior')`);

      const { rows: columns } = await client.query<{
        is_nullable: string;
        column_default: string | null;
      }>(`
        SELECT is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'sales'
          AND column_name = 'odoo_estado'
      `);
      expect(columns).toEqual([{ is_nullable: "YES", column_default: null }]);

      const { rows } = await client.query<{ cliente: string; odoo_estado: string | null }>(`
        SELECT cliente, odoo_estado
        FROM sales
        ORDER BY id
      `);
      expect(rows).toEqual([
        { cliente: "venta anterior", odoo_estado: "sale" },
        { cliente: "cotización conservada", odoo_estado: "draft" },
        { cliente: "venta posterior", odoo_estado: null },
      ]);
    } finally {
      await client.query("SET search_path TO public").catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
      client.release();
    }
  });
});