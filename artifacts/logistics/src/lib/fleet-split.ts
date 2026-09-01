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
const MIN_QUOTA = 0.001;

function capacidadRepresentable(capacidad: number): number {
  return Math.floor((capacidad + Number.EPSILON) * 1_000) / 1_000;
}

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
): TramoReparto<V>[] | null {
  const repartirDimension = (
    total: number | null,
    capacidad: (vehiculo: V) => number,
  ): Array<number | null> | null => {
    if (total == null) return asignaciones.map(() => null);

    const cuotas = asignaciones.map(({ vehiculo, fraccion }) => Math.min(
      roundPartialQuotaSum(total * fraccion),
      capacidadRepresentable(capacidad(vehiculo)),
    ));
    const suma = roundPartialQuotaSum(cuotas.reduce((acumulado, cuota) => acumulado + cuota, 0));
    const residuo = roundPartialQuotaSum(total - suma);

    if (residuo !== 0) {
      const receptor = cuotas
        .map((cuota, index) => ({
          index,
          holgura: roundPartialQuotaSum(capacidad(asignaciones[index].vehiculo) - cuota),
          cuotaAjustada: roundPartialQuotaSum(cuota + residuo),
        }))
        .filter(({ index, cuotaAjustada }) => (
          cuotaAjustada > 0
          && cuotaAjustada <= capacidad(asignaciones[index].vehiculo)
        ))
        .sort((a, b) => b.holgura - a.holgura || b.index - a.index)[0];

      if (receptor) cuotas[receptor.index] = receptor.cuotaAjustada;
      if (!receptor && residuo < 0) return null;
    }

    for (let index = 0; index < cuotas.length; index += 1) {
      if (cuotas[index] > 0) continue;

      const incremento = roundPartialQuotaSum(MIN_QUOTA - cuotas[index]);
      const donante = cuotas
        .map((cuota, donorIndex) => ({ donorIndex, cuota }))
        .filter(({ donorIndex, cuota }) => donorIndex !== index && cuota - incremento > 0)
        .sort((a, b) => b.cuota - a.cuota || b.donorIndex - a.donorIndex)[0];

      if (capacidad(asignaciones[index].vehiculo) < MIN_QUOTA || !donante) return null;
      cuotas[index] = MIN_QUOTA;
      cuotas[donante.donorIndex] = roundPartialQuotaSum(donante.cuota - incremento);
    }

    return cuotas;
  };

  const pesos = repartirDimension(pesoTotal, (vehiculo) => vehiculo.capacidadPeso);
  const volumenes = repartirDimension(volumenTotal, (vehiculo) => vehiculo.capacidadVolumen);
  if (pesos == null || volumenes == null) return null;

  return asignaciones.map(({ vehiculo }, index) => ({
    orden: index + 1,
    vehiculo,
    pesoKg: pesos[index],
    volumenM3: volumenes[index],
  }));
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
  const tramos = construirTramos(asignaciones, pesoTotal, volumenTotal);
  if (tramos == null) {
    return planNoViable(estrategia, "La precisión mínima no permite repartir esta carga");
  }
  return {
    estrategia,
    tramos,
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
  const tramos = construirTramos(asignaciones, pesoTotal, volumenTotal);
  if (tramos == null) {
    return planNoViable(estrategia, "La precisión mínima no permite repartir esta carga");
  }
  return {
    estrategia,
    tramos,
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