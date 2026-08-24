export const name = "0017_backfill_dispatch_cargo_estimates";

export const sql = `
DO $$
BEGIN
  IF to_regclass('traslados') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'traslados'
        AND column_name = 'peso_estimado_kg'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'traslados'
        AND column_name = 'peso_calculado_kg'
    )
  THEN
    EXECUTE $backfill$
      UPDATE dispatches AS dispatch
      SET peso_estimado_kg = traslado.peso_estimado_kg
      FROM traslados AS traslado
      WHERE dispatch.tipo = 'traslado'
        AND dispatch.traslado_id = traslado.id
        AND dispatch.peso_estimado_kg IS NULL
        AND traslado.peso_calculado_kg IS NULL
        AND traslado.peso_estimado_kg > 0
    $backfill$;
  END IF;
END $$;
`;