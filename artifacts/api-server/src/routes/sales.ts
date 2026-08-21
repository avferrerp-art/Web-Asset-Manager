import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, salesTable, deliveriesTable } from "@workspace/db";
import {
  ListSalesQueryParams,
  CreateSaleBody,
  GetSaleParams,
  UpdateSaleParams,
  UpdateSaleBody,
  DeleteSaleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sales", async (req, res): Promise<void> => {
  const query = ListSalesQueryParams.safeParse(req.query);
  let results = await db.select().from(salesTable).orderBy(desc(salesTable.createdAt));
  if (query.success && query.data.status) {
    results = results.filter((s) => s.estado === query.data.status);
  }
  // Albarán names per sale, so the list search can match e.g. "CCS/OUT/00278"
  const albaranes = await db
    .select({ ventaId: deliveriesTable.ventaId, nombre: deliveriesTable.nombre })
    .from(deliveriesTable);
  const nombresByVenta = new Map<number, string[]>();
  for (const a of albaranes) {
    if (a.ventaId === null) continue;
    const list = nombresByVenta.get(a.ventaId) ?? [];
    list.push(a.nombre);
    nombresByVenta.set(a.ventaId, list);
  }
  res.json(results.map((s) => ({ ...s, albaranNombres: nombresByVenta.get(s.id) ?? [] })));
});

router.post("/sales", async (req, res): Promise<void> => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = { ...parsed.data, estado: parsed.data.estado ?? "pendiente" };
  const [sale] = await db.insert(salesTable).values(data).returning();
  res.status(201).json(sale);
});

router.get("/sales/:id", async (req, res): Promise<void> => {
  const params = GetSaleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, params.data.id));
  if (!sale) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  res.json(sale);
});

router.patch("/sales/:id", async (req, res): Promise<void> => {
  const params = UpdateSaleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [sale] = await db.update(salesTable).set(parsed.data).where(eq(salesTable.id, params.data.id)).returning();
  if (!sale) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  res.json(sale);
});

router.delete("/sales/:id", async (req, res): Promise<void> => {
  const params = DeleteSaleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [sale] = await db.delete(salesTable).where(eq(salesTable.id, params.data.id)).returning();
  if (!sale) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
