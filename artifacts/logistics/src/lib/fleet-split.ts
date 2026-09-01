import { roundPartialQuotaSum } from "./medidas";

export interface SplitVehicle {
  id: number;
  capacidadPeso: number;
  capacidadVolumen: number;
}

export interface TramoReparto<V extends SplitVehicle> {
  orden: number;
  vehiculo: V;
  pesoKg: number | null;
  volumenM3: number | null;
}

export type EstrategiaReparto = "flota-simultanea" | "viajes-sucesivos";

export interface PlanDeReparto<V extends SplitVehicle> {
  estrategia: EstrategiaReparto;
  tramos: TramoReparto<V>[];
  viable: boolean;
  motivoNoViable: string | null;
}

const MAX_TRAMOS = 10;
const FRACTION_EPSILON = 1e-12;

function planNoViable<V extends SplitVehicle>(
  estrategia: EstrategiaReparto,
  motivoNoViable: string,
): PlanDeReparto<V> {
  return { estrategia, tramos: [], viable: false, motivoNoViable };
}

function vehiculoUtilizable(vehiculo: SplitVehicle): boolean {
  return Number.isFinite(vehiculo.capacidadPeso)
    && vehiculo.capacidadPeso > 0
    && Number.isFinite(vehiculo.capacidadVolumen)
    && vehiculo.capacidadVolumen > 0;
}

/**
 * Fracción del total (0..1) que este vehículo puede llevar.
 * Devuelve 0 si el vehículo es inutilizable o no hay datos de carga.
 */
export function fraccionQueEntra(
  vehiculo: SplitVehicle,
  pesoTotal: number | null,
  volumenTotal: number | null,
): number {
  if (!vehiculoUtilizable(vehiculo) || (pesoTotal == null && volumenTotal == null)) return 0;

  const limites: number[] = [];
  if (pesoTotal != null) limites.push(vehiculo.capacidadPeso / pesoTotal);
  if (volumenTotal != null) limites.push(vehiculo.capacidadVolumen / volumenTotal);
  const fraccion = Math.min(1, ...limites);
  return Number.isFinite(fraccion) && fraccion > 0 ? fraccion : 0;
}

function construirTramos<V extends SplitVehicle>(
  asignaciones: Array<{ vehiculo: V; fraccion: number }>,
  pesoTotal: number | null,
  volumenTotal: number | null,
): TramoReparto<V>[] {
  let pesoAsignado = 0;
  let volumenAsignado = 0;

  return asignaciones.map(({ vehiculo, fraccion }, index) => {
    const ultimo = index === asignaciones.length - 1;
    const pesoKg = pesoTotal == null
      ? null
      : ultimo
        ? roundPartialQuotaSum(pesoTotal - pesoAsignado)
        : roundPartialQuotaSum(pesoTotal * fraccion);
    const volumenM3 = volumenTotal == null
      ? null
      : ultimo
        ? roundPartialQuotaSum(volumenTotal - volumenAsignado)
        : roundPartialQuotaSum(volumenTotal * fraccion);

    if (pesoKg != null) pesoAsignado = roundPartialQuotaSum(pesoAsignado + pesoKg);
    if (volumenM3 != null) volumenAsignado = roundPartialQuotaSum(volumenAsignado + volumenM3);
    return { orden: index + 1, vehiculo, pesoKg, volumenM3 };
  });
}

/** Escenario A: varios camiones distintos, cada uno una sola vez. */
export function planFlotaSimultanea<V extends SplitVehicle>(
  vehiculos: V[],
  pesoTotal: number | null,
  volumenTotal: number | null,
): PlanDeReparto<V> {
  const estrategia = "flota-simultanea";
  if (pesoTotal == null && volumenTotal == null) {
    return planNoViable(estrategia, "No hay peso ni volumen para calcular el reparto");
  }

  const candidatos = vehiculos
    .map((vehiculo) => ({ vehiculo, fraccion: fraccionQueEntra(vehiculo, pesoTotal, volumenTotal) }))
    .filter(({ fraccion }) => fraccion > 0)
    .sort((a, b) => b.fraccion - a.fraccion);
  if (candidatos.length === 0) {
    return planNoViable(estrategia, "No hay vehículos con capacidad válida");
  }

  const asignaciones: Array<{ vehiculo: V; fraccion: number }> = [];
  let acumulado = 0;
  for (const candidato of candidatos) {
    if (acumulado >= 1 - FRACTION_EPSILON) break;
    const fraccion = Math.min(candidato.fraccion, 1 - acumulado);
    asignaciones.push({ vehiculo: candidato.vehiculo, fraccion });
    acumulado += fraccion;
  }
  if (acumulado < 1 - FRACTION_EPSILON) {
    return planNoViable(estrategia, "La flota completa no alcanza para esta carga");
  }
  if (asignaciones.length > MAX_TRAMOS) {
    return planNoViable(estrategia, "El plan requiere más de 10 tramos");
  }
  return {
    estrategia,
    tramos: construirTramos(asignaciones, pesoTotal, volumenTotal),
    viable: true,
    motivoNoViable: null,
  };
}

/** Escenario B: un solo camión haciendo N salidas. */
export function planViajesSucesivos<V extends SplitVehicle>(
  vehiculos: V[],
  pesoTotal: number | null,
  volumenTotal: number | null,
): PlanDeReparto<V> {
  const estrategia = "viajes-sucesivos";
  if (pesoTotal == null && volumenTotal == null) {
    return planNoViable(estrategia, "No hay peso ni volumen para calcular el reparto");
  }

  const candidatos = vehiculos
    .map((vehiculo) => {
      const fraccion = fraccionQueEntra(vehiculo, pesoTotal, volumenTotal);
      return { vehiculo, fraccion, salidas: fraccion > 0 ? Math.ceil(1 / fraccion) : Infinity };
    })
    .filter(({ salidas }) => Number.isFinite(salidas))
    .sort((a, b) => a.salidas - b.salidas || a.fraccion - b.fraccion);
  if (candidatos.length === 0) {
    return planNoViable(estrategia, "No hay vehículos con capacidad válida");
  }

  const elegido = candidatos[0];
  if (elegido.salidas > MAX_TRAMOS) {
    return planNoViable(estrategia, "El plan requiere más de 10 tramos");
  }
  const asignaciones = Array.from({ length: elegido.salidas }, (_, index) => ({
    vehiculo: elegido.vehiculo,
    fraccion: index === elegido.salidas - 1
      ? 1 - elegido.fraccion * index
      : elegido.fraccion,
  }));
  return {
    estrategia,
    tramos: construirTramos(asignaciones, pesoTotal, volumenTotal),
    viable: true,
    motivoNoViable: null,
  };
}

/**
 * Avisa cuando la densidad implícita de la carga parece incorrecta.
 */
export function densidadImplausible(
  pesoTotal: number | null,
  volumenTotal: number | null,
): string | null {
  if (pesoTotal == null || volumenTotal == null || volumenTotal <= 0) return null;
  const densidad = pesoTotal / volumenTotal;
  if (densidad < 20 || densidad > 2_000) {
    return "La densidad parece incorrecta; revise los datos de peso y volumen en Odoo";
  }
  return null;
}