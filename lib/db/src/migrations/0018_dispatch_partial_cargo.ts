export const name = "0018_dispatch_partial_cargo";

export const sql = `
ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS carga_parcial boolean NOT NULL DEFAULT false;
`;