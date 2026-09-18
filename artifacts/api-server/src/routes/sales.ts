import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
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

export async function getSaleDeliveryNames(): Promise<Map<number, string[]>> {
  const albaranes = await db
    .select({
      ventaId: sql<number>`${deliveriesTable.ventaId}`,
      nombre: deliveriesTable.nombre,
    })
    .from(deliveriesTable)
    .where(
      and(
        eq(deliveriesTable.tipo, "venta"),
        isNotNull(deliveriesTable.ventaId),
      ),
    );
  const nombresByVenta = new Map<number, string[]>();
  for (const a of albaranes) {
    const list = nombresByVenta.get(a.ventaId) ?? [];
    list.push(a.nombre);
    nombresByVenta.set(a.ventaId, list);
  }
  return nombresByVenta;
}

router.get("/sales", async (req, res): Promise<void> => {
  // Orval uses Boolean coercion: Boolean("false") is true. Normalize the
  // wire representation explicitly before using the generated contract.
  const includeQuotations = req.query.includeQuotations;
  if (includeQuotations !== undefined && includeQuotations !== "true" && includeQuotations !== "false") {
    res.status(400).json({ error: "includeQuotations must be true or false" });
    return;
  }
  const query = ListSalesQueryParams.safeParse({
    ...req.query,
    includeQuotations: includeQuotations === "true",
  });
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const commercialStates = query.data.includeQuotations
    ? ["draft", "sent", "sale", "done"]
    : ["sale", "done"];
  const results = await db.select().from(salesTable).where(and(
    or(inArray(salesTable.odooEstado, commercialStates), isNull(salesTable.odooEstado)),
    query.data.status ? eq(salesTable.estado, query.data.status) : undefined,
  )).orderBy(desc(salesTable.createdAt));
  // Albarán names per sale, so the list search can match e.g. "CCS/OUT/00278"
  const nombresByVenta = await getSaleDeliveryNames();
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
