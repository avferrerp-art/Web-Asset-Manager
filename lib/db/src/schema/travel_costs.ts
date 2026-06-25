import { pgTable, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dispatchesTable } from "./dispatches";

export const travelCostsTable = pgTable("travel_costs", {
  id: serial("id").primaryKey(),
  despachoId: integer("despacho_id").notNull().unique().references(() => dispatchesTable.id, { onDelete: "cascade" }),
  costoPeajes: real("costo_peajes").notNull().default(0),
  costoCombustible: real("costo_combustible").notNull().default(0),
  costoViaticos: real("costo_viaticos").notNull().default(0),
  total: real("total").notNull().default(0),
  costoCombustiblePorLitro: real("costo_combustible_por_litro"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTravelCostSchema = createInsertSchema(travelCostsTable).omit({ id: true, createdAt: true });
export type InsertTravelCost = z.infer<typeof insertTravelCostSchema>;
export type TravelCost = typeof travelCostsTable.$inferSelect;
