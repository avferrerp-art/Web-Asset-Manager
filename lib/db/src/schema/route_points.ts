import { pgTable, serial, integer, text, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dispatchesTable } from "./dispatches";

export const routePointsTable = pgTable("route_points", {
  id: serial("id").primaryKey(),
  despachoId: integer("despacho_id").notNull().references(() => dispatchesTable.id, { onDelete: "cascade" }),
  ubicacion: text("ubicacion").notNull(),
  orden: integer("orden").notNull(),
  latitud: real("latitud"),
  longitud: real("longitud"),
});

export const insertRoutePointSchema = createInsertSchema(routePointsTable).omit({ id: true });
export type InsertRoutePoint = z.infer<typeof insertRoutePointSchema>;
export type RoutePoint = typeof routePointsTable.$inferSelect;
