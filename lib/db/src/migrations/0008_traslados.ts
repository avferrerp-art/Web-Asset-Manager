// Generalizes deliveries to warehouse movements and creates the persistent
// planning entity for internal transfers. Safe on partially migrated task DBs.
export const name = "0008_traslados";

export const sql = `
ALTER TABLE "deliveries"
  ALTER COLUMN "venta_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "tipo" text,
  ADD COLUMN IF NOT EXISTS "almacen_destino" text,
  ADD COLUMN IF NOT EXISTS "almacen_destino_codigo" text;

UPDATE "deliveries"
SET "tipo" = 'venta'
WHERE "tipo" IS NULL;

ALTER TABLE "deliveries"
  ALTER COLUMN "tipo" SET DEFAULT 'venta',
  ALTER COLUMN "tipo" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "traslados" (
  "id" serial PRIMARY KEY NOT NULL,
  "delivery_id" integer,
  "odoo_picking_id" integer,
  "almacen_origen_id" integer,
  "almacen_destino_id" integer,
  "estado_logistico" text DEFAULT 'por_planificar' NOT NULL,
  "peso_calculado_kg" real,
  "volumen_calculado_m3" real,
  "peso_estimado_kg" real,
  "notas" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "traslados"
  ADD COLUMN IF NOT EXISTS "id" integer,
  ADD COLUMN IF NOT EXISTS "delivery_id" integer,
  ADD COLUMN IF NOT EXISTS "odoo_picking_id" integer,
  ADD COLUMN IF NOT EXISTS "almacen_origen_id" integer,
  ADD COLUMN IF NOT EXISTS "almacen_destino_id" integer,
  ADD COLUMN IF NOT EXISTS "estado_logistico" text DEFAULT 'por_planificar',
  ADD COLUMN IF NOT EXISTS "peso_calculado_kg" real,
  ADD COLUMN IF NOT EXISTS "volumen_calculado_m3" real,
  ADD COLUMN IF NOT EXISTS "peso_estimado_kg" real,
  ADD COLUMN IF NOT EXISTS "notas" text,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

UPDATE "traslados"
SET "estado_logistico" = 'por_planificar'
WHERE "estado_logistico" IS NULL;

UPDATE "traslados"
SET "created_at" = now()
WHERE "created_at" IS NULL;

CREATE SEQUENCE IF NOT EXISTS "traslados_id_seq";
ALTER SEQUENCE "traslados_id_seq" OWNED BY "traslados"."id";
ALTER TABLE "traslados"
  ALTER COLUMN "id" SET DEFAULT nextval('"traslados_id_seq"'::regclass);

SELECT setval(
  '"traslados_id_seq"',
  GREATEST(COALESCE((SELECT max("id") FROM "traslados"), 0) + 1, 1),
  false
);

WITH "ids_repetidos" AS (
  SELECT
    ctid,
    row_number() OVER (PARTITION BY "id" ORDER BY ctid) AS "repeticion"
  FROM "traslados"
  WHERE "id" IS NOT NULL
)
UPDATE "traslados" AS "t"
SET "id" = nextval('"traslados_id_seq"'::regclass)
FROM "ids_repetidos" AS "r"
WHERE "t".ctid = "r".ctid AND "r"."repeticion" > 1;

UPDATE "traslados"
SET "id" = nextval('"traslados_id_seq"'::regclass)
WHERE "id" IS NULL;

SELECT setval(
  '"traslados_id_seq"',
  GREATEST(COALESCE((SELECT max("id") FROM "traslados"), 0) + 1, 1),
  false
);

ALTER TABLE "traslados"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "estado_logistico" SET DEFAULT 'por_planificar',
  ALTER COLUMN "estado_logistico" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'traslados'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "traslados"
      ADD CONSTRAINT "traslados_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'traslados'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 1
      AND a.attname = 'delivery_id'
  ) THEN
    ALTER TABLE "traslados"
      ADD CONSTRAINT "traslados_delivery_id_unique" UNIQUE ("delivery_id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'traslados'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 1
      AND a.attname = 'odoo_picking_id'
  ) THEN
    ALTER TABLE "traslados"
      ADD CONSTRAINT "traslados_odoo_picking_id_unique" UNIQUE ("odoo_picking_id");
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "traslados"
    ADD CONSTRAINT "traslados_delivery_id_deliveries_id_fk"
    FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "traslados"
    ADD CONSTRAINT "traslados_almacen_origen_id_almacenes_id_fk"
    FOREIGN KEY ("almacen_origen_id") REFERENCES "almacenes"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "traslados"
    ADD CONSTRAINT "traslados_almacen_destino_id_almacenes_id_fk"
    FOREIGN KEY ("almacen_destino_id") REFERENCES "almacenes"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "traslados_almacen_origen_id_idx"
  ON "traslados" ("almacen_origen_id");
CREATE INDEX IF NOT EXISTS "traslados_almacen_destino_id_idx"
  ON "traslados" ("almacen_destino_id");
CREATE INDEX IF NOT EXISTS "traslados_estado_logistico_idx"
  ON "traslados" ("estado_logistico");
`;
