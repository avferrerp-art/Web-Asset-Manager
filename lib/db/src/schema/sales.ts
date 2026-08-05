import { pgTable, serial, text, real, integer, timestamp, boolean } from "drizzle-orm/pg-core";
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
  // Totales originales importados de Odoo (nunca los pisa el cálculo local)
  pesoTotalOdoo: real("peso_total_odoo"),
  volumenTotalOdoo: real("volumen_total_odoo"),
  // true cuando alguna partida proviene de un producto sin dimensiones confirmadas
  dimensionesIncompletas: boolean("dimensiones_incompletas").notNull().default(false),
  destino: text("destino").notNull(),
  estado: text("estado").notNull().default("pendiente"),
  // Estado de entrega derivado de los albaranes de Odoo (deliveries).
  // SEPARADO de `estado` (interno, derivado de despachos por saleEstadoSync).
  // sin_albaran | pendiente | parcial | entregado | cancelado
  estadoEntrega: text("estado_entrega").notNull().default("sin_albaran"),
  // Almacén del albarán NO cancelado más reciente por fecha_programada; null si no hay activos
  almacenOrigen: text("almacen_origen"),
  // true cuando los albaranes activos provienen de más de un almacén (ej: S01344 CCS+LEC)
  almacenesMultiples: boolean("almacenes_multiples").notNull().default(false),
  notas: text("notas"),
  odooRef: text("odoo_ref").unique(),
  odooId: integer("odoo_id").unique(),
  // write_date de Odoo de la última sincronización aplicada (string tal cual lo envía Odoo)
  odooWriteDate: text("odoo_write_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
