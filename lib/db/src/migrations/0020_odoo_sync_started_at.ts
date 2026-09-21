export const name = "0020_odoo_sync_started_at";

export const sql = `
ALTER TABLE "odoo_sync_state"
  ADD COLUMN IF NOT EXISTS "orders_sync_started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "products_sync_started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deliveries_sync_started_at" timestamp with time zone;
`;