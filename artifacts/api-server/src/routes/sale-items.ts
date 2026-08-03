import { Router, type IRouter } from "express";
import { eq, isNull } from "drizzle-orm";
import { db, saleItemsTable, salesTable, productsTable } from "@workspace/db";
import {
  ListSaleItemsParams,
  CreateSaleItemParams,
  CreateSaleItemBody,
  UpdateSaleItemParams,
  UpdateSaleItemBody,
  DeleteSaleItemParams,
  LinkSaleItemProductParams,
  LinkSaleItemProductBody,
} from "@workspace/api-zod";
import { recalcSales } from "../services/productBackfill";

const router: IRouter = Router();

// List sale items that have no linked catalog product
router.get("/sale-items/sin-vincular", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: saleItemsTable.id,
      ventaId: saleItemsTable.ventaId,
      descripcion: saleItemsTable.descripcion,
      cantidad: saleItemsTable.cantidad,
      cliente: salesTable.cliente,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.ventaId, salesTable.id))
    .where(isNull(saleItemsTable.productId))
    .orderBy(saleItemsTable.ventaId, saleItemsTable.id);
  res.json(rows);
});

// Manually link a sale item to a catalog product (mirrors backfill logic)
router.post("/sale-items/:itemId/vincular", async (req, res): Promise<void> => {
  const params = LinkSaleItemProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = LinkSaleItemProductBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(saleItemsTable)
    .where(eq(saleItemsTable.id, params.data.itemId));
  if (!existing) { res.status(404).json({ error: "Item not found" }); return; }

  const [product] = await db.select().from(productsTable)
    .where(eq(productsTable.id, body.data.productId));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  // Same update shape as the backfill: set productId, copy dimensions only
  // when the product has confirmed dimensions. Never touches Odoo totals.
  const update: Record<string, unknown> = { productId: product.id };
  if (product.dimensionesConfirmadas) {
    update.pesoUnitario = product.pesoKg ?? 0;
    update.largo = product.largoCm ?? 0;
    update.ancho = product.anchoCm ?? 0;
    update.alto = product.altoCm ?? 0;
  }
  const [item] = await db.update(saleItemsTable).set(update)
    .where(eq(saleItemsTable.id, params.data.itemId))
    .returning();

  await recalcSales([item.ventaId]);
  res.json(item);
});

export async function syncSaleTotals(ventaId: number) {
  const items = await db.select().from(saleItemsTable).where(eq(saleItemsTable.ventaId, ventaId));
  if (items.length === 0) {
    // Sin partidas: no pisar con 0 los totales originales de Odoo (si existen)
    const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, ventaId));
    if (sale && (sale.pesoTotalOdoo != null || sale.volumenTotalOdoo != null)) {
      await db
        .update(salesTable)
        .set({
          pesoTotal: sale.pesoTotalOdoo ?? 0,
          volumenTotal: sale.volumenTotalOdoo ?? 0,
        })
        .where(eq(salesTable.id, ventaId));
      return;
    }
    await db.update(salesTable).set({ pesoTotal: 0, volumenTotal: 0 }).where(eq(salesTable.id, ventaId));
    return;
  }
  const pesoTotal = items.reduce((sum, it) => sum + it.cantidad * it.pesoUnitario, 0);
  const volumenTotal = items.reduce((sum, it) => {
    const vol = (it.largo * it.ancho * it.alto) / 1_000_000;
    return sum + it.cantidad * vol;
  }, 0);
  await db.update(salesTable).set({ pesoTotal, volumenTotal }).where(eq(salesTable.id, ventaId));
}

router.get("/sales/:saleId/items", async (req, res): Promise<void> => {
  const params = ListSaleItemsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const items = await db.select().from(saleItemsTable)
    .where(eq(saleItemsTable.ventaId, params.data.saleId))
    .orderBy(saleItemsTable.createdAt);
  res.json(items);
});

router.post("/sales/:saleId/items", async (req, res): Promise<void> => {
  const params = CreateSaleItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateSaleItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [item] = await db.insert(saleItemsTable)
    .values({ ...parsed.data, ventaId: params.data.saleId })
    .returning();
  await syncSaleTotals(params.data.saleId);
  res.status(201).json(item);
});

router.patch("/sales/items/:itemId", async (req, res): Promise<void> => {
  const params = UpdateSaleItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateSaleItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [item] = await db.update(saleItemsTable).set(parsed.data)
    .where(eq(saleItemsTable.id, params.data.itemId))
    .returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  await syncSaleTotals(item.ventaId);
  res.json(item);
});

router.delete("/sales/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteSaleItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.delete(saleItemsTable)
    .where(eq(saleItemsTable.id, params.data.itemId))
    .returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  await syncSaleTotals(item.ventaId);
  res.sendStatus(204);
});

export default router;
