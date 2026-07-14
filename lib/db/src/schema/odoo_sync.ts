import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const odooSyncStateTable = pgTable("odoo_sync_state", {
  id: serial("id").primaryKey(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastResult: text("last_result"),
  lastError: text("last_error"),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type OdooSyncState = typeof odooSyncStateTable.$inferSelect;
