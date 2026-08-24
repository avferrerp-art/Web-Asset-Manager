export function effectiveDispatchMeasure(
  odooValue: number | null | undefined,
  estimate: number | null | undefined,
  zeroMeansMissing = false,
): number | null {
  const hasOdooValue =
    odooValue != null && (!zeroMeansMissing || odooValue > 0);
  if (hasOdooValue) return odooValue;
  return estimate != null && estimate > 0 ? estimate : null;
}

export function exceedsDispatchCapacity(
  capacidad: { capacidadPeso: number; capacidadVolumen: number },
  carga: { pesoKg: number | null; volumenM3: number | null },
) {
  return (
    (carga.pesoKg !== null && capacidad.capacidadPeso < carga.pesoKg) ||
    (carga.volumenM3 !== null && capacidad.capacidadVolumen < carga.volumenM3)
  );
}