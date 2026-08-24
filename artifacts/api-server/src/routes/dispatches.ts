import { Router, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { db, dispatchesTable, salesTable, vehiclesTable, personnelTable, routePointsTable, travelCostsTable, tollRoutesTable, routeTollsTable, routeWaypointsTable, fuelPricesTable, saleItemsTable } from "@workspace/db";
import { computeRouteCostBreakdown, type RouteCostBreakdown, type RouteTramo } from "../lib/routeCost";
import { syncLinkedDispatchEntity } from "../services/dispatchEstadoSync";
import { getTraslado, getTrasladoSummary } from "../services/trasladoQueries";
import { effectiveDispatchMeasure, exceedsDispatchCapacity } from "../services/dispatchCapacity";
import {
  reassignDispatchViaje,
  updateDispatchPreservingViaje,
  ViajeInputError,
} from "../services/viajeQueries";
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
    assistantRate = assistant?.tarifaPorKm ?? 0;
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

  const costoViaticos = distanciaKm * ((driver?.tarifaPorKm ?? 0) + assistantRate);

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

export { exceedsDispatchCapacity } from "../services/dispatchCapacity";

export async function buildDispatchRow(d: typeof dispatchesTable.$inferSelect) {
  const [sale, traslado, vehicle, driver] = await Promise.all([
    d.tipo === "venta" && d.ventaId !== null
      ? db.select().from(salesTable).where(eq(salesTable.id, d.ventaId)).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    d.tipo === "traslado" && d.trasladoId !== null
      ? getTrasladoSummary(d.trasladoId)
      : Promise.resolve(null),
    db.select().from(vehiclesTable).where(eq(vehiclesTable.id, d.vehiculoId)).then((rows) => rows[0] ?? null),
    db.select().from(personnelTable).where(eq(personnelTable.id, d.choferId)).then((rows) => rows[0] ?? null),
  ]);
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
    referencia: sale?.odooRef ?? traslado?.referencia ?? null,
    origen: sale?.almacenOrigen ?? traslado?.almacenOrigen?.nombre ?? null,
    destino: sale?.destino ?? traslado?.almacenDestino?.nombre ?? null,
  };
}

