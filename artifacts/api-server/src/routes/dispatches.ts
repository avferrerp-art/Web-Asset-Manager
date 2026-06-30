import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, dispatchesTable, salesTable, vehiclesTable, personnelTable, routePointsTable, travelCostsTable, tollRoutesTable, routeTollsTable } from "@workspace/db";
import {
  ListDispatchesQueryParams,
  CreateDispatchBody,
  GetDispatchParams,
  UpdateDispatchParams,
  UpdateDispatchBody,
  DeleteDispatchParams,
  ApproveDispatchParams,
  GetDispatchCostsParams,
  UpdateDispatchCostsParams,
  UpdateDispatchCostsBody,
  ListRoutePointsParams,
  AddRoutePointParams,
  AddRoutePointBody,
  DeleteRoutePointParams,
  EstimateDispatchCostsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildDispatchRow(d: typeof dispatchesTable.$inferSelect) {
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, d.ventaId));
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, d.vehiculoId));
  const [driver] = await db.select().from(personnelTable).where(eq(personnelTable.id, d.choferId));
  let assistant = null;
  if (d.ayudanteId) {
    const [a] = await db.select().from(personnelTable).where(eq(personnelTable.id, d.ayudanteId));
    assistant = a ?? null;
  }
  return {
    ...d,
    vehiculoModelo: vehicle?.modelo ?? null,
    choferNombre: driver?.nombre ?? null,
    ayudanteNombre: assistant?.nombre ?? null,
    clienteNombre: sale?.cliente ?? null,
    destino: sale?.destino ?? null,
  };
}

router.get("/dispatches", async (req, res): Promise<void> => {
  const query = ListDispatchesQueryParams.safeParse(req.query);
  let dispatches = await db.select().from(dispatchesTable).orderBy(dispatchesTable.createdAt);
  if (query.success && query.data.status) {
    dispatches = dispatches.filter((d) => d.estado === query.data.status);
  }
  const rows = await Promise.all(dispatches.map(buildDispatchRow));
  res.json(rows);
});

router.post("/dispatches", async (req, res): Promise<void> => {
  const parsed = CreateDispatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { routePoints, ...dispatchData } = parsed.data;
  const [dispatch] = await db.insert(dispatchesTable).values(dispatchData).returning();

  await db.insert(travelCostsTable).values({
    despachoId: dispatch.id,
    costoPeajes: 0,
    costoCombustible: 0,
    costoViaticos: 0,
    total: 0,
  });

  if (routePoints && routePoints.length > 0) {
    await db.insert(routePointsTable).values(
      routePoints.map((rp) => ({ ...rp, despachoId: dispatch.id })),
    );
  }

  await db.update(salesTable).set({ estado: "despachado" }).where(eq(salesTable.id, dispatch.ventaId));

  const row = await buildDispatchRow(dispatch);
  res.status(201).json(row);
});

router.get("/dispatches/:id", async (req, res): Promise<void> => {
  const params = GetDispatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [dispatch] = await db.select().from(dispatchesTable).where(eq(dispatchesTable.id, params.data.id));
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  const row = await buildDispatchRow(dispatch);
  const points = await db.select().from(routePointsTable).where(eq(routePointsTable.despachoId, params.data.id)).orderBy(routePointsTable.orden);
  const [costs] = await db.select().from(travelCostsTable).where(eq(travelCostsTable.despachoId, params.data.id));
  res.json({ ...row, routePoints: points, costs: costs ?? null });
});

router.patch("/dispatches/:id", async (req, res): Promise<void> => {
  const params = UpdateDispatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDispatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [dispatch] = await db.update(dispatchesTable).set(parsed.data).where(eq(dispatchesTable.id, params.data.id)).returning();
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  const row = await buildDispatchRow(dispatch);
  res.json(row);
});

