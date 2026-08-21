// Consolidates Odoo product measurements in the canonical columns already
// consumed by the API. Empty duplicate values are safe to discard, but any
// duplicate value that contradicts the canonical value aborts the migration.
export const name = "0009_product_measurements";

export const sql = `
ALTER TABLE "products"
  ALTER COLUMN "peso_odoo" DROP DEFAULT,
  ALTER COLUMN "peso_odoo" DROP NOT NULL,
  ALTER COLUMN "volumen_odoo" DROP DEFAULT,
  ALTER COLUMN "volumen_odoo" DROP NOT NULL;

UPDATE "products"
SET
  "peso_odoo" = CASE
    WHEN "peso_odoo" IS NOT NULL AND "peso_odoo" > 0 THEN "peso_odoo"
    ELSE NULL
  END,
  "volumen_odoo" = CASE
    WHEN "volumen_odoo" IS NOT NULL AND "volumen_odoo" > 0 THEN "volumen_odoo"
    ELSE NULL
  END
WHERE
  "peso_odoo" IS NOT NULL AND "peso_odoo" <= 0
  OR "volumen_odoo" IS NOT NULL AND "volumen_odoo" <= 0;

DO $$
DECLARE
  "has_peso_duplicate" boolean;
  "has_volumen_duplicate" boolean;
  "has_difference" boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
      AND column_name = 'peso_kg_odoo'
  ) INTO "has_peso_duplicate";

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
      AND column_name = 'volumen_m3_odoo'
  ) INTO "has_volumen_duplicate";

  IF "has_peso_duplicate" <> "has_volumen_duplicate" THEN
    RAISE EXCEPTION
      'Cannot consolidate Odoo product measurements: only one duplicate column exists';
  END IF;

  IF "has_peso_duplicate" THEN
    EXECUTE '
      UPDATE "products"
      SET
        "peso_kg_odoo" = CASE
          WHEN "peso_kg_odoo" IS NOT NULL AND "peso_kg_odoo" > 0
            THEN "peso_kg_odoo"
          ELSE NULL
        END,
        "volumen_m3_odoo" = CASE
          WHEN "volumen_m3_odoo" IS NOT NULL AND "volumen_m3_odoo" > 0
            THEN "volumen_m3_odoo"
          ELSE NULL
        END
      WHERE
        "peso_kg_odoo" IS NOT NULL AND "peso_kg_odoo" <= 0
        OR "volumen_m3_odoo" IS NOT NULL AND "volumen_m3_odoo" <= 0
    ';

    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM "products"
        WHERE
          "peso_kg_odoo" IS NOT NULL
          AND "peso_kg_odoo" IS DISTINCT FROM "peso_odoo"
          OR "volumen_m3_odoo" IS NOT NULL
          AND "volumen_m3_odoo" IS DISTINCT FROM "volumen_odoo"
      )
    ' INTO "has_difference";

    IF "has_difference" THEN
      RAISE EXCEPTION
        'Cannot consolidate Odoo product measurements: duplicate columns contain different data';
    END IF;

    EXECUTE '
      ALTER TABLE "products"
        DROP COLUMN "peso_kg_odoo",
        DROP COLUMN "volumen_m3_odoo"
    ';
  END IF;
END $$;
`;