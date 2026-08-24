import { Router, type IRouter, type Response } from "express";
import {
  CreateViajeBody,
  GetViajeParams,
  ListViajesQueryParams,
  UpdateViajeBody,
  UpdateViajeParams,
} from "@workspace/api-zod";
import { db, personnelTable, vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildDispatchRow } from "./dispatches";
import {
  createViaje,
  getViajeRecord,
  listViajes,
  updateViaje,
  ViajeInputError,
} from "../services/viajeQueries";

const router: IRouter = Router();

function sendViajeError(res: Response, error: unknown): void {
  if (error instanceof ViajeInputError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  throw error;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function serializeViaje(id: number) {
  const record = await getViajeRecord(id);
  if (!record) return null;
  const [vehicle, driver, assistant, despachos] = await Promise.all([
    db.select().from(vehiclesTable).where(eq(vehiclesTable.id, record.viaje.vehiculoId)).then((rows) => rows[0] ?? null),
    db.select().from(personnelTable).where(eq(personnelTable.id, record.viaje.choferId)).then((rows) => rows[0] ?? null),
    record.viaje.ayudanteId
      ? db.select().from(personnelTable).where(eq(personnelTable.id, record.viaje.ayudanteId)).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    Promise.all(record.dispatches.map(buildDispatchRow)),
  ]);
  return {
    ...record.viaje,
    vehiculoModelo: vehicle?.modelo ?? null,
    choferNombre: driver?.nombre ?? null,
    ayudanteNombre: assistant?.nombre ?? null,
    cantidadDespachos: record.dispatches.length,
    costoViaticosEstimado: record.viaje.distanciaTotalKm === null
      ? null
      : record.viaje.distanciaTotalKm * ((driver?.tarifaPorKm ?? 0) + (assistant?.tarifaPorKm ?? 0)),
    despachos,
  };
}

router.get("/viajes", async (req, res): Promise<void> => {
  const parsed = ListViajesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await listViajes({
      ...parsed.data,
      fecha: parsed.data.fecha,
    }),
  );
});

router.post("/viajes", async (req, res): Promise<void> => {
  if (req.body && typeof req.body === "object" && "estado" in req.body) {
    res.status(400).json({
      error: "derived_state_readonly",
      message: "El estado del viaje se calcula a partir de sus despachos.",
    });
    return;
  }
  const parsed = CreateViajeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const viaje = await createViaje({
      ...parsed.data,
      fecha: dateOnly(parsed.data.fecha),
    });
    const detail = await serializeViaje(viaje.id);
    res.status(201).json(detail);
  } catch (error) {
    sendViajeError(res, error);
  }
});

router.get("/viajes/:id", async (req, res): Promise<void> => {
  const params = GetViajeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const viaje = await serializeViaje(params.data.id);
  if (!viaje) {
    res.status(404).json({ error: "viaje_not_found", message: "El viaje indicado no existe." });
    return;
  }
  res.json(viaje);
});

router.patch("/viajes/:id", async (req, res): Promise<void> => {
  const params = UpdateViajeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.body && typeof req.body === "object" && "estado" in req.body) {
    res.status(400).json({
      error: "derived_state_readonly",
      message: "El estado del viaje se calcula a partir de sus despachos.",
    });
    return;
  }
  const parsed = UpdateViajeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const updated = await updateViaje(params.data.id, {
      ...parsed.data,
      fecha: parsed.data.fecha ? dateOnly(parsed.data.fecha) : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "viaje_not_found", message: "El viaje indicado no existe." });
      return;
    }
    res.json(await serializeViaje(updated.id));
  } catch (error) {
    sendViajeError(res, error);
  }
});

export default router;