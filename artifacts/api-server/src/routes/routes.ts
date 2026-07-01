import { Router, type IRouter } from "express";
import { eq, and, asc, count } from "drizzle-orm";
import { db, tollRoutesTable, routeTollsTable, routeWaypointsTable, dispatchesTable } from "@workspace/db";
import {
  CreateRouteBody,
  UpdateRouteParams,
  UpdateRouteBody,
  GetRouteParams,
  DeleteRouteParams,
  AddRouteTollParams,
  AddRouteTollBody,
  UpdateRouteTollParams,
  UpdateRouteTollBody,
  DeleteRouteTollParams,
  AddRouteWaypointParams,
  AddRouteWaypointBody,
  DeleteRouteWaypointParams,
  UpdateRouteWaypointParams,
  UpdateRouteWaypointBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildRoute(id: number) {
  const [route] = await db.select().from(tollRoutesTable).where(eq(tollRoutesTable.id, id));
  if (!route) return null;
  const tolls = await db.select().from(routeTollsTable).where(eq(routeTollsTable.routeId, id)).orderBy(asc(routeTollsTable.orden));
  const waypoints = await db.select().from(routeWaypointsTable).where(eq(routeWaypointsTable.routeId, id)).orderBy(asc(routeWaypointsTable.orden));
  const [{ value: linkedDispatchCount }] = await db.select({ value: count() }).from(dispatchesTable).where(eq(dispatchesTable.routeId, id));
  return { ...route, tolls, waypoints, linkedDispatchCount };
}

router.get("/routes", async (_req, res): Promise<void> => {
  const routes = await db.select().from(tollRoutesTable).orderBy(asc(tollRoutesTable.id));
  const results = await Promise.all(routes.map(r => buildRoute(r.id)));
  res.json(results.filter(Boolean));
});

router.post("/routes", async (req, res): Promise<void> => {
  const parsed = CreateRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [route] = await db.insert(tollRoutesTable).values(parsed.data).returning();
  const built = await buildRoute(route.id);
  res.status(201).json(built);
});

router.get("/routes/:id", async (req, res): Promise<void> => {
  const params = GetRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const built = await buildRoute(params.data.id);
  if (!built) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json(built);
});

router.patch("/routes/:id", async (req, res): Promise<void> => {
  const params = UpdateRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(tollRoutesTable)
    .set(parsed.data)
    .where(eq(tollRoutesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  const built = await buildRoute(updated.id);
  res.json(built);
});

router.delete("/routes/:id", async (req, res): Promise<void> => {
  const params = DeleteRouteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [{ value: dispatchCount }] = await db
    .select({ value: count() })
    .from(dispatchesTable)
    .where(eq(dispatchesTable.routeId, params.data.id));
  if (dispatchCount > 0) {
    res.status(409).json({
      error: "route_has_dispatches",
      dispatchCount,
      message: `Esta ruta está vinculada a ${dispatchCount} despacho${dispatchCount === 1 ? "" : "s"} y no puede eliminarse.`,
    });
    return;
  }
  const [deleted] = await db
    .delete(tollRoutesTable)
    .where(eq(tollRoutesTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/routes/:id/tolls", async (req, res): Promise<void> => {
  const params = AddRouteTollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddRouteTollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db.select().from(routeTollsTable).where(eq(routeTollsTable.routeId, params.data.id));
  const orden = parsed.data.orden ?? existing.length + 1;
  const [toll] = await db
    .insert(routeTollsTable)
    .values({ routeId: params.data.id, nombre: parsed.data.nombre, orden, tarifa: parsed.data.tarifa ?? 0 })
    .returning();
  res.status(201).json(toll);
});

router.patch("/routes/:routeId/tolls/:tollId", async (req, res): Promise<void> => {
  const params = UpdateRouteTollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRouteTollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(routeTollsTable)
    .set(parsed.data)
    .where(and(eq(routeTollsTable.id, params.data.tollId), eq(routeTollsTable.routeId, params.data.routeId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Toll not found" });
    return;
  }
  res.json(updated);
});

router.delete("/routes/:routeId/tolls/:tollId", async (req, res): Promise<void> => {
  const params = DeleteRouteTollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(routeTollsTable)
    .where(and(eq(routeTollsTable.id, params.data.tollId), eq(routeTollsTable.routeId, params.data.routeId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Toll not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/routes/:id/waypoints", async (req, res): Promise<void> => {
  const params = AddRouteWaypointParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddRouteWaypointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [waypoint] = await db
    .insert(routeWaypointsTable)
    .values({ routeId: params.data.id, ubicacion: parsed.data.ubicacion, orden: parsed.data.orden })
    .returning();
  res.status(201).json(waypoint);
});

router.patch("/routes/:routeId/waypoints/:waypointId", async (req, res): Promise<void> => {
  const params = UpdateRouteWaypointParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRouteWaypointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(routeWaypointsTable)
    .set(parsed.data)
    .where(and(eq(routeWaypointsTable.id, params.data.waypointId), eq(routeWaypointsTable.routeId, params.data.routeId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Waypoint not found" });
    return;
  }
  res.json(updated);
});

router.delete("/routes/:routeId/waypoints/:waypointId", async (req, res): Promise<void> => {
  const params = DeleteRouteWaypointParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(routeWaypointsTable)
    .where(and(eq(routeWaypointsTable.id, params.data.waypointId), eq(routeWaypointsTable.routeId, params.data.routeId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Waypoint not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
