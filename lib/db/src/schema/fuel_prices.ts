import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fuelPricesTable = pgTable("fuel_prices", {
  id: serial("id").primaryKey(),
  tipoCombustible: text("tipo_combustible").notNull().unique(),
  precioPorLitro: real("precio_por_litro").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFuelPriceSchema = createInsertSchema(fuelPricesTable).omit({ id: true, updatedAt: true });
export type InsertFuelPrice = z.infer<typeof insertFuelPriceSchema>;
export type FuelPrice = typeof fuelPricesTable.$inferSelect;
