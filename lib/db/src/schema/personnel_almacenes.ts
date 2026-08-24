import { integer, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { almacenesTable } from "./almacenes";
import { personnelTable } from "./personnel";

/**
 * Warehouses a person is assigned to for future visibility configuration.
 *
 * The relationship is intentionally data-only for now: no route or service
 * uses it to authorize or filter operational records.
 */
export const personnelAlmacenesTable = pgTable(
  "personnel_almacenes",
  {
    personnelId: integer("personnel_id")
      .notNull()
      .references(() => personnelTable.id, { onDelete: "cascade" }),
    almacenId: integer("almacen_id")
      .notNull()
      .references(() => almacenesTable.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.personnelId, table.almacenId] })],
);

export type PersonnelAlmacen = typeof personnelAlmacenesTable.$inferSelect;