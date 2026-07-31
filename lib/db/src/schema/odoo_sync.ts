import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const odooSyncStateTable = pgTable("odoo_sync_state", {
  id: serial("id").primaryKey(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastResult: text("last_result"),
  lastError: text("last_error"),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  // --- Sync de productos (independiente del sync de órdenes) ---
  lastProductsSyncAt: timestamp("last_products_sync_at", { withTimezone: true }),
  lastProductsResult: text("last_products_result"),
  lastProductsError: text("last_products_error"),
  productsCreatedCount: integer("products_created_count").notNull().default(0),
  productsUpdatedCount: integer("products_updated_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type OdooSyncState = typeof odooSyncStateTable.$inferSelect;
