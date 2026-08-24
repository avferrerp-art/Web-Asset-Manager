// Adds reusable shared trips without deleting their dispatches if a trip is removed.
// Every statement is safe to re-run against task databases with partial schema state.
export const name = "0013_viajes";

export const sql = `
CREATE TABLE IF NOT EXISTS "viajes" (
  "id" serial PRIMARY KEY,
  "vehiculo_id" integer NOT NULL REFERENCES "vehicles"("id"),
  "chofer_id" integer NOT NULL REFERENCES "personnel"("id"),
  "ayudante_id" integer REFERENCES "personnel"("id"),
  "fecha" text NOT NULL,
  "estado" text NOT NULL DEFAULT 'planificado',
  "distancia_total_km" real,
  "total_peajes_estimado" real,
  "notas" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "dispatches"
  ADD COLUMN IF NOT EXISTS "viaje_id" integer,
  ADD COLUMN IF NOT EXISTS "orden" integer;

DO $$
DECLARE
  invalid_constraint text;
BEGIN
  FOR invalid_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'dispatches'::regclass
      AND contype = 'f'
      AND (
        conname = 'dispatches_viaje_id_viajes_id_fk'
        OR (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(conkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = conrelid AND a.attnum = key.attnum
        ) = ARRAY['viaje_id']
      )
      AND NOT (
        confrelid = 'viajes'::regclass
        AND confdeltype = 'n'
        AND (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(conkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = conrelid AND a.attnum = key.attnum
        ) = ARRAY['viaje_id']
      )
  LOOP
    EXECUTE format('ALTER TABLE "dispatches" DROP CONSTRAINT %I', invalid_constraint);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'dispatches'::regclass
      AND contype = 'f'
      AND confrelid = 'viajes'::regclass
      AND confdeltype = 'n'
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = conrelid AND a.attnum = key.attnum
      ) = ARRAY['viaje_id']
  ) THEN
    ALTER TABLE "dispatches"
      ADD CONSTRAINT "dispatches_viaje_id_viajes_id_fk"
      FOREIGN KEY ("viaje_id") REFERENCES "viajes"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dispatches_viaje_id_idx"
  ON "dispatches" ("viaje_id");
`;