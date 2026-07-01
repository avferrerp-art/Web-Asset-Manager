import type { TollRoute, RouteToll, RouteWaypoint } from "@workspace/db";

export interface RouteTramo {
  label: string;
  distanciaKm: number;
}

export interface RouteCostBreakdown {
  distanciaTotalKm: number;
  costoPeajesTotal: number;
  tramos: RouteTramo[];
}

/**
 * Computes the total distance and toll cost for a route, taking its `tipo`
 * (sencillo | redondo | multidestino) into account.
 *
 * - sencillo: distance/tolls are used as-is (unchanged behavior).
 * - redondo: distance and tolls are doubled to account for the return trip.
 * - multidestino: distance is the sum of each waypoint leg plus the final leg
 *   into `destino` (`route.distanciaKm` is interpreted as the distance of
 *   that final leg). Tolls are summed as-is since casetas aren't tied to a
 *   specific leg.
 */
export function computeRouteCostBreakdown(
  route: TollRoute,
  tolls: RouteToll[],
  waypoints: RouteWaypoint[]
): RouteCostBreakdown {
  const baseDistancia = route.distanciaKm ?? 0;
  const tollsSum = tolls.reduce((sum, t) => sum + (t.tarifa ?? 0), 0);

  if (route.tipo === "redondo") {
    return {
      distanciaTotalKm: baseDistancia * 2,
      costoPeajesTotal: tollsSum * 2,
      tramos: [
        { label: `Ida: ${route.origen} → ${route.destino}`, distanciaKm: baseDistancia },
        { label: `Vuelta: ${route.destino} → ${route.origen}`, distanciaKm: baseDistancia },
      ],
    };
  }

  if (route.tipo === "multidestino") {
    const sortedWaypoints = [...waypoints].sort((a, b) => a.orden - b.orden);
    const tramos: RouteTramo[] = [];
    let prevLabel = route.origen;
    let total = 0;
    for (const wp of sortedWaypoints) {
      const d = wp.distanciaKm ?? 0;
      tramos.push({ label: `${prevLabel} → ${wp.ubicacion}`, distanciaKm: d });
      total += d;
      prevLabel = wp.ubicacion;
    }
    tramos.push({ label: `${prevLabel} → ${route.destino}`, distanciaKm: baseDistancia });
    total += baseDistancia;

    return { distanciaTotalKm: total, costoPeajesTotal: tollsSum, tramos };
  }

  return {
    distanciaTotalKm: baseDistancia,
    costoPeajesTotal: tollsSum,
    tramos: [{ label: `${route.origen} → ${route.destino}`, distanciaKm: baseDistancia }],
  };
}
