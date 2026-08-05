import { pgTable, serial, text, real, integer } from "drizzle-orm/pg-core";
import { deliveriesTable } from "./deliveries";
import { productsTable } from "./products";

// Líneas de albarán (stock.move de Odoo): una fila por movimiento de producto.
export const deliveryItemsTable = pgTable("delivery_items", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id")
    .notNull()
    .references(() => deliveriesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  // id del stock.move en Odoo
  odooMoveId: integer("odoo_move_id").notNull().unique(),
  descripcion: text("descripcion").notNull(),
  // product_uom_qty (demanda)
  cantidadDemanda: real("cantidad_demanda").notNull().default(0),
  // quantity (entregada real — Odoo 19; quantity_done no existe)
  cantidadEntregada: real("cantidad_entregada").notNull().default(0),
  uom: text("uom"),
  estado: text("estado"),
});

export type DeliveryItem = typeof deliveryItemsTable.$inferSelect;
