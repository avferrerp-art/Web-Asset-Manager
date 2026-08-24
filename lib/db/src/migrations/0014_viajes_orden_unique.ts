// Serializes stop positions inside each trip. Kept separate from 0013 because
// task databases may already have recorded that migration before this invariant.
export const name = "0014_viajes_orden_unique";

export const sql = `
WITH ordered_dispatches AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "viaje_id"
      ORDER BY "orden" NULLS LAST, "id"
    )::integer AS "new_order"
  FROM "dispatches"
  WHERE "viaje_id" IS NOT NULL
)
UPDATE "dispatches" AS dispatch
SET "orden" = ordered."new_order"
FROM ordered_dispatches AS ordered
WHERE dispatch."id" = ordered."id"
  AND dispatch."orden" IS DISTINCT FROM ordered."new_order";

CREATE UNIQUE INDEX IF NOT EXISTS "dispatches_viaje_orden_unique"
  ON "dispatches" ("viaje_id", "orden")
  WHERE "viaje_id" IS NOT NULL AND "orden" IS NOT NULL;
`;