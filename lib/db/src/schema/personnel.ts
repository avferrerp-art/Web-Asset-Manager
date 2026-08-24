import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const personnelTable = pgTable("personnel", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  // Recognized operational values are chofer, ayudante, almacenista and oficina.
  // This remains free text until authorization rules are explicitly introduced.
  rol: text("rol").notNull(),
  tarifaPorKm: real("tarifa_por_km").notNull(),
  telefono: text("telefono"),
  email: text("email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPersonnelSchema = createInsertSchema(personnelTable).omit({ id: true, createdAt: true });
export type InsertPersonnel = z.infer<typeof insertPersonnelSchema>;
export type Personnel = typeof personnelTable.$inferSelect;
