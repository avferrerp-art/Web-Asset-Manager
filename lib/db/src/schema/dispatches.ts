import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, real, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { salesTable } from "./sales";
import { trasladosTable } from "./traslados";
import { vehiclesTable } from "./vehicles";
import { personnelTable } from "./personnel";
import { tollRoutesTable } from "./toll_routes";
import { viajesTable } from "./viajes";

export const dispatchesTable = pgTable(
  "dispatches",
  {
    id: serial("id").primaryKey(),
    tipo: text("tipo").notNull().default("venta"),
    ventaId: integer("venta_id").references(() => salesTable.id),
    trasladoId: integer("traslado_id").references(() => trasladosTable.id),
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
    viajeId: integer("viaje_id").references(() => viajesTable.id, { onDelete: "set null" }),
    orden: integer("orden"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dispatches_viaje_orden_unique")
      .on(table.viajeId, table.orden)
      .where(sql`${table.viajeId} IS NOT NULL AND ${table.orden} IS NOT NULL`),
  ],
);

export const insertDispatchSchema = createInsertSchema(dispatchesTable).omit({ id: true, createdAt: true });
export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatchesTable.$inferSelect;
