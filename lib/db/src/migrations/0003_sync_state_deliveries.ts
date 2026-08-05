// Adds delivery sync tracking columns to odoo_sync_state.
// Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run.
export const name = "0003_sync_state_deliveries";

export const sql = `
ALTER TABLE "odoo_sync_state" ADD COLUMN IF NOT EXISTS "last_deliveries_sync_at" timestamp with time zone;
ALTER TABLE "odoo_sync_state" ADD COLUMN IF NOT EXISTS "last_deliveries_result" text;
ALTER TABLE "odoo_sync_state" ADD COLUMN IF NOT EXISTS "last_deliveries_error" text;
ALTER TABLE "odoo_sync_state" ADD COLUMN IF NOT EXISTS "deliveries_created_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "odoo_sync_state" ADD COLUMN IF NOT EXISTS "deliveries_updated_count" integer NOT NULL DEFAULT 0;
`;
