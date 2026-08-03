/**
 * Pure fleet-compatibility logic for the load calculator (carga.tsx).
 *
 * A vehicle "fits" when both weight and volume utilization are ≤ 100% and
 * both capacities are > 0 (a 0 capacity would divide by zero / Infinity).
 * Fit vehicles are sorted by utilization descending, so the FIRST one is the
 * tightest fit — i.e. the smallest vehicle that still supports the load —
 * and is the one shown as "SUGERIDO".
 */

export interface FleetVehicleCapacity {
  capacidadPeso: number;
  capacidadVolumen: number;
}

export interface ClassifiedVehicle<V extends FleetVehicleCapacity> {
  vehicle: V;
  hasCapacity: boolean;
  weightPct: number;
  volPct: number;
  maxPct: number;
  isFit: boolean;
}

export function classifyVehicle<V extends FleetVehicleCapacity>(
  vehicle: V,
  totalPeso: number,
  totalVolumen: number,
): ClassifiedVehicle<V> {
  const hasCapacity = vehicle.capacidadPeso > 0 && vehicle.capacidadVolumen > 0;
  const weightPct = hasCapacity ? (totalPeso / vehicle.capacidadPeso) * 100 : NaN;
  const volPct = hasCapacity ? (totalVolumen / vehicle.capacidadVolumen) * 100 : NaN;
  const maxPct = Math.max(weightPct, volPct);
  const isFit = hasCapacity && Number.isFinite(maxPct) && maxPct <= 100;
  return { vehicle, hasCapacity, weightPct, volPct, maxPct, isFit };
}

export function classifyFleet<V extends FleetVehicleCapacity>(
  vehicles: V[],
  totalPeso: number,
  totalVolumen: number,
): { fit: ClassifiedVehicle<V>[]; unfit: ClassifiedVehicle<V>[] } {
  const classified = vehicles.map((v) => classifyVehicle(v, totalPeso, totalVolumen));
  const fit = classified.filter((v) => v.isFit).sort((a, b) => b.maxPct - a.maxPct);
  const unfit = classified.filter((v) => !v.isFit);
  return { fit, unfit };
}

/** The suggested vehicle: tightest fit (smallest that supports the load), or null. */
export function suggestedVehicle<V extends FleetVehicleCapacity>(
  vehicles: V[],
  totalPeso: number,
  totalVolumen: number,
): V | null {
  return classifyFleet(vehicles, totalPeso, totalVolumen).fit[0]?.vehicle ?? null;
}
