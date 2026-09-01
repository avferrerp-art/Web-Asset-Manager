import { Router, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { db, dispatchesTable, salesTable, trasladosTable, vehiclesTable, personnelTable, routePointsTable, travelCostsTable, tollRoutesTable, routeTollsTable, routeWaypointsTable, fuelPricesTable, saleItemsTable } from "@workspace/db";
import { computeRouteCostBreakdown, type RouteCostBreakdown, type RouteTramo } from "../lib/routeCost";
import { syncLinkedDispatchEntity } from "../services/dispatchEstadoSync";
import { getTraslado, getTrasladoSummary } from "../services/trasladoQueries";
import {
  effectivePartialDispatchMeasure,
  exceedsDispatchCapacity,
  hasPositivePartialCargoQuota,
} from "../services/dispatchCapacity";
import {
  reassignDispatchViaje,
  updateDispatchPreservingViaje,
  ViajeInputError,
} from "../services/viajeQueries";
import {
  DispatchConflictError,
  lockDispatchConflictScopes,
  validateOperationalConflicts,
  validateOrderLoadCoherence,
  validateDispatchCandidate,
} from "../services/dispatchConflicts";
import {
  ListDispatchesQueryParams,
  CreateDispatchBody,
  CreateDispatchBatchBody,
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

class DispatchBatchInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly tramoIndex?: number,
  ) {
    super(message);
    this.name = "DispatchBatchInputError";
  }
}

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
      pesoTotal: effectivePartialDispatchMeasure(d.cargaParcial, pesoOdooKg, d.pesoEstimadoKg),
      volumenTotal: effectivePartialDispatchMeasure(d.cargaParcial, volumenOdooM3, d.volumenEstimadoM3),
      pesoOrigen: d.cargaParcial && d.pesoEstimadoKg != null ? "estimado" : pesoOdooKg !== null ? "odoo" : d.pesoEstimadoKg !== null ? "estimado" : null,
      volumenOrigen: d.cargaParcial && d.volumenEstimadoM3 != null ? "estimado" : volumenOdooM3 !== null ? "odoo" : d.volumenEstimadoM3 !== null ? "estimado" : null,
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
    pesoTotal: effectivePartialDispatchMeasure(d.cargaParcial, pesoOdooKg, d.pesoEstimadoKg, true),
    volumenTotal: effectivePartialDispatchMeasure(d.cargaParcial, volumenOdooM3, d.volumenEstimadoM3, true),
    pesoOrigen: d.cargaParcial && d.pesoEstimadoKg != null ? "estimado" : pesoOdooKg != null && pesoOdooKg > 0 ? "odoo" : d.pesoEstimadoKg !== null ? "estimado" : null,
    volumenOrigen: d.cargaParcial && d.volumenEstimadoM3 != null ? "estimado" : volumenOdooM3 != null && volumenOdooM3 > 0 ? "odoo" : d.volumenEstimadoM3 !== null ? "estimado" : null,
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
  if (!hasPositivePartialCargoQuota(dispatchData)) {
    res.status(400).json({
      error: "partial_cargo_quota_required",
      message: "Un despacho de carga parcial requiere una cuota positiva de peso o volumen.",
    });
    return;
  }

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
  const pesoCarga = effectivePartialDispatchMeasure(
    dispatchData.cargaParcial ?? false,
    dispatchData.tipo === "venta" ? sale?.pesoTotal : traslado?.pesoCalculadoKg,
    dispatchData.pesoEstimadoKg,
    dispatchData.tipo === "venta",
  );
  const volumenCarga = effectivePartialDispatchMeasure(
    dispatchData.cargaParcial ?? false,
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
  let dispatch: typeof dispatchesTable.$inferSelect;
  try {
    dispatch = await db.transaction(async (tx) => {
      const candidate = {
        ...dispatchData,
        id: 0,
        ventaId: dispatchData.tipo === "venta" ? dispatchData.ventaId : null,
        trasladoId: dispatchData.tipo === "traslado" ? dispatchData.trasladoId : null,
        ayudanteId: dispatchData.ayudanteId ?? null,
        estado: "pre-despacho",
        cargaParcial: dispatchData.cargaParcial ?? false,
        viajeId: null,
      };
      await validateDispatchCandidate(tx, candidate);
      const [created] = await tx
        .insert(dispatchesTable)
        .values({
          ...dispatchData,
          ventaId: candidate.ventaId,
          trasladoId: candidate.trasladoId,
          ayudanteId: candidate.ayudanteId,
          distanciaKm: resolvedDistanciaKm,
        })
        .returning();
      const initialPeajes = created!.totalPeajes ?? 0;
      await tx.insert(travelCostsTable).values({
        despachoId: created!.id,
        costoPeajes: initialPeajes,
        costoCombustible: 0,
        costoViaticos: 0,
        total: initialPeajes,
      });
      if (routePoints && routePoints.length > 0) {
        await tx.insert(routePointsTable).values(
          routePoints.map((rp) => ({ ...rp, despachoId: created!.id })),
        );
      }
      return created!;
    });
  } catch (error) {
    if (error instanceof DispatchConflictError) {
      res.status(409).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }

  await syncLinkedDispatchEntity(dispatch);

  const row = await buildDispatchRow(dispatch);
  res.status(201).json(row);
});

