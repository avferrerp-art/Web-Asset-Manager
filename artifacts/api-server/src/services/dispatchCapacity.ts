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

export function effectivePartialDispatchMeasure(
  cargaParcial: boolean,
  odooValue: number | null | undefined,
  quotaOrEstimate: number | null | undefined,
  zeroMeansMissing = false,
): number | null {
  if (cargaParcial) {
    return quotaOrEstimate != null && quotaOrEstimate > 0
      ? quotaOrEstimate
      : null;
  }
  return effectiveDispatchMeasure(odooValue, quotaOrEstimate, zeroMeansMissing);
}

export function hasPositivePartialCargoQuota(carga: {
  cargaParcial: boolean;
  pesoEstimadoKg?: number | null;
  volumenEstimadoM3?: number | null;
}): boolean {
  return (
    !carga.cargaParcial ||
    (carga.pesoEstimadoKg != null && carga.pesoEstimadoKg > 0) ||
    (carga.volumenEstimadoM3 != null && carga.volumenEstimadoM3 > 0)
  );
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