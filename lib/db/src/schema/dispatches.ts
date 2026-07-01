import { pgTable, serial, integer, text, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { salesTable } from "./sales";
import { vehiclesTable } from "./vehicles";
import { personnelTable } from "./personnel";
import { tollRoutesTable } from "./toll_routes";

export const dispatchesTable = pgTable("dispatches", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id").notNull().references(() => salesTable.id),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiclesTable.id),
  choferId: integer("chofer_id").notNull().references(() => personnelTable.id),
  ayudanteId: integer("ayudante_id").references(() => personnelTable.id),
  fechaEstimadaSalida: text("fecha_estimada_salida").notNull(),
  fechaEstimadaLlegada: text("fecha_estimada_llegada").notNull(),
  ruta: text("ruta"),
  estado: text("estado").notNull().default("pre-despacho"),
  distanciaKm: real("distancia_km"),
  distanciaManual: boolean("distancia_manual").notNull().default(false),
  routeId: integer("route_id").references(() => tollRoutesTable.id),
  totalPeajes: real("total_peajes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDispatchSchema = createInsertSchema(dispatchesTable).omit({ id: true, createdAt: true });
export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatchesTable.$inferSelect;
