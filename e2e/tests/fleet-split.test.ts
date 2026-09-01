/**
 * Unit tests — pure fleet load-distribution engine.
 *
 * Covers simultaneous fleet use, successive trips, partial measures,
 * exact quota closure, invalid capacity, density warnings and safe limits.
 */

import { describe, expect, it } from "vitest";
import {
  densidadImplausible,
  fraccionQueEntra,
  planFlotaSimultanea,
  planViajesSucesivos,
} from "../../artifacts/logistics/src/lib/fleet-split";
import { roundPartialQuotaSum } from "../../artifacts/logistics/src/lib/medidas";

const mitsubishi = {
  id: 1,
  modelo: "Mitsubishi FM 657 2",
  capacidadPeso: 11_000,
  capacidadVolumen: 28,
};
const iveco = { id: 2, modelo: "Iveco Daily", capacidadPeso: 3_500, capacidadVolumen: 12.5 };
const foton = { id: 3, modelo: "Foton TM2", capacidadPeso: 2_000, capacidadVolumen: 7 };
const l300 = {
  id: 4,
  modelo: "Mitsubishi Panel L300",
  capacidadPeso: 1_000,
  capacidadVolumen: 5.7,
};
const silverado = {
  id: 5,
  modelo: "Silverado Chevrolet",
  capacidadPeso: 950,
  capacidadVolumen: 2,
};
const flotaReal = [silverado, foton, mitsubishi, l300, iveco];

