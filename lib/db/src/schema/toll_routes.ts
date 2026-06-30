import { pgTable, serial, text, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tollRoutesTable = pgTable("toll_routes", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  tipo: text("tipo").notNull().default("sencillo"),
  origen: text("origen").notNull(),
  destino: text("destino").notNull(),
  distanciaKm: real("distancia_km"),
  favorita: boolean("favorita").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTollRouteSchema = createInsertSchema(tollRoutesTable).omit({ id: true, createdAt: true });
export type InsertTollRoute = z.infer<typeof insertTollRouteSchema>;
export type TollRoute = typeof tollRoutesTable.$inferSelect;
