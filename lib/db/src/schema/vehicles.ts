import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),
  modelo: text("modelo").notNull(),
  capacidadPeso: real("capacidad_peso").notNull(),
  capacidadVolumen: real("capacidad_volumen").notNull(),
  tipoCombustible: text("tipo_combustible").notNull(),
  rendimientoKmLitro: real("rendimiento_km_litro").notNull(),
  placa: text("placa"),
  tarifaPeaje: real("tarifa_peaje").default(0),
  tanqueLitros: real("tanque_litros"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
