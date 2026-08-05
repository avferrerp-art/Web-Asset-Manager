import { eq, isNull, inArray } from "drizzle-orm";
import { db, saleItemsTable, productsTable, salesTable } from "@workspace/db";

export interface BackfillResult {
  examined: number;
  linked: number;
  unmatched: number;
  salesRecalculated: number;
}

// ---------------------------------------------------------------------------
// Core helper: sync pesoTotal / volumenTotal from the Odoo totals for a batch
// of sale IDs. Peso y volumen de una venta son SIEMPRE los de Odoo:
//   - pesoTotalOdoo > 0  → pesoTotal = pesoTotalOdoo
//   - pesoTotalOdoo null o 0 → pesoTotal = null ("sin dato", nunca 0)
// NUNCA toca pesoTotalOdoo / volumenTotalOdoo.
// ---------------------------------------------------------------------------
export async function recalcSales(saleIds: number[]): Promise<number> {
  if (saleIds.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < saleIds.length; i += 200) {
    const chunk = saleIds.slice(i, i + 200);
    const currentSales = await db
      .select({
        id: salesTable.id,
        pesoTotal: salesTable.pesoTotal,
        volumenTotal: salesTable.volumenTotal,
        pesoTotalOdoo: salesTable.pesoTotalOdoo,
        volumenTotalOdoo: salesTable.volumenTotalOdoo,
      })
      .from(salesTable)
      .where(inArray(salesTable.id, chunk));

    for (const sale of currentSales) {
      const nextPeso =
        sale.pesoTotalOdoo != null && sale.pesoTotalOdoo > 0 ? sale.pesoTotalOdoo : null;
      const nextVol =
        sale.volumenTotalOdoo != null && sale.volumenTotalOdoo > 0
          ? sale.volumenTotalOdoo
          : null;
      if (nextPeso !== sale.pesoTotal || nextVol !== sale.volumenTotal) {
        await db
          .update(salesTable)
          .set({ pesoTotal: nextPeso, volumenTotal: nextVol })
          .where(eq(salesTable.id, sale.id));
        updated++;
      }
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Backfill: idempotent, single phase.
// Vincula partidas con productId null al catálogo usando la referencia
// "[NTSxxxxxx]" al inicio de la descripción. Ya no propaga dimensiones
// (el módulo de medición manual fue eliminado; peso/volumen vienen de Odoo).
// ---------------------------------------------------------------------------
export async function backfillSaleItemProducts(): Promise<BackfillResult> {
  const nullItems = await db
    .select({
      id: saleItemsTable.id,
      ventaId: saleItemsTable.ventaId,
      descripcion: saleItemsTable.descripcion,
    })
    .from(saleItemsTable)
    .where(isNull(saleItemsTable.productId));

  const products = await db
    .select({ id: productsTable.id, odooRef: productsTable.odooRef })
    .from(productsTable);
  const byRef = new Map(products.filter((p) => p.odooRef).map((p) => [p.odooRef as string, p]));

  let linked = 0;
  let unmatched = 0;
  const touched = new Set<number>();

  for (const item of nullItems) {
    const match = /^\[([^\]]+)\]/.exec(item.descripcion.trim());
    const product = match ? byRef.get(match[1]) : undefined;
    if (!product) { unmatched++; continue; }
    await db
      .update(saleItemsTable)
      .set({ productId: product.id })
      .where(eq(saleItemsTable.id, item.id));
    linked++;
    touched.add(item.ventaId);
  }

  const salesRecalculated = await recalcSales([...touched]);

  return {
    examined: nullItems.length,
    linked,
    unmatched,
    salesRecalculated,
  };
}
