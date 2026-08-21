// Corrects canonical warehouse accents in databases where 0006 was already
// recorded. Idempotent: repeated executions leave the same values.
export const name = "0007_almacenes_nombres";

export const sql = `
UPDATE "almacenes"
SET "nombre" = 'Lechería'
WHERE "codigo" = 'LEC' AND "nombre" IS DISTINCT FROM 'Lechería';

UPDATE "almacenes"
SET "plaza" = 'Lechería'
WHERE "plaza" = 'Lecheria';
`;
