import { pgTable, serial, text, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tollRoutesTable = pgTable("toll_routes", {
  id: serial("id").primaryKey(),
  origen: text("origen").notNull(),
  destino: text("destino").notNull(),
  cantidadPeajes: integer("cantidad_peajes").notNull(),
  costoTotal: real("costo_total").notNull(),
  descripcion: text("descripcion"),
});

export const insertTollRouteSchema = createInsertSchema(tollRoutesTable).omit({ id: true });
export type InsertTollRoute = z.infer<typeof insertTollRouteSchema>;
export type TollRoute = typeof tollRoutesTable.$inferSelect;
