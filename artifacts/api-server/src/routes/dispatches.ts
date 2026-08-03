import { Router, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { db, dispatchesTable, salesTable, vehiclesTable, personnelTable, routePointsTable, travelCostsTable, tollRoutesTable, routeTollsTable, routeWaypointsTable, fuelPricesTable, saleItemsTable } from "@workspace/db";
import { computeRouteCostBreakdown, type RouteCostBreakdown, type RouteTramo } from "../lib/routeCost";
import { syncSaleEstadoFromDispatch } from "../services/saleEstadoSync";
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
  EstimateDispatchCostsPreviewBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

interface CostEstimateInputs {
  vehiculoId: number;
  choferId: number;
  ayudanteId?: number | null;
  fechaEstimadaSalida: string;
  fechaEstimadaLlegada: string;
  distanciaKm?: number | null;
  routeId?: number | null;
}

async function fetchRouteCostBreakdown(routeId: number): Promise<RouteCostBreakdown | null> {
  const [route] = await db.select().from(tollRoutesTable).where(eq(tollRoutesTable.id, routeId));
  if (!route) return null;
  const tolls = await db.select().from(routeTollsTable).where(eq(routeTollsTable.routeId, routeId));
  const waypoints = await db
    .select()
    .from(routeWaypointsTable)
    .where(eq(routeWaypointsTable.routeId, routeId))
    .orderBy(asc(routeWaypointsTable.orden));
  return computeRouteCostBreakdown(route, tolls, waypoints);
}

async function computeCostEstimate(inputs: CostEstimateInputs) {
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, inputs.vehiculoId));
  const [driver] = await db.select().from(personnelTable).where(eq(personnelTable.id, inputs.choferId));

  let assistantRate = 0;
  if (inputs.ayudanteId) {
    const [assistant] = await db.select().from(personnelTable).where(eq(personnelTable.id, inputs.ayudanteId));
    assistantRate = assistant?.tarifaViaticos ?? 0;
  }

  const distanciaKm = inputs.distanciaKm ?? 100;
  const rendimiento = vehicle?.rendimientoKmLitro ?? 10;

  if (!vehicle?.tipoCombustible) {
    throw new Error(`No se pudo determinar el tipo de combustible del vehículo ${inputs.vehiculoId}`);
  }
  const [fuelPrice] = await db
    .select()
    .from(fuelPricesTable)
    .where(eq(fuelPricesTable.tipoCombustible, vehicle.tipoCombustible));
  if (!fuelPrice) {
    throw new Error(
      `No hay un precio de combustible configurado para "${vehicle.tipoCombustible}". Configúralo en Vehículos > Precios de combustible antes de continuar.`
    );
  }
  const costoPorLitro = fuelPrice.precioPorLitro;

  const litrosEstimados = distanciaKm / rendimiento;
  const costoCombustible = litrosEstimados * costoPorLitro;

  const salida = new Date(inputs.fechaEstimadaSalida);
  const llegada = new Date(inputs.fechaEstimadaLlegada);
  const dias = Math.max(1, Math.ceil((llegada.getTime() - salida.getTime()) / (1000 * 60 * 60 * 24)));

  const costoViaticos = dias * ((driver?.tarifaViaticos ?? 0) + assistantRate);

  let costoPeajes = 0;
  let tramos: RouteTramo[] | undefined;
  if (inputs.routeId) {
    const breakdown = await fetchRouteCostBreakdown(inputs.routeId);
    if (breakdown) {
      costoPeajes = breakdown.costoPeajesTotal;
      tramos = breakdown.tramos;
    }
  }

  const total = costoCombustible + costoViaticos + costoPeajes;

  return { costoCombustible, costoViaticos, costoPeajes, total, dias, litrosEstimados, distanciaKm, costoPorLitro, tramos };
}

async function resolveDistancia(dispatchData: {
  routeId?: number | null;
  distanciaKm?: number | null;
  distanciaManual?: boolean;
}) {
  if (dispatchData.routeId && !dispatchData.distanciaManual) {
    const breakdown = await fetchRouteCostBreakdown(dispatchData.routeId);
    if (breakdown) {
      return breakdown.distanciaTotalKm;
    }
  }
  return dispatchData.distanciaKm ?? null;
}

