import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, dispatchesTable, salesTable, vehiclesTable, personnelTable, travelCostsTable, routePointsTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetVehicleScheduleQueryParams,
  GetVehicleScheduleResponse,
  GetActiveDispatchesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [vehicles, dispatches, sales, costs] = await Promise.all([
    db.select().from(vehiclesTable),
    db.select().from(dispatchesTable),
    db.select().from(salesTable),
    db.select().from(travelCostsTable),
  ]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const vehiculosEnRuta = dispatches.filter((d) => d.estado === "en-ruta").length;
  const vehiculosDisponibles = vehicles.length - vehiculosEnRuta;

  const costoTotalEsteMes = costs
    .filter((c) => {
      const dispatch = dispatches.find((d) => d.id === c.despachoId);
      if (!dispatch) return false;
      return new Date(dispatch.createdAt) >= startOfMonth;
    })
    .reduce((sum, c) => sum + (c.total ?? 0), 0);

  const summary = {
    totalVehiculos: vehicles.length,
    vehiculosDisponibles,
    vehiculosEnRuta,
    ventasPendientes: sales.filter((s) => s.estado === "pendiente").length,
    despachosPendientes: dispatches.filter((d) => d.estado === "pre-despacho").length,
    despachosEnRuta: dispatches.filter((d) => d.estado === "en-ruta").length,
    despachosEntregados: dispatches.filter((d) => d.estado === "entregado").length,
    costoTotalEsteMes,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

router.get("/dashboard/vehicle-schedule", async (req, res): Promise<void> => {
  const query = GetVehicleScheduleQueryParams.safeParse(req.query);

  let weekStart: Date;
  if (query.success && query.data.weekStart) {
    weekStart = new Date(query.data.weekStart);
  } else {
    weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
  }

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const vehicles = await db.select().from(vehiclesTable);
  const dispatches = await db.select().from(dispatchesTable);
  const sales = await db.select().from(salesTable);

  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    weekDays.push(d.toISOString().split("T")[0]);
  }

  const schedule = vehicles.map((v) => {
    const vehicleDispatches = dispatches.filter(
      (d) => d.vehiculoId === v.id && d.estado !== "cancelado",
    );

    const diasOcupados = weekDays
      .map((fecha) => {
        const dispatch = vehicleDispatches.find((d) => {
          const salida = d.fechaEstimadaSalida.split("T")[0];
          const llegada = d.fechaEstimadaLlegada.split("T")[0];
          return salida <= fecha && fecha <= llegada;
        });
        if (!dispatch) return null;
        const sale = sales.find((s) => s.id === dispatch.ventaId);
        return {
          fecha,
          despachoId: dispatch.id,
          estado: dispatch.estado,
          destino: sale?.destino ?? "Sin destino",
        };
      })
      .filter(Boolean) as Array<{ fecha: string; despachoId: number; estado: string; destino: string }>;

    return {
      vehiculoId: v.id,
      modelo: v.modelo,
      tipo: v.tipo,
      diasOcupados,
    };
  });

  res.json(GetVehicleScheduleResponse.parse(schedule));
});

router.get("/dashboard/active-dispatches", async (_req, res): Promise<void> => {
  const dispatches = await db
    .select()
    .from(dispatchesTable)
    .where(eq(dispatchesTable.estado, "en-ruta"));

  const result = await Promise.all(
    dispatches.map(async (d) => {
      const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, d.vehiculoId));
      const [driver] = await db.select().from(personnelTable).where(eq(personnelTable.id, d.choferId));
      const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, d.ventaId));

      let assistantName = null;
      if (d.ayudanteId) {
        const [assistant] = await db.select().from(personnelTable).where(eq(personnelTable.id, d.ayudanteId));
        assistantName = assistant?.nombre ?? null;
      }

      // Get last known location from route points
      const points = await db
        .select()
        .from(routePointsTable)
        .where(eq(routePointsTable.despachoId, d.id))
        .orderBy(routePointsTable.orden);

      const lastPoint = points[points.length - 1];

      return {
        id: d.id,
        vehiculoId: d.vehiculoId,
        vehiculoModelo: vehicle?.modelo ?? "Desconocido",
        choferNombre: driver?.nombre ?? "Desconocido",
        ayudanteNombre: assistantName,
        destino: sale?.destino ?? "Desconocido",
        fechaEstimadaSalida: d.fechaEstimadaSalida,
        fechaEstimadaLlegada: d.fechaEstimadaLlegada,
        estado: d.estado,
        ultimaUbicacion: lastPoint?.ubicacion ?? null,
        latitud: lastPoint?.latitud ?? null,
        longitud: lastPoint?.longitud ?? null,
      };
    }),
  );

  res.json(GetActiveDispatchesResponse.parse(result));
});

export default router;