router.delete("/dispatches/:id", async (req, res): Promise<void> => {
  const params = DeleteDispatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [dispatch] = await db.delete(dispatchesTable).where(eq(dispatchesTable.id, params.data.id)).returning();
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/dispatches/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveDispatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [dispatch] = await db
    .update(dispatchesTable)
    .set({ estado: "en-ruta" })
    .where(eq(dispatchesTable.id, params.data.id))
    .returning();
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  const row = await buildDispatchRow(dispatch);
  res.json(row);
});

router.get("/dispatches/:id/costs", async (req, res): Promise<void> => {
  const params = GetDispatchCostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [costs] = await db.select().from(travelCostsTable).where(eq(travelCostsTable.despachoId, params.data.id));
  if (!costs) {
    res.status(404).json({ error: "Costs not found" });
    return;
  }
  res.json(costs);
});

router.patch("/dispatches/:id/costs", async (req, res): Promise<void> => {
  const params = UpdateDispatchCostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDispatchCostsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const total = (data.costoPeajes ?? 0) + (data.costoCombustible ?? 0) + (data.costoViaticos ?? 0);
  const [costs] = await db
    .update(travelCostsTable)
    .set({ ...data, total })
    .where(eq(travelCostsTable.despachoId, params.data.id))
    .returning();
  if (!costs) {
    res.status(404).json({ error: "Costs not found" });
    return;
  }
  res.json(costs);
});

router.get("/dispatches/:id/route-points", async (req, res): Promise<void> => {
  const params = ListRoutePointsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const points = await db
    .select()
    .from(routePointsTable)
    .where(eq(routePointsTable.despachoId, params.data.id))
    .orderBy(routePointsTable.orden);
  res.json(points);
});

router.post("/dispatches/:id/route-points", async (req, res): Promise<void> => {
  const params = AddRoutePointParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddRoutePointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [point] = await db
    .insert(routePointsTable)
    .values({ ...parsed.data, despachoId: params.data.id })
    .returning();
  res.status(201).json(point);
});

router.delete("/dispatches/:dispatchId/route-points/:pointId", async (req, res): Promise<void> => {
  const params = DeleteRoutePointParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [point] = await db
    .delete(routePointsTable)
    .where(and(eq(routePointsTable.id, params.data.pointId), eq(routePointsTable.despachoId, params.data.dispatchId)))
    .returning();
  if (!point) {
    res.status(404).json({ error: "Route point not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/dispatches/:id/estimate-costs", async (req, res): Promise<void> => {
  const params = EstimateDispatchCostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [dispatch] = await db.select().from(dispatchesTable).where(eq(dispatchesTable.id, params.data.id));
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, dispatch.vehiculoId));
  const [driver] = await db.select().from(personnelTable).where(eq(personnelTable.id, dispatch.choferId));

  let assistantRate = 0;
  if (dispatch.ayudanteId) {
    const [assistant] = await db.select().from(personnelTable).where(eq(personnelTable.id, dispatch.ayudanteId));
    assistantRate = assistant?.tarifaViaticos ?? 0;
  }

  const distanciaKm = dispatch.distanciaKm ?? 100;
  const rendimiento = vehicle?.rendimientoKmLitro ?? 10;
  const costoPorLitro = 1.5;
  const litrosEstimados = distanciaKm / rendimiento;
  const costoCombustible = litrosEstimados * costoPorLitro;

  const salida = new Date(dispatch.fechaEstimadaSalida);
  const llegada = new Date(dispatch.fechaEstimadaLlegada);
  const dias = Math.max(1, Math.ceil((llegada.getTime() - salida.getTime()) / (1000 * 60 * 60 * 24)));

  const costoViaticos = dias * ((driver?.tarifaViaticos ?? 0) + assistantRate);

  let costoPeajes = 0;
  if (dispatch.routeId) {
    const routeTolls = await db.select().from(routeTollsTable).where(eq(routeTollsTable.routeId, dispatch.routeId));
    costoPeajes = routeTolls.length * (vehicle?.tarifaPeaje ?? 0);
  }

  const total = costoCombustible + costoViaticos + costoPeajes;

  res.json({ costoCombustible, costoViaticos, costoPeajes, total, dias, litrosEstimados, distanciaKm, costoPorLitro });
});

export default router;