describe("Fleet load distribution", () => {
  it("uses weight and volume together, with volume limiting the real 50/50 load", () => {
    expect(fraccionQueEntra(mitsubishi, 50, 50)).toBe(0.56);
    expect(fraccionQueEntra(iveco, 50, 50)).toBe(0.25);
    expect(fraccionQueEntra(foton, 50, 50)).toBe(0.14);
    expect(fraccionQueEntra(l300, 50, 50)).toBe(0.114);
    expect(fraccionQueEntra(silverado, 50, 50)).toBe(0.04);
  });

  it("plans the real fleet once per vehicle and closes both totals exactly", () => {
    const plan = planFlotaSimultanea(flotaReal, 50, 50);
    expect(plan.viable).toBe(true);
    expect(plan.tramos.map((tramo) => [
      tramo.orden,
      tramo.vehiculo.modelo,
      tramo.pesoKg,
      tramo.volumenM3,
    ])).toEqual([
      [1, "Mitsubishi FM 657 2", 28, 28],
      [2, "Iveco Daily", 12.5, 12.5],
      [3, "Foton TM2", 7, 7],
      [4, "Mitsubishi Panel L300", 2.5, 2.5],
    ]);
    expect(plan.tramos.reduce((total, tramo) => total + (tramo.pesoKg ?? 0), 0)).toBe(50);
    expect(plan.tramos.reduce((total, tramo) => total + (tramo.volumenM3 ?? 0), 0)).toBe(50);
  });

  it("plans successive trips with the vehicle needing the fewest exits", () => {
    const plan = planViajesSucesivos(flotaReal, 50, 50);
    expect(plan.viable).toBe(true);
    expect(plan.tramos.map((tramo) => [
      tramo.orden,
      tramo.vehiculo.modelo,
      tramo.pesoKg,
      tramo.volumenM3,
    ])).toEqual([
      [1, "Mitsubishi FM 657 2", 28, 28],
      [2, "Mitsubishi FM 657 2", 22, 22],
    ]);
  });

  it("uses only the known dimension and leaves unknown quotas null", () => {
    const plan = planViajesSucesivos([foton], null, 10);
    expect(plan.viable).toBe(true);
    expect(plan.tramos).toHaveLength(2);
    expect(plan.tramos.map((tramo) => tramo.pesoKg)).toEqual([null, null]);
    expect(plan.tramos.map((tramo) => tramo.volumenM3)).toEqual([7, 3]);
    expect(fraccionQueEntra(foton, 1_000, null)).toBe(1);
  });

  it("closes rounded partial quotas with capacities representable at three decimals", () => {
    const thirds = { id: 6, capacidadPeso: 0.334, capacidadVolumen: 1 };
    const plan = planViajesSucesivos([thirds], 1, null);
    expect(plan.tramos.map((tramo) => tramo.pesoKg)).toEqual([0.334, 0.334, 0.332]);
    expect(plan.tramos.every((tramo) => (tramo.pesoKg ?? 0) <= tramo.vehiculo.capacidadPeso)).toBe(true);
    expect(roundPartialQuotaSum(
      plan.tramos.reduce((total, tramo) => total + (tramo.pesoKg ?? 0), 0),
    )).toBe(1);
  });

  it("keeps a real final quota positive without exceeding either vehicle capacity", () => {
    const plan = planFlotaSimultanea(flotaReal, 11_000.74, 4.9289);
    expect(plan.viable).toBe(true);
    expect(plan.tramos.map(({ pesoKg, volumenM3 }) => [pesoKg, volumenM3])).toEqual([
      [11_000, 4.928],
      [0.74, 0.001],
    ]);
    for (const tramo of plan.tramos) {
      expect(tramo.pesoKg).toBeGreaterThan(0);
      expect(tramo.volumenM3).toBeGreaterThan(0);
      expect(tramo.pesoKg).toBeLessThanOrEqual(tramo.vehiculo.capacidadPeso);
      expect(tramo.volumenM3).toBeLessThanOrEqual(tramo.vehiculo.capacidadVolumen);
    }
  });

  it("rounds known dimensions independently and preserves unknown dimensions", () => {
    const onlyWeight = planFlotaSimultanea(flotaReal, 11_000.74, null);
    expect(onlyWeight.tramos.map(({ pesoKg, volumenM3 }) => [pesoKg, volumenM3])).toEqual([
      [11_000, null],
      [0.74, null],
    ]);

    const onlyVolume = planFlotaSimultanea(flotaReal, null, 28.0004);
    expect(onlyVolume.tramos.every((tramo) => tramo.pesoKg === null)).toBe(true);
    expect(onlyVolume.tramos.every((tramo) => (
      tramo.volumenM3 != null
      && tramo.volumenM3 > 0
      && tramo.volumenM3 <= tramo.vehiculo.capacidadVolumen
    ))).toBe(true);
  });

  it("leaves an unabsorbable rounding residue unassigned rather than exceeding capacity", () => {
    const capacidadNoRepresentable = { id: 20, capacidadPeso: 0.3335, capacidadVolumen: 1 };
    const plan = planViajesSucesivos([capacidadNoRepresentable], 1, null);
    expect(plan.viable).toBe(true);
    expect(plan.tramos.every((tramo) => (
      tramo.pesoKg != null && tramo.pesoKg > 0 && tramo.pesoKg <= tramo.vehiculo.capacidadPeso
    ))).toBe(true);
    expect(roundPartialQuotaSum(
      plan.tramos.reduce((total, tramo) => total + (tramo.pesoKg ?? 0), 0),
    )).toBe(0.999);
  });

  it("rejects a split when positive minimum quotas would create load", () => {
    const minimos = [
      { id: 21, capacidadPeso: 0.001, capacidadVolumen: 1 },
      { id: 22, capacidadPeso: 0.001, capacidadVolumen: 1 },
    ];
    expect(planFlotaSimultanea(minimos, 0.0014, null)).toMatchObject({
      viable: false,
      tramos: [],
      motivoNoViable: "La precisión mínima no permite repartir esta carga",
    });

    const dosViajes = { id: 23, capacidadPeso: 1, capacidadVolumen: 1 };
    expect(planViajesSucesivos([dosViajes], 2, 0.001)).toMatchObject({
      viable: false,
      tramos: [],
      motivoNoViable: "La precisión mínima no permite repartir esta carga",
    });
  });

  it("accepts exactly ten decimal fractions despite floating-point accumulation", () => {
    const decimos = Array.from({ length: 10 }, (_, index) => ({
      id: 100 + index,
      capacidadPeso: 0.1,
      capacidadVolumen: 0.1,
    }));
    const plan = planFlotaSimultanea(decimos, 1, 1);
    expect(plan).toMatchObject({ viable: true, motivoNoViable: null });
    expect(plan.tramos).toHaveLength(10);
    expect(roundPartialQuotaSum(
      plan.tramos.reduce((total, tramo) => total + (tramo.pesoKg ?? 0), 0),
    )).toBe(1);
    expect(roundPartialQuotaSum(
      plan.tramos.reduce((total, tramo) => total + (tramo.volumenM3 ?? 0), 0),
    )).toBe(1);
  });

  it("returns a one-leg plan when the load fits", () => {
    const plan = planFlotaSimultanea(flotaReal, 500, 1);
    expect(plan).toMatchObject({ viable: true, motivoNoViable: null });
    expect(plan.tramos).toHaveLength(1);
  });

  it("rejects missing measures, insufficient fleets and plans over ten legs", () => {
    expect(planFlotaSimultanea(flotaReal, null, null)).toMatchObject({
      viable: false,
      motivoNoViable: "No hay peso ni volumen para calcular el reparto",
    });
    expect(planFlotaSimultanea([silverado], 50, 50)).toMatchObject({
      viable: false,
      motivoNoViable: "La flota completa no alcanza para esta carga",
    });
    expect(planViajesSucesivos(
      [{ id: 7, capacidadPeso: 90, capacidadVolumen: 1 }],
      1_000,
      null,
    )).toMatchObject({ viable: false, motivoNoViable: "El plan requiere más de 10 tramos" });
  });

  it("discards zero-capacity vehicles and always terminates", () => {
    const invalidos = [
      { id: 8, capacidadPeso: 0, capacidadVolumen: 10 },
      { id: 9, capacidadPeso: 1_000, capacidadVolumen: 0 },
    ];
    expect(fraccionQueEntra(invalidos[0], 1, 1)).toBe(0);
    expect(planFlotaSimultanea(invalidos, 1, 1)).toMatchObject({
      viable: false,
      tramos: [],
      motivoNoViable: "No hay vehículos con capacidad válida",
    });
    expect(planViajesSucesivos(invalidos, 1, 1)).toMatchObject({
      viable: false,
      tramos: [],
      motivoNoViable: "No hay vehículos con capacidad válida",
    });
  });

  it("breaks equal-trip ties in favor of the tighter vehicle", () => {
    const holgado = { id: 10, capacidadPeso: 5_000, capacidadVolumen: 34 };
    const plan = planViajesSucesivos([holgado, mitsubishi], 50, 50);
    expect(plan.tramos[0]?.vehiculo.id).toBe(mitsubishi.id);
  });

  it("warns only when both measures imply density outside 20–2000 kg/m³", () => {
    expect(densidadImplausible(50, 50)).toContain("Odoo");
    expect(densidadImplausible(3_698.7, 10.79)).toBeNull();
    expect(densidadImplausible(2_001, 1)).toContain("Odoo");
    expect(densidadImplausible(null, 50)).toBeNull();
  });
});