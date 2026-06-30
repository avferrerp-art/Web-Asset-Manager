import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { salesTable } from "./sales";

export const saleItemsTable = pgTable("sale_items", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id").notNull().references(() => salesTable.id, { onDelete: "cascade" }),
  descripcion: text("descripcion").notNull(),
  cantidad: integer("cantidad").notNull().default(1),
  pesoUnitario: real("peso_unitario").notNull().default(0),
  largo: real("largo").notNull().default(0),
  ancho: real("ancho").notNull().default(0),
  alto: real("alto").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSaleItemSchema = createInsertSchema(saleItemsTable).omit({ id: true, createdAt: true });
export type InsertSaleItem = z.infer<typeof insertSaleItemSchema>;
export type SaleItem = typeof saleItemsTable.$inferSelect;
