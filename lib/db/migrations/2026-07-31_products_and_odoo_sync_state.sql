-- Idempotent DDL applied on 2026-07-31 to align the database with the Drizzle schema.
-- 1) Create the `products` table (lib/db/src/schema/products.ts) — it was defined in the
--    schema but never applied, causing POST /api/odoo/sync-products to fail with HTTP 500.
--    The UNIQUE constraint on odoo_id is required by the sync upsert (ON CONFLICT).
-- 2) Add the product-sync columns missing from `odoo_sync_state` (lib/db/src/schema/odoo_sync.ts).

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  odoo_id integer NOT NULL UNIQUE,
  odoo_ref text,
  nombre text NOT NULL,
  categoria text,
  uom text,
  peso_odoo real NOT NULL DEFAULT 0,
  volumen_odoo real NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  peso_kg real,
  largo_cm real,
  ancho_cm real,
  alto_cm real,
  apilable boolean NOT NULL DEFAULT true,
  fragil boolean NOT NULL DEFAULT false,
  notas text,
  dimensiones_confirmadas boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE odoo_sync_state
  ADD COLUMN IF NOT EXISTS last_products_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_products_result text,
  ADD COLUMN IF NOT EXISTS last_products_error text,
  ADD COLUMN IF NOT EXISTS products_created_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS products_updated_count integer NOT NULL DEFAULT 0;
