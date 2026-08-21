// Canonical warehouse catalog. Idempotent so task databases that already have
// some DDL applied remain safe to start and seed.
export const name = "0006_almacenes";

export const sql = `
CREATE TABLE IF NOT EXISTS "almacenes" (
"id" serial PRIMARY KEY NOT NULL,
"codigo" text NOT NULL,
"odoo_prefix" text NOT NULL,
"nombre" text NOT NULL,
"plaza" text NOT NULL,
"direccion" text,
"latitud" real,
"longitud" real,
"activo" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "almacenes" ADD CONSTRAINT "almacenes_codigo_unique" UNIQUE ("codigo");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "almacenes" ADD CONSTRAINT "almacenes_odoo_prefix_unique" UNIQUE ("odoo_prefix");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
INSERT INTO "almacenes" ("codigo", "odoo_prefix", "nombre", "plaza")
VALUES
  ('URB', 'Urbin', 'Urbina', 'Caracas'),
  ('CCS', 'CCS', 'Caracas', 'Caracas'),
  ('LEC', 'LEC', 'Lecheria', 'Lecheria'),
  ('NVBLA', 'NVBLA', 'Nueva Barcelona', 'Lecheria')
ON CONFLICT ("codigo") DO NOTHING;
`;