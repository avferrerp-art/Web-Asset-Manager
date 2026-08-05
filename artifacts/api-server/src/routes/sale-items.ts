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

// Manually link a sale item to a catalog product (mirrors backfill logic).
// Solo asocia el productId; los totales de la venta vienen SIEMPRE de Odoo.
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

  const [item] = await db.update(saleItemsTable).set({ productId: product.id })
    .where(eq(saleItemsTable.id, params.data.itemId))
    .returning();

  res.json(item);
});

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
  await recalcSales([params.data.saleId]);
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
  res.json(item);
});

router.delete("/sales/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteSaleItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.delete(saleItemsTable)
    .where(eq(saleItemsTable.id, params.data.itemId))
    .returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.sendStatus(204);
});

export default router;
