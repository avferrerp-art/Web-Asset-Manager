import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  // --- Campos sincronizados desde Odoo (el sync los actualiza) ---
  odooId: integer("odoo_id").notNull().unique(),
  odooRef: text("odoo_ref"),
  nombre: text("nombre").notNull(),
  categoria: text("categoria"),
  uom: text("uom"),
  pesoOdoo: real("peso_odoo").notNull().default(0),
  volumenOdoo: real("volumen_odoo").notNull().default(0),
  activo: boolean("activo").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  // --- Campos manuales (el sync NUNCA los toca) ---
  pesoKg: real("peso_kg"),
  largoCm: real("largo_cm"),
  anchoCm: real("ancho_cm"),
  altoCm: real("alto_cm"),
  apilable: boolean("apilable").notNull().default(true),
  fragil: boolean("fragil").notNull().default(false),
  notas: text("notas"),
  dimensionesConfirmadas: boolean("dimensiones_confirmadas").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