router.post("/dispatches/batch", async (req, res): Promise<void> => {
  const parsed = CreateDispatchBatchBody.safeParse(req.body);
  if (!parsed.success) {
    const indexedIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "tramos" && typeof issue.path[1] === "number",
    );
    res.status(400).json({
      error: "invalid_dispatch_batch",
      message: parsed.error.message,
      ...(indexedIssue ? { tramoIndex: indexedIssue.path[1] as number } : {}),
    });
    return;
  }

  const tramos = parsed.data.tramos;
  const orderKey = (tramo: (typeof tramos)[number]) =>
    tramo.tipo === "venta" ? `venta:${tramo.ventaId}` : `traslado:${tramo.trasladoId}`;
  const firstOrderKey = orderKey(tramos[0]!);
  const mixedOrderIndex = tramos.findIndex((tramo) => orderKey(tramo) !== firstOrderKey);
  if (mixedOrderIndex !== -1) {
    res.status(400).json({
      error: "batch_mixed_orders",
      message: "Todos los tramos del lote deben pertenecer a la misma orden.",
      tramoIndex: mixedOrderIndex,
    });
    return;
  }
  const completeLoadIndex = tramos.findIndex((tramo) => !tramo.cargaParcial);
  if (completeLoadIndex !== -1) {
    res.status(400).json({
      error: "batch_partial_load_required",
      message: "Todos los tramos del lote deben ser despachos de carga parcial.",
      tramoIndex: completeLoadIndex,
    });
    return;
  }
  const duplicateIndex = tramos.findIndex((tramo, index) =>
    tramos.slice(0, index).some((previous) =>
      previous.vehiculoId === tramo.vehiculoId &&
      new Date(previous.fechaEstimadaSalida).getTime() === new Date(tramo.fechaEstimadaSalida).getTime() &&
      new Date(previous.fechaEstimadaLlegada).getTime() === new Date(tramo.fechaEstimadaLlegada).getTime(),
    ),
  );
  if (duplicateIndex !== -1) {
    res.status(400).json({
      error: "batch_duplicate_vehicle_window",
      message: "Un vehículo no puede repetirse con la misma ventana dentro del lote.",
      tramoIndex: duplicateIndex,
    });
    return;
  }

  const resolvedDistances = await Promise.all(tramos.map(resolveDistancia));
  let createdDispatches: Array<typeof dispatchesTable.$inferSelect>;
  try {
    createdDispatches = await db.transaction(async (tx) => {
      const candidates = tramos.map((tramo) => ({
        ...tramo,
        id: 0,
        ventaId: tramo.tipo === "venta" ? tramo.ventaId : null,
        trasladoId: tramo.tipo === "traslado" ? tramo.trasladoId : null,
        ayudanteId: tramo.ayudanteId ?? null,
        estado: "pre-despacho",
        cargaParcial: true,
        viajeId: null,
      }));
      await lockDispatchConflictScopes(tx, candidates);

      const created: Array<typeof dispatchesTable.$inferSelect> = [];
      for (const [tramoIndex, tramo] of tramos.entries()) {
        try {
          if (!hasPositivePartialCargoQuota(tramo)) {
            throw new DispatchBatchInputError(
              "partial_cargo_quota_required",
              "Un despacho de carga parcial requiere una cuota positiva de peso o volumen.",
              tramoIndex,
            );
          }
          const [linkedOrder] = tramo.tipo === "venta"
            ? await tx.select().from(salesTable).where(eq(salesTable.id, tramo.ventaId))
            : await tx.select().from(trasladosTable).where(eq(trasladosTable.id, tramo.trasladoId));
          if (!linkedOrder) {
            throw new DispatchBatchInputError(
              tramo.tipo === "venta" ? "sale_not_found" : "transfer_not_found",
              tramo.tipo === "venta" ? "La venta indicada no existe." : "El traslado indicado no existe.",
              tramoIndex,
            );
          }
          const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, tramo.vehiculoId));
          if (!vehicle) {
            throw new DispatchBatchInputError(
              "vehicle_not_found",
              "El vehículo indicado no existe.",
              tramoIndex,
            );
          }
          const linkedMeasures = tramo.tipo === "venta"
            ? {
                peso: (linkedOrder as typeof salesTable.$inferSelect).pesoTotal,
                volumen: (linkedOrder as typeof salesTable.$inferSelect).volumenTotal,
                zeroMeansMissing: true,
              }
            : {
                peso: (linkedOrder as typeof trasladosTable.$inferSelect).pesoCalculadoKg,
                volumen: (linkedOrder as typeof trasladosTable.$inferSelect).volumenCalculadoM3,
                zeroMeansMissing: false,
              };
          const pesoCarga = effectivePartialDispatchMeasure(
            true,
            linkedMeasures.peso,
            tramo.pesoEstimadoKg,
            linkedMeasures.zeroMeansMissing,
          );
          const volumenCarga = effectivePartialDispatchMeasure(
            true,
            linkedMeasures.volumen,
            tramo.volumenEstimadoM3,
            linkedMeasures.zeroMeansMissing,
          );
          if (exceedsDispatchCapacity(vehicle, { pesoKg: pesoCarga, volumenM3: volumenCarga })) {
            throw new DispatchBatchInputError(
              "vehicle_capacity_exceeded",
              `El vehículo ${vehicle.modelo} no alcanza para la cuota del tramo.`,
              tramoIndex,
            );
          }

          const candidate = candidates[tramoIndex]!;
          await validateOperationalConflicts(tx, candidate);
          await validateOrderLoadCoherence(tx, candidate);
          const { routePoints, ...dispatchData } = tramo;
          const [dispatch] = await tx.insert(dispatchesTable).values({
            ...dispatchData,
            ventaId: candidate.ventaId,
            trasladoId: candidate.trasladoId,
            ayudanteId: candidate.ayudanteId,
            distanciaKm: resolvedDistances[tramoIndex],
          }).returning();
          await tx.insert(travelCostsTable).values({
            despachoId: dispatch!.id,
            costoPeajes: dispatch!.totalPeajes ?? 0,
            costoCombustible: 0,
            costoViaticos: 0,
            total: dispatch!.totalPeajes ?? 0,
          });
          if (routePoints && routePoints.length > 0) {
            await tx.insert(routePointsTable).values(
              routePoints.map((point) => ({ ...point, despachoId: dispatch!.id })),
            );
          }
          created.push(dispatch!);
        } catch (error) {
          if (error instanceof DispatchConflictError) {
            (error as DispatchConflictError & { tramoIndex?: number }).tramoIndex = tramoIndex;
          }
          throw error;
        }
      }
      return created;
    });
  } catch (error) {
    if (error instanceof DispatchBatchInputError) {
      res.status(400).json({
        error: error.code,
        message: error.message,
        ...(error.tramoIndex === undefined ? {} : { tramoIndex: error.tramoIndex }),
      });
      return;
    }
    if (error instanceof DispatchConflictError) {
      res.status(409).json({
        error: error.code,
        message: error.message,
        tramoIndex: (error as DispatchConflictError & { tramoIndex?: number }).tramoIndex,
      });
      return;
    }
    throw error;
  }

  await syncLinkedDispatchEntity(createdDispatches[0]!);
  const rows = await Promise.all(createdDispatches.map(buildDispatchRow));
  res.status(201).json(rows);
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
    "volumenEstimadoM3" in parsed.data ||
    "cargaParcial" in parsed.data;
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
  if (
    existing &&
    existing.cargaParcial &&
    parsed.data.cargaParcial === false
  ) {
    updateData = {
      ...updateData,
      pesoEstimadoKg:
        "pesoEstimadoKg" in parsed.data ? parsed.data.pesoEstimadoKg : null,
      volumenEstimadoM3:
        "volumenEstimadoM3" in parsed.data ? parsed.data.volumenEstimadoM3 : null,
    };
  }
  const targetViajeId = parsed.data.viajeId;
  const hasViajePatch =
    "viajeId" in parsed.data &&
    targetViajeId !== undefined;
  const updatesCargo =
    "pesoEstimadoKg" in parsed.data || "volumenEstimadoM3" in parsed.data || "cargaParcial" in parsed.data;
  const changesViajeAssignments =
    "vehiculoId" in parsed.data ||
    "choferId" in parsed.data ||
    "ayudanteId" in parsed.data;
  const willBelongToViaje = hasViajePatch
    ? targetViajeId !== null
    : existing?.viajeId !== null && existing?.viajeId !== undefined;
  if (existing && !hasPositivePartialCargoQuota({ ...existing, ...parsed.data })) {
    res.status(400).json({
      error: "partial_cargo_quota_required",
      message: "Un despacho de carga parcial requiere una cuota positiva de peso o volumen.",
    });
    return;
  }
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
      "volumenEstimadoM3" in parsed.data ||
      "cargaParcial" in parsed.data)
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
    const pesoCarga = effectivePartialDispatchMeasure(
      candidate.cargaParcial,
      candidate.tipo === "venta" ? sale?.pesoTotal : traslado?.pesoCalculadoKg,
      candidate.pesoEstimadoKg,
      candidate.tipo === "venta",
    );
    const volumenCarga = effectivePartialDispatchMeasure(
      candidate.cargaParcial,
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
    try {
      dispatch = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(dispatchesTable)
          .where(eq(dispatchesTable.id, params.data.id))
          .for("update");
        if (!locked) return null;
        const candidate = { ...locked, ...updateData };
        await validateDispatchCandidate(tx, candidate);
        const [updated] = await tx
          .update(dispatchesTable)
          .set(updateData)
          .where(eq(dispatchesTable.id, params.data.id))
          .returning();
        return updated ?? null;
      });
    } catch (error) {
      if (error instanceof DispatchConflictError) {
        res.status(409).json({ error: error.code, message: error.message });
        return;
      }
      throw error;
    }
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
