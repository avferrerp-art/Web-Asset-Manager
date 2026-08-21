import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { dispatchesTable } from "./dispatches";
import { personnelTable } from "./personnel";

export const actasLlegadaTable = pgTable("actas_llegada", {
  id: serial("id").primaryKey(),
  despachoId: integer("despacho_id")
    .notNull()
    .unique()
    .references(() => dispatchesTable.id, { onDelete: "cascade" }),
  fechaLlegada: timestamp("fecha_llegada", { withTimezone: true }).notNull(),
  registradaPorId: integer("registrada_por_id").references(() => personnelTable.id),
  novedadesViaje: text("novedades_viaje"),
  recibidoPor: text("recibido_por"),
  confirmadaPorId: integer("confirmada_por_id").references(() => personnelTable.id),
  confirmadaAt: timestamp("confirmada_at", { withTimezone: true }),
  novedadesRecepcion: text("novedades_recepcion"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActaLlegadaSchema = createInsertSchema(actasLlegadaTable).omit({
  id: true,
  createdAt: true,
});
export type InsertActaLlegada = z.infer<typeof insertActaLlegadaSchema>;
export type ActaLlegada = typeof actasLlegadaTable.$inferSelect;