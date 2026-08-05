// Creates the deliveries (stock.picking) and delivery_items (stock.move)
// tables for the Odoo albaranes integration. Schema only — no sync yet.
// Idempotent: safe on databases already partially updated via drizzle-kit push.
export const name = "0002_deliveries";

export const sql = `
CREATE TABLE IF NOT EXISTS "deliveries" (
"id" serial PRIMARY KEY NOT NULL,
"venta_id" integer NOT NULL,
"odoo_id" integer NOT NULL,
"nombre" text NOT NULL,
"estado" text NOT NULL,
"tipo_operacion" text,
"almacen_origen" text,
"almacen_codigo" text,
"fecha_programada" timestamp with time zone,
"fecha_efectiva" timestamp with time zone,
"documento_origen" text,
"backorder_de_odoo_id" integer,
"odoo_write_date" text,
"last_sync_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
 ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_odoo_id_unique" UNIQUE ("odoo_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_venta_id_sales_id_fk"
   FOREIGN KEY ("venta_id") REFERENCES "sales"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
CREATE TABLE IF NOT EXISTS "delivery_items" (
"id" serial PRIMARY KEY NOT NULL,
"delivery_id" integer NOT NULL,
"product_id" integer,
"odoo_move_id" integer NOT NULL,
"descripcion" text NOT NULL,
"cantidad_demanda" real DEFAULT 0 NOT NULL,
"cantidad_entregada" real DEFAULT 0 NOT NULL,
"uom" text,
"estado" text
);
DO $$ BEGIN
 ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_odoo_move_id_unique" UNIQUE ("odoo_move_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk"
   FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_product_id_products_id_fk"
   FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "deliveries_venta_id_idx" ON "deliveries" ("venta_id");
CREATE INDEX IF NOT EXISTS "deliveries_estado_idx" ON "deliveries" ("estado");
CREATE INDEX IF NOT EXISTS "delivery_items_delivery_id_idx" ON "delivery_items" ("delivery_id");
CREATE INDEX IF NOT EXISTS "delivery_items_product_id_idx" ON "delivery_items" ("product_id");
`;
