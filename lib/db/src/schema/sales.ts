import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const salesTable = pgTable("sales", {
  id: serial("id").primaryKey(),
  cliente: text("cliente").notNull(),
  vendedor: text("vendedor"),
  personaContacto: text("persona_contacto"),
  numeroCel: text("numero_cel"),
  tipoMaterial: text("tipo_material"),
  volumenTotal: real("volumen_total").notNull(),
  pesoTotal: real("peso_total").notNull(),
  destino: text("destino").notNull(),
  estado: text("estado").notNull().default("pendiente"),
  notas: text("notas"),
  odooRef: text("odoo_ref").unique(),
  odooId: integer("odoo_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
