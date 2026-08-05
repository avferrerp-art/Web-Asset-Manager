import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { salesTable } from "./sales";

// Albaranes (stock.picking de Odoo): una fila por entrega/despacho de almacén.
export const deliveriesTable = pgTable("deliveries", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id")
    .notNull()
    .references(() => salesTable.id, { onDelete: "cascade" }),
  // id del stock.picking en Odoo
  odooId: integer("odoo_id").notNull().unique(),
  // Referencia del albarán ("CCS/OUT/00307")
  nombre: text("nombre").notNull(),
  // state crudo de Odoo: draft|waiting|confirmed|assigned|done|cancel
  estado: text("estado").notNull(),
  // picking_type_id[1] ("Caracas: Órdenes de entrega")
  tipoOperacion: text("tipo_operacion"),
  // location_id[1] completo ("CCS/Existencias")
  almacenOrigen: text("almacen_origen"),
  // Prefijo derivado de almacenOrigen ("CCS")
  almacenCodigo: text("almacen_codigo"),
  fechaProgramada: timestamp("fecha_programada", { withTimezone: true }),
  // date_done — nullable, Odoo devuelve false si no entregado
  fechaEfectiva: timestamp("fecha_efectiva", { withTimezone: true }),
  // origin — nullable
  documentoOrigen: text("documento_origen"),
  // backorder_id — nullable (odooId del albarán original)
  backorderDeOdooId: integer("backorder_de_odoo_id"),
  // write_date crudo de Odoo, para sync incremental
  odooWriteDate: text("odoo_write_date"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Delivery = typeof deliveriesTable.$inferSelect;
