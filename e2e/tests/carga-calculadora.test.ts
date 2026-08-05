/**
 * Unit tests — load calculator fleet suggestion logic
 * (artifacts/logistics/src/lib/fleet.ts, used by the Carga page)
 *
 * Covers:
 *  1. With a small load and a mixed fleet, the SUGGESTED vehicle is the
 *     smallest one that supports the load — not the biggest.
 *  2. When the load exceeds every vehicle, none is suggested (the page then
 *     shows the "split the shipment" warning).
 *  3. A vehicle with capacidadPeso or capacidadVolumen = 0 is never
 *     suggested nor listed as fit (no division by zero / Infinity).
 *
 * Run with: pnpm --filter @workspace/e2e run test:api
 */

import { describe, it, expect } from "vitest";
import {
  classifyFleet,
  suggestedVehicle,
} from "../../artifacts/logistics/src/lib/fleet";

const van = { id: 1, modelo: "Van Chica", capacidadPeso: 800, capacidadVolumen: 6 };
const camion35 = { id: 2, modelo: "Camión 3.5t", capacidadPeso: 3500, capacidadVolumen: 20 };
const trailer = { id: 3, modelo: "Tráiler", capacidadPeso: 25000, capacidadVolumen: 90 };
const sinPeso = { id: 4, modelo: "Sin capacidad peso", capacidadPeso: 0, capacidadVolumen: 10 };
const sinVolumen = { id: 5, modelo: "Sin capacidad volumen", capacidadPeso: 1000, capacidadVolumen: 0 };

describe("Load calculator — fleet suggestion", () => {
  it("suggests the smallest vehicle that supports a small load, not the biggest", () => {
    const fleet = [trailer, van, camion35]; // deliberately unordered
    const suggested = suggestedVehicle(fleet, 500, 3); // fits all three
    expect(suggested).toBe(van);

    const { fit } = classifyFleet(fleet, 500, 3);
    expect(fit).toHaveLength(3);
    // Sorted tightest-fit first: van, then camión, then tráiler.
    expect(fit.map((f) => f.vehicle.id)).toEqual([van.id, camion35.id, trailer.id]);
  });

  it("suggests the smallest vehicle even when the constraint is volume", () => {
    // 100 kg but 15 m³ — van (6 m³) can't take it; camión 3.5t can.
    expect(suggestedVehicle([trailer, van, camion35], 100, 15)).toBe(camion35);
  });

  it("suggests nothing when the load exceeds every vehicle (split-shipment warning)", () => {
    const { fit, unfit } = classifyFleet([van, camion35, trailer], 30000, 120);
    expect(fit).toHaveLength(0); // page renders "Ningún vehículo soporta esta carga"
    expect(unfit).toHaveLength(3);
    expect(suggestedVehicle([van, camion35, trailer], 30000, 120)).toBeNull();
  });

  it("never suggests a vehicle with capacidadPeso or capacidadVolumen = 0", () => {
    const fleet = [sinPeso, sinVolumen];
    const { fit, unfit } = classifyFleet(fleet, 1, 0.001); // tiny load
    expect(fit).toHaveLength(0);
    expect(unfit).toHaveLength(2);
    for (const u of unfit) {
      expect(u.hasCapacity).toBe(false);
      expect(u.isFit).toBe(false);
    }
    expect(suggestedVehicle(fleet, 1, 0.001)).toBeNull();

    // Even mixed with a valid vehicle, the zero-capacity ones never win.
    expect(suggestedVehicle([sinPeso, sinVolumen, van], 1, 0.001)).toBe(van);
  });

  it("REGRESSION: fit vehicles are sorted by utilization DESCENDING (tightest fit first, never emptiest-first)", () => {
    // Guard against re-introducing the ascending sort bug (emptiest vehicle
    // first), which made the wizards preselect the BIGGEST vehicle for tiny
    // loads (e.g. sale #762: 0.96 kg → Foton TM2 2000 kg instead of the
    // Silverado 950 kg).
    const silverado = { id: 10, modelo: "Silverado", capacidadPeso: 950, capacidadVolumen: 5 };
    const fotonTm2 = { id: 11, modelo: "Foton TM2", capacidadPeso: 2000, capacidadVolumen: 12 };
    const fleet = [fotonTm2, silverado, trailer];

    const { fit } = classifyFleet(fleet, 0.96, 0.001);
    expect(fit.length).toBeGreaterThan(1);
    for (let i = 1; i < fit.length; i++) {
      // Descending utilization: each entry is at most as utilized as the previous.
      expect(fit[i].maxPct).toBeLessThanOrEqual(fit[i - 1].maxPct);
    }
    // The tightest fit (smallest capable vehicle) wins — never the biggest.
    expect(suggestedVehicle(fleet, 0.96, 0.001)?.id).toBe(silverado.id);
    expect(fit[fit.length - 1].vehicle.id).toBe(trailer.id);
  });
});
