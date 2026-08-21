import { boolean, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Canonical warehouses known to LogiFleet.
 *
 * Existing warehouse fields in sales and deliveries deliberately remain free
 * text: this catalog is a stable reference for future internal transfers.
 */
export const almacenesTable = pgTable("almacenes", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  // Exact first segment of Odoo's location_id display name (e.g. "Urbin").
  odooPrefix: text("odoo_prefix").notNull().unique(),
  nombre: text("nombre").notNull(),
  plaza: text("plaza").notNull(),
  direccion: text("direccion"),
  latitud: real("latitud"),
  longitud: real("longitud"),
  activo: boolean("activo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlmacenSchema = createInsertSchema(almacenesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAlmacen = z.infer<typeof insertAlmacenSchema>;
export type Almacen = typeof almacenesTable.$inferSelect;