/**
 * Unit/integration tests — product linking, backfill & sale totals
 * (productBackfill.ts + sale-items syncSaleTotals)
 *
 * Runs against the real dev Postgres (DATABASE_URL); no Odoo connection.
 * Covers:
 *  1. Deleting ALL items of an imported order never zeroes
 *     pesoTotalOdoo/volumenTotalOdoo (regression).
 *  2. Confirming an article's dimensions propagates weight/measures to
 *     linked items and recalculates totals by quantity
 *     (0.5 kg, 10×10×10 cm × 200 units → 100 kg, 0.2 m³).
 *  3. The backfill is idempotent (second run changes nothing).
 *  4. Items whose description lacks the "[REF] name" format stay unlinked
 *     and are counted as unmatched.
 *
 * Run with: pnpm --filter @workspace/e2e run test:api
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, salesTable, saleItemsTable, productsTable } from "@workspace/db";
import {
  backfillSaleItemProducts,
  propagateDimensionsForProduct,
} from "../../artifacts/api-server/src/services/productBackfill";
import { syncSaleTotals } from "../../artifacts/api-server/src/routes/sale-items";

const BASE = 91_600_000 + Math.floor(Math.random() * 1000) * 100;
const createdSaleIds: number[] = [];
const createdProductIds: number[] = [];

async function createSale(overrides: Partial<typeof salesTable.$inferInsert> = {}) {
  const [sale] = await db
    .insert(salesTable)
    .values({
      cliente: "Cliente Test Backfill",
      destino: "Destino Test",
      estado: "pendiente",
      pesoTotal: 0,
      volumenTotal: 0,
      ...overrides,
    })
    .returning();
  createdSaleIds.push(sale!.id);
  return sale!;
}

async function createProduct(overrides: Partial<typeof productsTable.$inferInsert> = {}) {
  const [product] = await db
    .insert(productsTable)
    .values({
      odooId: BASE + createdProductIds.length + 1,
      nombre: "Artículo Test",
      pesoOdoo: 0,
      volumenOdoo: 0,
      activo: true,
      dimensionesConfirmadas: false,
      ...overrides,
    })
    .returning();
  createdProductIds.push(product!.id);
  return product!;
}

afterAll(async () => {
  if (createdSaleIds.length)
    await db.delete(salesTable).where(inArray(salesTable.id, createdSaleIds)); // items cascade
  if (createdProductIds.length)
    await db.delete(productsTable).where(inArray(productsTable.id, createdProductIds));
});

describe("Sale totals — deleting all items of an imported order", () => {
  it("never zeroes pesoTotalOdoo / volumenTotalOdoo and falls back to them", async () => {
    const sale = await createSale({
      pesoTotal: 500,
      volumenTotal: 1.5,
      pesoTotalOdoo: 500,
      volumenTotalOdoo: 1.5,
      odooId: BASE + 90,
      odooRef: `SO-TEST-${BASE}`,
    });
    const [item] = await db
      .insert(saleItemsTable)
      .values({
        ventaId: sale.id,
        descripcion: "Bulto temporal",
        cantidad: 1,
        pesoUnitario: 500,
        largo: 100,
        ancho: 100,
        alto: 150,
      })
      .returning();

    // Delete ALL items, then recalc as the DELETE route does.
    await db.delete(saleItemsTable).where(eq(saleItemsTable.id, item!.id));
    await syncSaleTotals(sale.id);

    const [after] = await db.select().from(salesTable).where(eq(salesTable.id, sale.id));
    expect(after!.pesoTotalOdoo).toBe(500);
    expect(after!.volumenTotalOdoo).toBe(1.5);
    // Local totals fall back to the original Odoo totals, not 0.
    expect(after!.pesoTotal).toBe(500);
    expect(after!.volumenTotal).toBe(1.5);
  });
});

describe("Dimension propagation from confirmed product", () => {
  it("0.5 kg / 10×10×10 cm × 200 units → pesoTotal 100 kg, volumenTotal 0.2 m³", async () => {
    const product = await createProduct({
      nombre: "Caja Chica",
      odooRef: `REF-PROP-${BASE}`,
      pesoKg: 0.5,
      largoCm: 10,
      anchoCm: 10,
      altoCm: 10,
      dimensionesConfirmadas: true,
    });
    const sale = await createSale({ pesoTotalOdoo: 123, volumenTotalOdoo: 4.56 });
    await db.insert(saleItemsTable).values({
      ventaId: sale.id,
      productId: product.id,
      descripcion: "Caja Chica",
      cantidad: 200,
      pesoUnitario: 0,
      largo: 0,
      ancho: 0,
      alto: 0,
    });

    const result = await propagateDimensionsForProduct(product.id);
    expect(result.itemsUpdated).toBe(1);

    const [item] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.ventaId, sale.id));
    expect(item!.pesoUnitario).toBe(0.5);
    expect(item!.largo).toBe(10);

    const [after] = await db.select().from(salesTable).where(eq(salesTable.id, sale.id));
    expect(after!.pesoTotal).toBeCloseTo(100, 2);
    expect(after!.volumenTotal).toBeCloseTo(0.2, 4);
    // Odoo originals untouched.
    expect(after!.pesoTotalOdoo).toBe(123);
    expect(after!.volumenTotalOdoo).toBe(4.56);
  });
});

describe("Backfill — linking, unmatched counting & idempotency", () => {
  it("links '[REF] name' items, leaves malformed descriptions unmatched, and a second run is a no-op", async () => {
    const product = await createProduct({
      nombre: "Tarima Grande",
      odooRef: `REF-BF-${BASE}`,
      pesoKg: 12,
      largoCm: 120,
      anchoCm: 100,
      altoCm: 15,
      dimensionesConfirmadas: true,
    });
    const sale = await createSale();
    const [linkable] = await db
      .insert(saleItemsTable)
      .values({
        ventaId: sale.id,
        descripcion: `[REF-BF-${BASE}] Tarima Grande`,
        cantidad: 3,
        pesoUnitario: 0,
        largo: 0,
        ancho: 0,
        alto: 0,
      })
      .returning();
    const [malformed] = await db
      .insert(saleItemsTable)
      .values({
        ventaId: sale.id,
        descripcion: "Producto sin referencia con formato libre",
        cantidad: 1,
        pesoUnitario: 0,
        largo: 0,
        ancho: 0,
        alto: 0,
      })
      .returning();

    const first = await backfillSaleItemProducts();
    expect(first.linked).toBeGreaterThanOrEqual(1);
    expect(first.unmatched).toBeGreaterThanOrEqual(1);

    const [linkedAfter] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.id, linkable!.id));
    expect(linkedAfter!.productId).toBe(product.id);
    expect(linkedAfter!.pesoUnitario).toBe(12);
    expect(linkedAfter!.largo).toBe(120);

    const [malformedAfter] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.id, malformed!.id));
    expect(malformedAfter!.productId).toBeNull();

    // Second run: nothing new to link or update anywhere.
    const second = await backfillSaleItemProducts();
    expect(second.linked).toBe(0);
    expect(second.dimensionsUpdated).toBe(0);
    expect(second.salesRecalculated).toBe(0);
    // Malformed item still counted as unmatched, still unlinked.
    expect(second.unmatched).toBeGreaterThanOrEqual(1);
    const [malformedAfter2] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.id, malformed!.id));
    expect(malformedAfter2!.productId).toBeNull();
  });
});