export async function buildDispatchDetail(d: typeof dispatchesTable.$inferSelect) {
  const [row, points, costsResult] = await Promise.all([
    buildDispatchRow(d),
    db.select().from(routePointsTable).where(eq(routePointsTable.despachoId, d.id)).orderBy(routePointsTable.orden),
    db.select().from(travelCostsTable).where(eq(travelCostsTable.despachoId, d.id)),
  ]);
  if (d.tipo === "traslado" && d.trasladoId !== null) {
    const traslado = await getTraslado(d.trasladoId);
    const pesoOdooKg = traslado?.pesoCalculadoKg ?? null;
    const volumenOdooM3 = traslado?.volumenCalculadoM3 ?? null;
    return {
      ...row,
      pesoOdooKg,
      volumenOdooM3,
      pesoTotal: effectiveDispatchMeasure(pesoOdooKg, d.pesoEstimadoKg),
      volumenTotal: effectiveDispatchMeasure(volumenOdooM3, d.volumenEstimadoM3),
      pesoOrigen: pesoOdooKg !== null ? "odoo" : d.pesoEstimadoKg !== null ? "estimado" : null,
      volumenOrigen: volumenOdooM3 !== null ? "odoo" : d.volumenEstimadoM3 !== null ? "estimado" : null,
      pesoEstimadoKg: d.pesoEstimadoKg,
      volumenEstimadoM3: d.volumenEstimadoM3,
      saleItems: [],
      cargoItems: (traslado?.lineas ?? []).map((linea) => ({
        productId: linea.productoId,
        descripcion: linea.descripcion,
        cantidad: linea.demanda,
        unidad: linea.unidad,
      })),
      routePoints: points,
      costs: costsResult[0] ?? null,
    };
  }

  const [saleResult, saleItemsResult] =
    d.ventaId === null
      ? [[], []] as const
      : await Promise.all([
          db.select().from(salesTable).where(eq(salesTable.id, d.ventaId)),
          db.select().from(saleItemsTable).where(eq(saleItemsTable.ventaId, d.ventaId)),
        ]);
  const sale = saleResult[0] ?? null;
  const pesoOdooKg = sale?.pesoTotal ?? null;
  const volumenOdooM3 = sale?.volumenTotal ?? null;
  return {
    ...row,
    pesoOdooKg,
    volumenOdooM3,
    pesoTotal: effectiveDispatchMeasure(pesoOdooKg, d.pesoEstimadoKg, true),
    volumenTotal: effectiveDispatchMeasure(volumenOdooM3, d.volumenEstimadoM3, true),
    pesoOrigen: pesoOdooKg != null && pesoOdooKg > 0 ? "odoo" : d.pesoEstimadoKg !== null ? "estimado" : null,
    volumenOrigen: volumenOdooM3 != null && volumenOdooM3 > 0 ? "odoo" : d.volumenEstimadoM3 !== null ? "estimado" : null,
    pesoEstimadoKg: d.pesoEstimadoKg,
    volumenEstimadoM3: d.volumenEstimadoM3,
    saleItems: saleItemsResult,
    cargoItems: saleItemsResult.map((item) => ({
      productId: item.productId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      unidad: null,
    })),
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

  const sale =
    dispatchData.tipo === "venta"
      ? await db.select().from(salesTable).where(eq(salesTable.id, dispatchData.ventaId)).then((rows) => rows[0] ?? null)
      : null;
  const traslado =
    dispatchData.tipo === "traslado"
      ? await getTraslado(dispatchData.trasladoId)
      : null;
  if (dispatchData.tipo === "venta" && !sale) {
    res.status(400).json({ error: "La venta indicada no existe" });
    return;
  }
  if (dispatchData.tipo === "traslado" && !traslado) {
    res.status(400).json({ error: "El traslado indicado no existe" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, dispatchData.vehiculoId));
  if (!vehicle) {
    res.status(400).json({ error: "El vehículo indicado no existe" });
    return;
  }
  // null = sin dato en Odoo → no bloquea el despacho (no se puede comparar lo que no se conoce)
  const pesoCarga = effectiveDispatchMeasure(
    dispatchData.tipo === "venta" ? sale?.pesoTotal : traslado?.pesoCalculadoKg,
    dispatchData.pesoEstimadoKg,
    dispatchData.tipo === "venta",
  );
  const volumenCarga = effectiveDispatchMeasure(
    dispatchData.tipo === "venta" ? sale?.volumenTotal : traslado?.volumenCalculadoM3,
    dispatchData.volumenEstimadoM3,
    dispatchData.tipo === "venta",
  );
  if (exceedsDispatchCapacity(vehicle, { pesoKg: pesoCarga, volumenM3: volumenCarga })) {
    const fuente = dispatchData.tipo === "venta" ? "esta venta" : "este traslado";
    res.status(400).json({
      error: "vehicle_capacity_exceeded",
      message: `El vehículo ${vehicle.modelo} (capacidad ${vehicle.capacidadPeso}kg / ${vehicle.capacidadVolumen}m³) no alcanza para la carga de ${fuente} (${pesoCarga ?? "sin dato"}kg / ${volumenCarga ?? "sin dato"}m³).`,
    });
    return;
  }

  const resolvedDistanciaKm = await resolveDistancia(dispatchData);
  const [dispatch] = await db
    .insert(dispatchesTable)
    .values({
      ...dispatchData,
      ventaId: dispatchData.tipo === "venta" ? dispatchData.ventaId : null,
      trasladoId: dispatchData.tipo === "traslado" ? dispatchData.trasladoId : null,
      distanciaKm: resolvedDistanciaKm,
    })
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

  await syncLinkedDispatchEntity(dispatch);

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

  let updateData: Record<string, unknown> = parsed.data;
  let existing: typeof dispatchesTable.$inferSelect | null = null;
  const capacityFieldsChanged =
    "routeId" in parsed.data ||
    "distanciaKm" in parsed.data ||
    "distanciaManual" in parsed.data ||
    "viajeId" in parsed.data ||
    "vehiculoId" in parsed.data ||
    "choferId" in parsed.data ||
    "ayudanteId" in parsed.data ||
    "pesoEstimadoKg" in parsed.data ||
    "volumenEstimadoM3" in parsed.data;
  if (capacityFieldsChanged) {
    [existing] = await db.select().from(dispatchesTable).where(eq(dispatchesTable.id, params.data.id));
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
  const targetViajeId = parsed.data.viajeId;
  const hasViajePatch =
    "viajeId" in parsed.data &&
    targetViajeId !== undefined;
  const updatesCargo =
    "pesoEstimadoKg" in parsed.data || "volumenEstimadoM3" in parsed.data;
  const changesViajeAssignments =
    "vehiculoId" in parsed.data ||
    "choferId" in parsed.data ||
    "ayudanteId" in parsed.data;
  const willBelongToViaje = hasViajePatch
    ? targetViajeId !== null
    : existing?.viajeId !== null && existing?.viajeId !== undefined;
  if (changesViajeAssignments && willBelongToViaje) {
    res.status(400).json({
      error: "dispatch_assignments_owned_by_viaje",
      message:
        "El vehículo, chofer y ayudante de un despacho agrupado deben editarse desde el viaje.",
    });
    return;
  }
  if (
    existing &&
    !hasViajePatch &&
    ("vehiculoId" in parsed.data ||
      "pesoEstimadoKg" in parsed.data ||
      "volumenEstimadoM3" in parsed.data)
  ) {
    const candidate = { ...existing, ...parsed.data };
    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, candidate.vehiculoId));
    if (!vehicle) {
      res.status(400).json({ error: "El vehículo indicado no existe" });
      return;
    }
    const sale =
      candidate.tipo === "venta" && candidate.ventaId !== null
        ? await db.select().from(salesTable).where(eq(salesTable.id, candidate.ventaId)).then((rows) => rows[0] ?? null)
        : null;
    const traslado =
      candidate.tipo === "traslado" && candidate.trasladoId !== null
        ? await getTraslado(candidate.trasladoId)
        : null;
    const pesoCarga = effectiveDispatchMeasure(
      candidate.tipo === "venta" ? sale?.pesoTotal : traslado?.pesoCalculadoKg,
      candidate.pesoEstimadoKg,
      candidate.tipo === "venta",
    );
    const volumenCarga = effectiveDispatchMeasure(
      candidate.tipo === "venta" ? sale?.volumenTotal : traslado?.volumenCalculadoM3,
      candidate.volumenEstimadoM3,
      candidate.tipo === "venta",
    );
    if (exceedsDispatchCapacity(vehicle, { pesoKg: pesoCarga, volumenM3: volumenCarga })) {
      res.status(400).json({
        error: "vehicle_capacity_exceeded",
        message: `El vehículo ${vehicle.modelo} no alcanza para la carga efectiva del despacho ${candidate.id} (${pesoCarga ?? "sin dato"}kg / ${volumenCarga ?? "sin dato"}m³).`,
      });
      return;
    }
  }
  let dispatch: typeof dispatchesTable.$inferSelect | null = null;
  if (hasViajePatch || updatesCargo) {
    try {
      dispatch = hasViajePatch
        ? await reassignDispatchViaje(
            params.data.id,
            targetViajeId!,
            updateData,
          )
        : await updateDispatchPreservingViaje(params.data.id, updateData);
    } catch (error) {
      if (error instanceof ViajeInputError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  } else {
    [dispatch] = await db
      .update(dispatchesTable)
      .set(updateData)
      .where(eq(dispatchesTable.id, params.data.id))
      .returning();
  }
  if (!dispatch) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  if ("estado" in parsed.data) {
    await syncLinkedDispatchEntity(dispatch);
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
  await syncLinkedDispatchEntity(dispatch);
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
  await syncLinkedDispatchEntity(dispatch);
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
