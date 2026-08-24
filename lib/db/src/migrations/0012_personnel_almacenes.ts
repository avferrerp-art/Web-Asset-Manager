// Creates the visibility-assignment relation. Safe to repeat on databases
// where a partial manual update already created the table or constraints.
export const name = "0012_personnel_almacenes";

export const sql = `
CREATE TABLE IF NOT EXISTS "personnel_almacenes" (
  "personnel_id" integer NOT NULL,
  "almacen_id" integer NOT NULL
);

ALTER TABLE "personnel_almacenes"
  ADD COLUMN IF NOT EXISTS "personnel_id" integer,
  ADD COLUMN IF NOT EXISTS "almacen_id" integer;

DELETE FROM "personnel_almacenes" AS "pa"
WHERE "pa"."personnel_id" IS NULL
   OR "pa"."almacen_id" IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM "personnel" AS "p"
     WHERE "p"."id" = "pa"."personnel_id"
   )
   OR NOT EXISTS (
     SELECT 1 FROM "almacenes" AS "a"
     WHERE "a"."id" = "pa"."almacen_id"
   );

DELETE FROM "personnel_almacenes" AS "duplicate"
USING "personnel_almacenes" AS "kept"
WHERE "duplicate".ctid > "kept".ctid
  AND "duplicate"."personnel_id" = "kept"."personnel_id"
  AND "duplicate"."almacen_id" = "kept"."almacen_id";

ALTER TABLE "personnel_almacenes"
  ALTER COLUMN "personnel_id" SET NOT NULL,
  ALTER COLUMN "almacen_id" SET NOT NULL;

DO $$
DECLARE
  invalid_constraint text;
BEGIN
  FOR invalid_constraint IN
    SELECT c.conname
    FROM pg_constraint AS c
    WHERE c.conrelid = 'personnel_almacenes'::regclass
      AND c.contype = 'p'
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = c.conrelid AND a.attnum = key.attnum
      ) IS DISTINCT FROM ARRAY['personnel_id', 'almacen_id']
  LOOP
    EXECUTE format(
      'ALTER TABLE "personnel_almacenes" DROP CONSTRAINT %I',
      invalid_constraint
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'personnel_almacenes'::regclass
      AND c.contype = 'p'
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = c.conrelid AND a.attnum = key.attnum
      ) = ARRAY['personnel_id', 'almacen_id']
  ) THEN
    ALTER TABLE "personnel_almacenes"
      ADD CONSTRAINT "personnel_almacenes_pkey"
      PRIMARY KEY ("personnel_id", "almacen_id");
  END IF;
END $$;

DO $$
DECLARE
  invalid_constraint text;
BEGIN
  FOR invalid_constraint IN
    SELECT c.conname
    FROM pg_constraint AS c
    WHERE c.conrelid = 'personnel_almacenes'::regclass
      AND c.contype = 'f'
      AND (
        c.conname = 'personnel_almacenes_personnel_id_personnel_id_fk'
        OR (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = c.conrelid AND a.attnum = key.attnum
        ) = ARRAY['personnel_id']
      )
      AND NOT (
        c.confrelid = 'personnel'::regclass
        AND c.confdeltype = 'c'
        AND (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = c.conrelid AND a.attnum = key.attnum
        ) = ARRAY['personnel_id']
        AND (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = c.confrelid AND a.attnum = key.attnum
        ) = ARRAY['id']
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE "personnel_almacenes" DROP CONSTRAINT %I',
      invalid_constraint
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'personnel_almacenes'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'personnel'::regclass
      AND c.confdeltype = 'c'
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = c.conrelid AND a.attnum = key.attnum
      ) = ARRAY['personnel_id']
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = c.confrelid AND a.attnum = key.attnum
      ) = ARRAY['id']
  ) THEN
    ALTER TABLE "personnel_almacenes"
      ADD CONSTRAINT "personnel_almacenes_personnel_id_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  invalid_constraint text;
BEGIN
  FOR invalid_constraint IN
    SELECT c.conname
    FROM pg_constraint AS c
    WHERE c.conrelid = 'personnel_almacenes'::regclass
      AND c.contype = 'f'
      AND (
        c.conname = 'personnel_almacenes_almacen_id_almacenes_id_fk'
        OR (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = c.conrelid AND a.attnum = key.attnum
        ) = ARRAY['almacen_id']
      )
      AND NOT (
        c.confrelid = 'almacenes'::regclass
        AND c.confdeltype = 'c'
        AND (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = c.conrelid AND a.attnum = key.attnum
        ) = ARRAY['almacen_id']
        AND (
          SELECT array_agg(a.attname::text ORDER BY key.ordinality)
          FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute AS a
            ON a.attrelid = c.confrelid AND a.attnum = key.attnum
        ) = ARRAY['id']
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE "personnel_almacenes" DROP CONSTRAINT %I',
      invalid_constraint
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'personnel_almacenes'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'almacenes'::regclass
      AND c.confdeltype = 'c'
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = c.conrelid AND a.attnum = key.attnum
      ) = ARRAY['almacen_id']
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a
          ON a.attrelid = c.confrelid AND a.attnum = key.attnum
      ) = ARRAY['id']
  ) THEN
    ALTER TABLE "personnel_almacenes"
      ADD CONSTRAINT "personnel_almacenes_almacen_id_almacenes_id_fk"
      FOREIGN KEY ("almacen_id") REFERENCES "almacenes"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "personnel_almacenes_almacen_id_idx"
  ON "personnel_almacenes" ("almacen_id");
`;