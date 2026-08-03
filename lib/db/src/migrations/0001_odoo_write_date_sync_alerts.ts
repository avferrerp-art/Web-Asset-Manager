// Adds sales.odoo_write_date (last synced Odoo write_date) and the
// sync_alerts table (alerts for non-pending orders changed in Odoo).
// Idempotent: safe on databases already partially updated via drizzle-kit push.
export const name = "0001_odoo_write_date_sync_alerts";

export const sql = `
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "odoo_write_date" text;
CREATE TABLE IF NOT EXISTS "sync_alerts" (
"id" serial PRIMARY KEY NOT NULL,
"venta_id" integer NOT NULL,
"odoo_id" integer,
"odoo_ref" text,
"estado" text NOT NULL,
"mensaje" text NOT NULL,
"campos" text,
"odoo_write_date" text,
"resuelta" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"resolved_at" timestamp with time zone
);
DO $$ BEGIN
 ALTER TABLE "sync_alerts" ADD CONSTRAINT "sync_alerts_venta_id_sales_id_fk"
   FOREIGN KEY ("venta_id") REFERENCES "sales"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
`;
