import { eq, isNull, inArray, and, isNotNull } from "drizzle-orm";
import { db, saleItemsTable, productsTable, salesTable } from "@workspace/db";

export interface BackfillResult {
  examined: number;
  linked: number;
  dimensionsUpdated: number;
  unmatched: number;
  salesRecalculated: number;
}

// ---------------------------------------------------------------------------
// Core helper: recalculate pesoTotal, volumenTotal, dimensionesIncompletas
// for a batch of sale IDs based on their current items. Never touches
// pesoTotalOdoo / volumenTotalOdoo.
// ---------------------------------------------------------------------------
async function recalcSales(saleIds: number[]): Promise<number> {
  if (saleIds.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < saleIds.length; i += 200) {
    const chunk = saleIds.slice(i, i + 200);
    const rows = await db
      .select({
        ventaId: saleItemsTable.ventaId,
        productId: saleItemsTable.productId,
        cantidad: saleItemsTable.cantidad,
        pesoUnitario: saleItemsTable.pesoUnitario,
        largo: saleItemsTable.largo,
        ancho: saleItemsTable.ancho,
        alto: saleItemsTable.alto,
        dimensionesConfirmadas: productsTable.dimensionesConfirmadas,
      })
      .from(saleItemsTable)
      .leftJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
      .where(inArray(saleItemsTable.ventaId, chunk));

    type SaleAgg = {
      incompleta: boolean;
      peso: number;
      volumen: number;
    };
    const agg = new Map<number, SaleAgg>();
    for (const id of chunk) agg.set(id, { incompleta: false, peso: 0, volumen: 0 });

    for (const r of rows) {
      const a = agg.get(r.ventaId)!;
      if (r.productId === null || !r.dimensionesConfirmadas) a.incompleta = true;
      a.peso += r.cantidad * r.pesoUnitario;
      a.volumen += (r.cantidad * r.largo * r.ancho * r.alto) / 1_000_000;
    }

    const currentSales = await db
      .select({
        id: salesTable.id,
        dimensionesIncompletas: salesTable.dimensionesIncompletas,
        pesoTotal: salesTable.pesoTotal,
        volumenTotal: salesTable.volumenTotal,
      })
      .from(salesTable)
      .where(inArray(salesTable.id, chunk));

    for (const sale of currentSales) {
      const next = agg.get(sale.id);
      if (!next) continue;
      const pesoR = Math.round(next.peso * 100) / 100;
      const volR = Math.round(next.volumen * 10000) / 10000;
      if (
        next.incompleta !== sale.dimensionesIncompletas ||
        pesoR !== sale.pesoTotal ||
        volR !== sale.volumenTotal
      ) {
        await db
          .update(salesTable)
          .set({
            dimensionesIncompletas: next.incompleta,
            pesoTotal: pesoR,
            volumenTotal: volR,
          })
          .where(eq(salesTable.id, sale.id));
        updated++;
      }
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Propagate dimensions from one (or all confirmed) product(s) to their linked
// sale_items. Returns how many items were updated.
// Used by: backfill + automatic trigger on PATCH /products/:id
// ---------------------------------------------------------------------------
export async function propagateDimensionsForProduct(
  productId: number,
): Promise<{ itemsUpdated: number; salesRecalculated: number }> {
  const [product] = await db
    .select({
      id: productsTable.id,
      dimensionesConfirmadas: productsTable.dimensionesConfirmadas,
      pesoKg: productsTable.pesoKg,
      largoCm: productsTable.largoCm,
      anchoCm: productsTable.anchoCm,
      altoCm: productsTable.altoCm,
    })
    .from(productsTable)
    .where(eq(productsTable.id, productId));

  if (!product?.dimensionesConfirmadas) return { itemsUpdated: 0, salesRecalculated: 0 };

  // Find items linked to this product whose dimensions differ from catalog
  const items = await db
    .select({ id: saleItemsTable.id, ventaId: saleItemsTable.ventaId })
    .from(saleItemsTable)
    .where(eq(saleItemsTable.productId, productId));

  if (items.length === 0) return { itemsUpdated: 0, salesRecalculated: 0 };

  let itemsUpdated = 0;
  const touchedSaleIds = new Set<number>();
  for (const item of items) {
    await db
      .update(saleItemsTable)
      .set({
        pesoUnitario: product.pesoKg ?? 0,
        largo: product.largoCm ?? 0,
        ancho: product.anchoCm ?? 0,
        alto: product.altoCm ?? 0,
      })
      .where(eq(saleItemsTable.id, item.id));
    itemsUpdated++;
    touchedSaleIds.add(item.ventaId);
  }
  const salesRecalculated = await recalcSales([...touchedSaleIds]);
  return { itemsUpdated, salesRecalculated };
}

// ---------------------------------------------------------------------------
// Main backfill: idempotent, two phases.
// Phase 1: link items with productId null using [REF] from descripcion.
// Phase 2: push dimensions to all linked items whose product is confirmed.
// ---------------------------------------------------------------------------
export async function backfillSaleItemProducts(): Promise<BackfillResult> {
  // ── Phase 1: link null productId items ──────────────────────────────────
  const nullItems = await db
    .select({
      id: saleItemsTable.id,
      ventaId: saleItemsTable.ventaId,
      descripcion: saleItemsTable.descripcion,
    })
    .from(saleItemsTable)
    .where(isNull(saleItemsTable.productId));

  const products = await db
    .select({
      id: productsTable.id,
      odooRef: productsTable.odooRef,
      dimensionesConfirmadas: productsTable.dimensionesConfirmadas,
      pesoKg: productsTable.pesoKg,
      largoCm: productsTable.largoCm,
      anchoCm: productsTable.anchoCm,
      altoCm: productsTable.altoCm,
    })
    .from(productsTable);
  const byRef = new Map(products.filter((p) => p.odooRef).map((p) => [p.odooRef as string, p]));

  let linked = 0;
  let unmatched = 0;
  const touchedPhase1 = new Set<number>();

  for (const item of nullItems) {
    const match = /^\[([^\]]+)\]/.exec(item.descripcion.trim());
    const product = match ? byRef.get(match[1]) : undefined;
    if (!product) { unmatched++; continue; }

    const update: Record<string, unknown> = { productId: product.id };
    if (product.dimensionesConfirmadas) {
      update.pesoUnitario = product.pesoKg ?? 0;
      update.largo = product.largoCm ?? 0;
      update.ancho = product.anchoCm ?? 0;
      update.alto = product.altoCm ?? 0;
    }
    await db.update(saleItemsTable).set(update).where(eq(saleItemsTable.id, item.id));
    linked++;
    touchedPhase1.add(item.ventaId);
  }

  // ── Phase 2: push dimensions to already-linked items ────────────────────
  // Items that have a productId but still have zero dimensions while their
  // product is confirmed. We also update items whose catalog dimensions have
  // changed (re-run is idempotent because we overwrite the same values).
  const linkedItems = await db
    .select({
      id: saleItemsTable.id,
      ventaId: saleItemsTable.ventaId,
      productId: saleItemsTable.productId,
    })
    .from(saleItemsTable)
    .where(isNotNull(saleItemsTable.productId));

  // Build a quick lookup of confirmed products by id
  const confirmedById = new Map(
    products.filter((p) => p.dimensionesConfirmadas).map((p) => [p.id, p]),
  );

  let dimensionsUpdated = 0;
  const touchedPhase2 = new Set<number>();

  // Get current dim values for comparison to stay idempotent in reporting
  const linkedWithDims = await db
    .select({
      id: saleItemsTable.id,
      ventaId: saleItemsTable.ventaId,
      productId: saleItemsTable.productId,
      pesoUnitario: saleItemsTable.pesoUnitario,
      largo: saleItemsTable.largo,
      ancho: saleItemsTable.ancho,
      alto: saleItemsTable.alto,
    })
    .from(saleItemsTable)
    .where(isNotNull(saleItemsTable.productId));

  for (const item of linkedWithDims) {
    const product = confirmedById.get(item.productId!);
    if (!product) continue;
    const newPeso = product.pesoKg ?? 0;
    const newLargo = product.largoCm ?? 0;
    const newAncho = product.anchoCm ?? 0;
    const newAlto = product.altoCm ?? 0;
    if (
      item.pesoUnitario === newPeso &&
      item.largo === newLargo &&
      item.ancho === newAncho &&
      item.alto === newAlto
    )
      continue; // already in sync
    await db
      .update(saleItemsTable)
      .set({ pesoUnitario: newPeso, largo: newLargo, ancho: newAncho, alto: newAlto })
      .where(eq(saleItemsTable.id, item.id));
    dimensionsUpdated++;
    touchedPhase2.add(item.ventaId);
  }

  const allTouched = new Set([...touchedPhase1, ...touchedPhase2]);
  const salesRecalculated = await recalcSales([...allTouched]);

  return {
    examined: nullItems.length,
    linked,
    dimensionsUpdated,
    unmatched,
    salesRecalculated,
  };
}
