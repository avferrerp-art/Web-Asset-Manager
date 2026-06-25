import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const personnelTable = pgTable("personnel", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  rol: text("rol").notNull(),
  tarifaViaticos: real("tarifa_viaticos").notNull(),
  telefono: text("telefono"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPersonnelSchema = createInsertSchema(personnelTable).omit({ id: true, createdAt: true });
export type InsertPersonnel = z.infer<typeof insertPersonnelSchema>;
export type Personnel = typeof personnelTable.$inferSelect;
