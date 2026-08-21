// Arrival records are independent operational facts, one per dispatch.
// The DDL is repeatable because task databases can already contain pieces of it.
export const name = "0011_actas_llegada";

export const sql = `
CREATE TABLE IF NOT EXISTS "actas_llegada" (
  "id" serial PRIMARY KEY,
  "despacho_id" integer NOT NULL,
  "fecha_llegada" timestamptz NOT NULL,
  "registrada_por_id" integer,
  "novedades_viaje" text,
  "recibido_por" text,
  "confirmada_por_id" integer,
  "confirmada_at" timestamptz,
  "novedades_recepcion" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'actas_llegada'::regclass
      AND conname = 'actas_llegada_despacho_id_dispatches_id_fk'
  ) THEN
    ALTER TABLE "actas_llegada"
      ADD CONSTRAINT "actas_llegada_despacho_id_dispatches_id_fk"
      FOREIGN KEY ("despacho_id") REFERENCES "dispatches"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'actas_llegada'::regclass
      AND conname = 'actas_llegada_registrada_por_id_personnel_id_fk'
  ) THEN
    ALTER TABLE "actas_llegada"
      ADD CONSTRAINT "actas_llegada_registrada_por_id_personnel_id_fk"
      FOREIGN KEY ("registrada_por_id") REFERENCES "personnel"("id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'actas_llegada'::regclass
      AND conname = 'actas_llegada_confirmada_por_id_personnel_id_fk'
  ) THEN
    ALTER TABLE "actas_llegada"
      ADD CONSTRAINT "actas_llegada_confirmada_por_id_personnel_id_fk"
      FOREIGN KEY ("confirmada_por_id") REFERENCES "personnel"("id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'actas_llegada'::regclass
      AND conname = 'actas_llegada_despacho_id_unique'
  ) THEN
    ALTER TABLE "actas_llegada"
      ADD CONSTRAINT "actas_llegada_despacho_id_unique" UNIQUE ("despacho_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "actas_llegada_despacho_id_idx"
  ON "actas_llegada" ("despacho_id");
`;