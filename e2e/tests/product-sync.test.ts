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
import { db, productsTable, runMigrations } from "@workspace/db";

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
    expect(row!.pesoKgOdoo).toBe(99);
    expect(row!.volumenM3Odoo).toBe(9);
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
    expect(row!.pesoKgOdoo).toBeNull();
    expect(row!.volumenM3Odoo).toBeNull();

    mockProductBatch([odooRecord(odooId, { weight: 12.5, volume: 0.75 })]);
    await syncOdooProducts();
    [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.odooId, odooId));
    expect(row!.pesoKgOdoo).toBe(12.5);
    expect(row!.volumenM3Odoo).toBe(0.75);

    mockProductBatch([odooRecord(odooId, { weight: undefined, volume: 0 })]);
    await syncOdooProducts();
    [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.odooId, odooId));
    expect(row!.pesoKgOdoo).toBeNull();
    expect(row!.volumenM3Odoo).toBeNull();
  });
});
