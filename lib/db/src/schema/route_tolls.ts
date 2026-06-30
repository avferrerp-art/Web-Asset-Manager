import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tollRoutesTable } from "./toll_routes";

export const routeTollsTable = pgTable("route_tolls", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => tollRoutesTable.id, { onDelete: "cascade" }),
  nombre: text("nombre").notNull(),
  orden: integer("orden").notNull().default(1),
});

export const insertRouteTollSchema = createInsertSchema(routeTollsTable).omit({ id: true });
export type InsertRouteToll = z.infer<typeof insertRouteTollSchema>;
export type RouteToll = typeof routeTollsTable.$inferSelect;
