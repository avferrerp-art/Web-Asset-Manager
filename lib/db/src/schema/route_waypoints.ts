import { pgTable, serial, integer, text, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tollRoutesTable } from "./toll_routes";

export const routeWaypointsTable = pgTable("route_waypoints", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => tollRoutesTable.id, { onDelete: "cascade" }),
  ubicacion: text("ubicacion").notNull(),
  orden: integer("orden").notNull(),
  distanciaKm: real("distancia_km").notNull().default(0),
});

export const insertRouteWaypointSchema = createInsertSchema(routeWaypointsTable).omit({ id: true });
export type InsertRouteWaypoint = z.infer<typeof insertRouteWaypointSchema>;
export type RouteWaypoint = typeof routeWaypointsTable.$inferSelect;
