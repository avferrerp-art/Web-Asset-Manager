import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, saleItemsTable, salesTable } from "@workspace/db";
import {
  ListSaleItemsParams,
  CreateSaleItemParams,
  CreateSaleItemBody,
  UpdateSaleItemParams,
  UpdateSaleItemBody,
  DeleteSaleItemParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function syncSaleTotals(ventaId: number) {
  const items = await db.select().from(saleItemsTable).where(eq(saleItemsTable.ventaId, ventaId));
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
