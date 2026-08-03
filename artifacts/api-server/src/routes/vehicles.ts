import { Router, type IRouter } from "express";
import { eq, count, asc } from "drizzle-orm";
import { db, vehiclesTable, dispatchesTable } from "@workspace/db";
import {
  CreateVehicleBody,
  GetVehicleParams,
  UpdateVehicleParams,
  UpdateVehicleBody,
  DeleteVehicleParams,
  RecommendVehicleBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/vehicles", async (_req, res): Promise<void> => {
  const vehicles = await db.select().from(vehiclesTable).orderBy(asc(vehiclesTable.modelo), asc(vehiclesTable.placa));
  res.json(vehicles);
});

router.post("/vehicles/recommend", async (req, res): Promise<void> => {
  const parsed = RecommendVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { pesoTotal, volumenTotal } = parsed.data;
  const all = await db.select().from(vehiclesTable);
  const suitable = all.filter(
    (v) => v.capacidadPeso >= pesoTotal && v.capacidadVolumen >= volumenTotal,
  );
  suitable.sort((a, b) => {
    const aWaste = (a.capacidadPeso - pesoTotal) / a.capacidadPeso + (a.capacidadVolumen - volumenTotal) / a.capacidadVolumen;
    const bWaste = (b.capacidadPeso - pesoTotal) / b.capacidadPeso + (b.capacidadVolumen - volumenTotal) / b.capacidadVolumen;
    return aWaste - bWaste;
  });
  res.json(suitable);
});

router.post("/vehicles", async (req, res): Promise<void> => {
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vehicle] = await db.insert(vehiclesTable).values(parsed.data).returning();
  res.status(201).json(vehicle);
});

router.get("/vehicles/:id", async (req, res): Promise<void> => {
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(vehicle);
});

router.patch("/vehicles/:id", async (req, res): Promise<void> => {
  const params = UpdateVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vehicle] = await db.update(vehiclesTable).set(parsed.data).where(eq(vehiclesTable.id, params.data.id)).returning();
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(vehicle);
});

router.delete("/vehicles/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [{ value: dispatchCount }] = await db
    .select({ value: count() })
    .from(dispatchesTable)
    .where(eq(dispatchesTable.vehiculoId, params.data.id));
  if (dispatchCount > 0) {
    res.status(409).json({
      error: "vehicle_has_dispatches",
      dispatchCount,
      message: `Este vehículo está vinculado a ${dispatchCount} despacho${dispatchCount === 1 ? "" : "s"} y no puede eliminarse.`,
    });
    return;
  }
  const [vehicle] = await db.delete(vehiclesTable).where(eq(vehiclesTable.id, params.data.id)).returning();
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
