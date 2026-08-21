// Generalizes dispatch ownership while preserving every existing sale dispatch.
// Safe to repeat on databases where part of the DDL was already applied.
export const name = "0010_dispatches_polimorficos";

export const sql = `
ALTER TABLE "dispatches"
  ALTER COLUMN "venta_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "tipo" text,
  ADD COLUMN IF NOT EXISTS "traslado_id" integer;

UPDATE "dispatches"
SET "tipo" = CASE
  WHEN "traslado_id" IS NOT NULL AND "venta_id" IS NULL THEN 'traslado'
  ELSE 'venta'
END
WHERE "tipo" IS NULL;

ALTER TABLE "dispatches"
  ALTER COLUMN "tipo" SET DEFAULT 'venta',
  ALTER COLUMN "tipo" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'dispatches'::regclass
      AND conname = 'dispatches_traslado_id_traslados_id_fk'
  ) THEN
    ALTER TABLE "dispatches"
      ADD CONSTRAINT "dispatches_traslado_id_traslados_id_fk"
      FOREIGN KEY ("traslado_id") REFERENCES "traslados"("id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'dispatches'::regclass
      AND conname = 'dispatches_fuente_exclusiva_check'
  ) THEN
    ALTER TABLE "dispatches"
      ADD CONSTRAINT "dispatches_fuente_exclusiva_check"
      CHECK (
        (
          "tipo" = 'venta'
          AND "venta_id" IS NOT NULL
          AND "traslado_id" IS NULL
        )
        OR
        (
          "tipo" = 'traslado'
          AND "traslado_id" IS NOT NULL
          AND "venta_id" IS NULL
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dispatches_traslado_id_idx"
  ON "dispatches" ("traslado_id");
`;