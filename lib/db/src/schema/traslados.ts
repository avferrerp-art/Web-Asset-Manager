import {
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { almacenesTable } from "./almacenes";
import { deliveriesTable } from "./deliveries";

/**
 * Entidad de planificación de un traslado interno.
 *
 * Se mantiene separada del espejo de stock.picking para que el historial
 * logístico sobreviva si el movimiento deja de existir en Odoo.
 */
export const trasladosTable = pgTable("traslados", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id")
    .unique()
    .references(() => deliveriesTable.id, { onDelete: "set null" }),
  odooPickingId: integer("odoo_picking_id").unique(),
  almacenOrigenId: integer("almacen_origen_id").references(
    () => almacenesTable.id,
  ),
  almacenDestinoId: integer("almacen_destino_id").references(
    () => almacenesTable.id,
  ),
  // por_planificar | planificado | en_carga | en_transito |
  // entregado | confirmado_odoo | cancelado
  estadoLogistico: text("estado_logistico").notNull().default("por_planificar"),
  pesoCalculadoKg: real("peso_calculado_kg"),
  volumenCalculadoM3: real("volumen_calculado_m3"),
  pesoEstimadoKg: real("peso_estimado_kg"),
  notas: text("notas"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Traslado = typeof trasladosTable.$inferSelect;