export async function buildDispatchRow(d: typeof dispatchesTable.$inferSelect) {
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

export async function buildDispatchDetail(d: typeof dispatchesTable.$inferSelect) {
  const [row, points, costsResult, saleResult, saleItemsResult] = await Promise.all([
    buildDispatchRow(d),
    db.select().from(routePointsTable).where(eq(routePointsTable.despachoId, d.id)).orderBy(routePointsTable.orden),
    db.select().from(travelCostsTable).where(eq(travelCostsTable.despachoId, d.id)),
    db.select().from(salesTable).where(eq(salesTable.id, d.ventaId)),
    db.select().from(saleItemsTable).where(eq(saleItemsTable.ventaId, d.ventaId)),
  ]);
  const sale = saleResult[0] ?? null;
  return {
    ...row,
    pesoTotal: sale?.pesoTotal ?? null,
    volumenTotal: sale?.volumenTotal ?? null,
    saleItems: saleItemsResult,
    routePoints: points,
    costs: costsResult[0] ?? null,
  };
}

router.get("/dispatches", async (req, res): Promise<void> => {
  const query = ListDispatchesQueryParams.safeParse(req.query);
  let dispatches = await db.select().from(dispatchesTable).orderBy(desc(dispatchesTable.createdAt));
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

  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, dispatchData.ventaId));
  if (!sale) {
    res.status(400).json({ error: "La venta indicada no existe" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, dispatchData.vehiculoId));
  if (!vehicle) {
    res.status(400).json({ error: "El vehículo indicado no existe" });
    return;
  }
  if (vehicle.capacidadPeso < sale.pesoTotal || vehicle.capacidadVolumen < sale.volumenTotal) {
    res.status(400).json({
      error: "vehicle_capacity_exceeded",
      message: `El vehículo ${vehicle.modelo} (capacidad ${vehicle.capacidadPeso}kg / ${vehicle.capacidadVolumen}m³) no alcanza para la carga de esta venta (${sale.pesoTotal}kg / ${sale.volumenTotal}m³).`,
    });
    return;
  }

  const resolvedDistanciaKm = await resolveDistancia(dispatchData);
  const [dispatch] = await db
    .insert(dispatchesTable)
    .values({ ...dispatchData, distanciaKm: resolvedDistanciaKm })
    .returning();

  const initialPeajes = dispatch.totalPeajes ?? 0;
  await db.insert(travelCostsTable).values({
    despachoId: dispatch.id,
    costoPeajes: initialPeajes,
    costoCombustible: 0,
    costoViaticos: 0,
    total: initialPeajes,
  });

  if (routePoints && routePoints.length > 0) {
    await db.insert(routePointsTable).values(
      routePoints.map((rp) => ({ ...rp, despachoId: dispatch.id })),
    );
  }

  await syncSaleEstadoFromDispatch(dispatch.ventaId);

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
  const detail = await buildDispatchDetail(dispatch);
  res.json(detail);
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

  let updateData: typeof parsed.data = parsed.data;
  if ("routeId" in parsed.data || "distanciaKm" in parsed.data || "distanciaManual" in parsed.data) {
    const [existing] = await db.select().from(dispatchesTable).where(eq(dispatchesTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    const resolvedDistanciaKm = await resolveDistancia({
      routeId: parsed.data.routeId ?? existing.routeId,
      distanciaKm: parsed.data.distanciaKm ?? existing.distanciaKm,
      distanciaManual: parsed.data.distanciaManual ?? existing.distanciaManual,
    });
    updateData = { ...parsed.data, distanciaKm: resolvedDistanciaKm ?? undefined };
  }

  const [dispatch] = await db.update(dispatchesTable).set(updateData).where(eq(dispatchesTable.id, params.data.id)).returning();
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  if ("estado" in parsed.data) {
    await syncSaleEstadoFromDispatch(dispatch.ventaId);
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
  await syncSaleEstadoFromDispatch(dispatch.ventaId);
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
  await syncSaleEstadoFromDispatch(dispatch.ventaId);
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

  const estimate = await computeCostEstimate({
    vehiculoId: dispatch.vehiculoId,
    choferId: dispatch.choferId,
    ayudanteId: dispatch.ayudanteId,
    fechaEstimadaSalida: dispatch.fechaEstimadaSalida,
    fechaEstimadaLlegada: dispatch.fechaEstimadaLlegada,
    distanciaKm: dispatch.distanciaKm,
    routeId: dispatch.routeId,
  });

  res.json(estimate);
});

router.post("/dispatches/estimate-costs-preview", async (req, res): Promise<void> => {
  const parsed = EstimateDispatchCostsPreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const estimate = await computeCostEstimate(parsed.data);
  res.json(estimate);
});

export default router;
