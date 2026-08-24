import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import { personnelTable } from "./personnel";
import { vehiclesTable } from "./vehicles";

export const viajesTable = pgTable("viajes", {
  id: serial("id").primaryKey(),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiclesTable.id),
  choferId: integer("chofer_id").notNull().references(() => personnelTable.id),
  ayudanteId: integer("ayudante_id").references(() => personnelTable.id),
  fecha: text("fecha").notNull(),
  estado: text("estado").notNull().default("planificado"),
  distanciaTotalKm: real("distancia_total_km"),
  totalPeajesEstimado: real("total_peajes_estimado"),
  notas: text("notas"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Viaje = typeof viajesTable.$inferSelect;