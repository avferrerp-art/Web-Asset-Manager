export const name = "0016_dispatch_cargo_estimates";

export const sql = `
ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS peso_estimado_kg real,
  ADD COLUMN IF NOT EXISTS volumen_estimado_m3 real;
`;