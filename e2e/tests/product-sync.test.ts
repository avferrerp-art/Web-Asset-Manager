/**
 * Unit/integration tests — Odoo product sync (productSync.ts)
 *
 * The Odoo client is fully mocked (no real Odoo connection); the DB is the
 * real dev Postgres (DATABASE_URL). Covers:
 *  1. Running the sync twice does not duplicate products (upsert by odooId).
 *  2. The manually edited field (`notas`, the only editable field) is NEVER
 *     overwritten by a re-sync — the golden rule.
 *  3. The sync only requests products of type 'product' or 'consu'.
 *
 * Run with: pnpm --filter @workspace/e2e run test:api
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Mock the Odoo client BEFORE importing the service under test.
const executeKwMock = vi.fn();
vi.mock("../../artifacts/api-server/src/lib/odooClient", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../artifacts/api-server/src/lib/odooClient")
  >();
  return {
    ...actual,
    getOdooConfig: () => ({ url: "http://odoo.test", db: "test", username: "t", apiKey: "k" }),
    authenticate: async () => 1,
    executeKw: (...args: unknown[]) => executeKwMock(...args),
  };
});

import { syncOdooProducts } from "../../artifacts/api-server/src/services/productSync";
import { db, pool, productsTable, runMigrations } from "@workspace/db";
import { sql as productMeasurementsMigrationSql } from "../../lib/db/src/migrations/0009_product_measurements";

// Unique odooIds far away from real data to avoid collisions.
const BASE = 90_500_000 + Math.floor(Math.random() * 1000) * 100;
const ODOO_IDS = [BASE + 1, BASE + 2, BASE + 3];

function odooRecord(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    default_code: `TST-${id}`,
    name: `Producto Test ${id}`,
    categ_id: [1, "Categoría Test"] as [number, string],
    uom_id: [1, "Unidades"] as [number, string],
    weight: 2.5,
    volume: 0.01,
    active: true,
    type: "product",
    ...overrides,
  };
}

function mockProductBatch(records: unknown[]) {
  executeKwMock.mockImplementation(async (_cfg, _uid, model, method) => {
    if (model === "product.product" && method === "search_read") return records;
    throw new Error(`Unexpected Odoo call: ${model}.${method}`);
  });
}

async function cleanup() {
  await db.delete(productsTable).where(inArray(productsTable.odooId, ODOO_IDS));
}

beforeAll(async () => {
  await runMigrations();
  await cleanup();
});
afterAll(cleanup);

describe("Odoo product sync", () => {
  it("keeps only nullable canonical measurement columns and the migration is repeatable", async () => {
    await pool.query(productMeasurementsMigrationSql);

    const { rows: columns } = await pool.query<{ column_name: string; is_nullable: string }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN (
          'peso_odoo',
          'volumen_odoo',
          'peso_kg_odoo',
          'volumen_m3_odoo'
        )
      ORDER BY column_name
    `);
    expect(columns).toEqual([
      { column_name: "peso_odoo", is_nullable: "YES" },
      { column_name: "volumen_odoo", is_nullable: "YES" },
    ]);

    const { rows: invalidMeasurements } = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM products
      WHERE peso_odoo IS NOT NULL AND peso_odoo <= 0
         OR volumen_odoo IS NOT NULL AND volumen_odoo <= 0
    `);
    expect(invalidMeasurements[0]!.count).toBe(0);
  });

  it("refuses to drop duplicate measurement columns when they contradict canonical data", async () => {
    const client = await pool.connect();
    const schemaName = `product_measurements_${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE "products" (
          "id" integer PRIMARY KEY,
          "peso_odoo" real DEFAULT 0 NOT NULL,
          "volumen_odoo" real DEFAULT 0 NOT NULL,
          "peso_kg_odoo" real,
          "volumen_m3_odoo" real
        );
        INSERT INTO "products" (
          "id",
          "peso_odoo",
          "volumen_odoo",
          "peso_kg_odoo",
          "volumen_m3_odoo"
        ) VALUES (1, 10, 2, 11, 2);
      `);

      await expect(client.query(productMeasurementsMigrationSql)).rejects.toThrow(
        /duplicate columns contain different data/,
      );

      const { rows } = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'products'
          AND column_name IN ('peso_kg_odoo', 'volumen_m3_odoo')
        ORDER BY column_name
      `);
      expect(rows.map((row) => row.column_name)).toEqual([
        "peso_kg_odoo",
        "volumen_m3_odoo",
      ]);
    } finally {
      await client.query("SET search_path TO public").catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
      client.release();
    }
  });

  it("preserves matching legacy measurements, normalizes sentinels, and drops duplicates", async () => {
    const client = await pool.connect();
    const schemaName = `product_measurements_ok_${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE "products" (
          "id" integer PRIMARY KEY,
          "peso_odoo" real DEFAULT 0 NOT NULL,
          "volumen_odoo" real DEFAULT 0 NOT NULL,
          "peso_kg_odoo" real,
          "volumen_m3_odoo" real
        );
        INSERT INTO "products" (
          "id",
          "peso_odoo",
          "volumen_odoo",
          "peso_kg_odoo",
          "volumen_m3_odoo"
        ) VALUES
          (1, 10, 2, 10, 2),
          (2, 0, -1, NULL, NULL),
          (3, 5, 0, NULL, NULL);
      `);

      await client.query(productMeasurementsMigrationSql);
      await client.query(productMeasurementsMigrationSql);

      const { rows: products } = await client.query<{
        id: number;
        peso_odoo: number | null;
        volumen_odoo: number | null;
      }>(`
        SELECT id, peso_odoo, volumen_odoo
        FROM products
        ORDER BY id
      `);
      expect(products).toEqual([
        { id: 1, peso_odoo: 10, volumen_odoo: 2 },
        { id: 2, peso_odoo: null, volumen_odoo: null },
        { id: 3, peso_odoo: 5, volumen_odoo: null },
      ]);

      const { rows: duplicateColumns } = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'products'
          AND column_name IN ('peso_kg_odoo', 'volumen_m3_odoo')
      `);
      expect(duplicateColumns).toHaveLength(0);
    } finally {
      await client.query("SET search_path TO public").catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
      client.release();
    }
  });

  it("requests only products of type 'product' or 'consu' (excludes services)", async () => {
    mockProductBatch([odooRecord(ODOO_IDS[0]!)]);
    await syncOdooProducts();

    const searchReadCalls = executeKwMock.mock.calls.filter(
      (c) => c[2] === "product.product" && c[3] === "search_read",
    );
    expect(searchReadCalls.length).toBeGreaterThan(0);
    for (const call of searchReadCalls) {
      const domain = (call[4] as unknown[][])[0] as unknown[];
      expect(domain).toContainEqual(["type", "in", ["product", "consu"]]);
    }
  });

  it("running the sync twice does not duplicate products (upsert by odooId)", async () => {
    mockProductBatch(ODOO_IDS.slice(0, 2).map((id) => odooRecord(id)));

    const first = await syncOdooProducts();
    expect(first.total).toBe(2);

    const second = await syncOdooProducts();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);

    const rows = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(inArray(productsTable.odooId, ODOO_IDS));
    expect(rows).toHaveLength(2); // one row per odooId, no duplicates
  });

  it("re-sync NEVER overwrites manually edited notas (golden rule)", async () => {
    mockProductBatch([odooRecord(ODOO_IDS[0]!)]);
    await syncOdooProducts();

    // Team annotates the product (notas is the only editable field).
    await db
      .update(productsTable)
      .set({ notas: "nota manual" })
      .where(eq(productsTable.odooId, ODOO_IDS[0]!));

    // Odoo changes its own fields; re-sync.
    mockProductBatch([
      odooRecord(ODOO_IDS[0]!, { name: "Nombre Actualizado Odoo", weight: 99, volume: 9 }),
    ]);
    await syncOdooProducts();

    const [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.odooId, ODOO_IDS[0]!));
    expect(row).toBeDefined();
    // Odoo-owned fields updated…
    expect(row!.nombre).toBe("Nombre Actualizado Odoo");
    expect(row!.pesoOdoo).toBe(99);
    expect(row!.volumenOdoo).toBe(9);
    // …manual field untouched.
    expect(row!.notas).toBe("nota manual");
  });

  it("stores non-positive or absent Odoo measurements as null on create and update", async () => {
    const odooId = ODOO_IDS[2]!;

    mockProductBatch([odooRecord(odooId, { weight: 0, volume: -1 })]);
    await syncOdooProducts();

    let [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.odooId, odooId));
    expect(row!.pesoOdoo).toBeNull();
    expect(row!.volumenOdoo).toBeNull();

    mockProductBatch([odooRecord(odooId, { weight: 12.5, volume: 0.75 })]);
    await syncOdooProducts();
    [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.odooId, odooId));
    expect(row!.pesoOdoo).toBe(12.5);
    expect(row!.volumenOdoo).toBe(0.75);

    mockProductBatch([odooRecord(odooId, { weight: undefined, volume: 0 })]);
    await syncOdooProducts();
    [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.odooId, odooId));
    expect(row!.pesoOdoo).toBeNull();
    expect(row!.volumenOdoo).toBeNull();
  });
});
