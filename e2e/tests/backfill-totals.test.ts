/**
 * Unit/integration tests — product linking, backfill & sale totals
 * (productBackfill.ts: recalcSales + backfillSaleItemProducts)
 *
 * Runs against the real dev Postgres (DATABASE_URL); no Odoo connection.
 * Covers:
 *  1. recalcSales NEVER overwrites pesoTotalOdoo/volumenTotalOdoo.
 *  2. Los totales locales reflejan SIEMPRE los de Odoo: >0 → se copia,
 *     null o 0 → null ("sin dato", nunca 0).
 *  3. The backfill links "[REF] name" items, leaves malformed
 *     descriptions unmatched, and is idempotent (second run is a no-op).
 *
 * Run with: pnpm --filter @workspace/e2e run test:api
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, salesTable, saleItemsTable, productsTable } from "@workspace/db";
import {
  backfillSaleItemProducts,
  recalcSales,
} from "../../artifacts/api-server/src/services/productBackfill";

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

describe("recalcSales — Odoo totals are the only source of truth", () => {
  it("never overwrites pesoTotalOdoo / volumenTotalOdoo and mirrors them into local totals", async () => {
    const sale = await createSale({
      pesoTotal: 999, // valor local desactualizado a propósito
      volumenTotal: 9.9,
      pesoTotalOdoo: 500,
      volumenTotalOdoo: 1.5,
      odooId: BASE + 90,
      odooRef: `SO-TEST-${BASE}`,
    });

    const updated = await recalcSales([sale.id]);
    expect(updated).toBe(1);

    const [after] = await db.select().from(salesTable).where(eq(salesTable.id, sale.id));
    // Odoo originals untouched.
    expect(after!.pesoTotalOdoo).toBe(500);
    expect(after!.volumenTotalOdoo).toBe(1.5);
    // Local totals mirror Odoo.
    expect(after!.pesoTotal).toBe(500);
    expect(after!.volumenTotal).toBe(1.5);

    // Second run is a no-op.
    expect(await recalcSales([sale.id])).toBe(0);
  });

  it("null or 0 in Odoo → local total null (sin dato), never 0", async () => {
    const sinDato = await createSale({
      pesoTotal: 100,
      volumenTotal: 2,
      pesoTotalOdoo: null,
      volumenTotalOdoo: 0, // 0 en Odoo = sin dato
    });
    await recalcSales([sinDato.id]);
    const [after] = await db.select().from(salesTable).where(eq(salesTable.id, sinDato.id));
    expect(after!.pesoTotal).toBeNull();
    expect(after!.volumenTotal).toBeNull();
    // Odoo columns untouched.
    expect(after!.pesoTotalOdoo).toBeNull();
    expect(after!.volumenTotalOdoo).toBe(0);
  });

  it("mixed: peso with data, volumen without → volumen null only", async () => {
    const mixed = await createSale({ pesoTotalOdoo: 250, volumenTotalOdoo: null });
    await recalcSales([mixed.id]);
    const [after] = await db.select().from(salesTable).where(eq(salesTable.id, mixed.id));
    expect(after!.pesoTotal).toBe(250);
    expect(after!.volumenTotal).toBeNull();
  });
});

describe("Backfill — linking, unmatched counting & idempotency", () => {
  it("links '[REF] name' items, leaves malformed descriptions unmatched, and a second run is a no-op", async () => {
    const product = await createProduct({
      nombre: "Tarima Grande",
      odooRef: `REF-BF-${BASE}`,
    });
    const sale = await createSale({ pesoTotalOdoo: 77, volumenTotalOdoo: 0.7 });
    const [linkable] = await db
      .insert(saleItemsTable)
      .values({
        ventaId: sale.id,
        descripcion: `[REF-BF-${BASE}] Tarima Grande`,
        cantidad: 3,
      })
      .returning();
    const [malformed] = await db
      .insert(saleItemsTable)
      .values({
        ventaId: sale.id,
        descripcion: "Producto sin referencia con formato libre",
        cantidad: 1,
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

    const [malformedAfter] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.id, malformed!.id));
    expect(malformedAfter!.productId).toBeNull();

    // Odoo totals untouched by the backfill; local totals mirror them.
    const [saleAfter] = await db.select().from(salesTable).where(eq(salesTable.id, sale.id));
    expect(saleAfter!.pesoTotalOdoo).toBe(77);
    expect(saleAfter!.volumenTotalOdoo).toBe(0.7);
    expect(saleAfter!.pesoTotal).toBe(77);
    expect(saleAfter!.volumenTotal).toBe(0.7);

    // Second run: nothing new to link or update anywhere.
    const second = await backfillSaleItemProducts();
    expect(second.linked).toBe(0);
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
