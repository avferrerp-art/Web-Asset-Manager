import { Router, type IRouter } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, salesTable, deliveriesTable, deliveryItemsTable } from "@workspace/db";
import { ListSaleDeliveriesParams } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /sales/:id/deliveries
 * Returns all albaranes for a sale with items embedded.
 * Ordering: non-cancelled first, then by fechaProgramada desc.
 */
router.get("/sales/:id/deliveries", async (req, res): Promise<void> => {
  const params = ListSaleDeliveriesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const saleId = params.data.id;

  // Verify the sale exists
  const [sale] = await db
    .select({ id: salesTable.id })
    .from(salesTable)
    .where(eq(salesTable.id, saleId))
    .limit(1);
  if (!sale) {
    res.status(404).json({ error: "Venta no encontrada" });
    return;
  }

  // Fetch deliveries ordered: non-cancelled first, then by fechaProgramada desc nulls last
  const deliveries = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.ventaId, saleId))
    .orderBy(
      sql`CASE WHEN ${deliveriesTable.estado} = 'cancel' THEN 1 ELSE 0 END ASC`,
      sql`${deliveriesTable.fechaProgramada} DESC NULLS LAST`,
    );

  // Fetch all items for these deliveries in one query
  const deliveryIds = deliveries.map((d) => d.id);
  const allItems =
    deliveryIds.length > 0
      ? await db
          .select()
          .from(deliveryItemsTable)
          .where(inArray(deliveryItemsTable.deliveryId, deliveryIds))
      : [];

  const itemsByDeliveryId = new Map<number, typeof allItems>();
  for (const item of allItems) {
    if (!itemsByDeliveryId.has(item.deliveryId)) {
      itemsByDeliveryId.set(item.deliveryId, []);
    }
    itemsByDeliveryId.get(item.deliveryId)!.push(item);
  }

  const result = deliveries.map((d) => ({
    id: d.id,
    ventaId: d.ventaId,
    odooId: d.odooId,
    nombre: d.nombre,
    estado: d.estado,
    tipoOperacion: d.tipoOperacion,
    almacenOrigen: d.almacenOrigen,
    almacenCodigo: d.almacenCodigo,
    fechaProgramada: d.fechaProgramada ? d.fechaProgramada.toISOString() : null,
    fechaEfectiva: d.fechaEfectiva ? d.fechaEfectiva.toISOString() : null,
    documentoOrigen: d.documentoOrigen,
    backorderDeOdooId: d.backorderDeOdooId,
    odooWriteDate: d.odooWriteDate,
    lastSyncAt: d.lastSyncAt ? d.lastSyncAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    items: (itemsByDeliveryId.get(d.id) ?? []).map((i) => ({
      id: i.id,
      deliveryId: i.deliveryId,
      productId: i.productId,
      odooMoveId: i.odooMoveId,
      descripcion: i.descripcion,
      cantidadDemanda: i.cantidadDemanda,
      cantidadEntregada: i.cantidadEntregada,
      uom: i.uom,
      estado: i.estado,
    })),
  }));

  res.json(result);
});

export default router;
