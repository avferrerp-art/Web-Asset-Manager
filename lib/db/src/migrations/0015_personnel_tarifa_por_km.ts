// Renames the personnel per-diem column while preserving all existing rates.
// The information_schema guards make this safe for databases at different
// migration/push states.
export const name = "0015_personnel_tarifa_por_km";

export const sql = `
DO $$
DECLARE
  legacy_column text := 'tarifa_' || 'viaticos';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'personnel' AND column_name = legacy_column
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'personnel' AND column_name = 'tarifa_por_km'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I RENAME COLUMN %I TO %I',
      'personnel',
      legacy_column,
      'tarifa_por_km'
    );
  END IF;
END $$;
`;