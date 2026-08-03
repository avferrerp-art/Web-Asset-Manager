import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { salesTable } from "./sales";

// Alertas de sincronización: cuando una orden no-pendiente cambió en Odoo,
// no se toca automáticamente — se registra una alerta para que un humano decida.
export const syncAlertsTable = pgTable("sync_alerts", {
  id: serial("id").primaryKey(),
  ventaId: integer("venta_id")
    .notNull()
    .references(() => salesTable.id, { onDelete: "cascade" }),
  odooId: integer("odoo_id"),
  odooRef: text("odoo_ref"),
  estado: text("estado").notNull(),
  mensaje: text("mensaje").notNull(),
  // Lista de campos que cambiaron, separados por coma (informativo)
  campos: text("campos"),
  // write_date de Odoo que disparó la alerta (para no duplicar alertas)
  odooWriteDate: text("odoo_write_date"),
  resuelta: boolean("resuelta").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type SyncAlert = typeof syncAlertsTable.$inferSelect;
