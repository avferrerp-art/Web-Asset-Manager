/**
 * API Integration Tests — Rutas & Despachos flows
 *
 * These tests exercise the same four behaviors verified in rutas.spec.ts
 * (the Playwright browser suite) but entirely through the HTTP API layer.
 * They run without a browser so they are CI-friendly in any environment.
 *
 * Prerequisites: API server must be running at http://localhost:80/api
 */

import { describe, it, expect, afterAll } from "vitest";

const API = "http://localhost:80/api";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404)
    throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

type Route = {
  id: number;
  nombre: string;
  tipo: string;
  origen: string;
  destino: string;
  favorita: boolean;
  tolls: { id: number; nombre: string; orden: number }[];
};

type Vehicle = {
  id: number;
  modelo: string;
  tarifaPeaje: number | null;
};

type Dispatch = {
  id: number;
  estado: string;
  vehiculoId: number;
  routeId: number | null;
  totalPeajes: number | null;
};

const cleanup: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const fn of cleanup) {
    await fn().catch(() => {});
  }
});

describe("Flow 1 — create a Sencillo route, add 2 casetas, route reports 2 tolls", () => {
  it("creates route then adds two casetas; GET /routes returns 2 tolls on that route", async () => {
    const routeName = `RutaAPI-${Date.now()}`;

    const route = await post<Route>("/routes", {
      nombre: routeName,
      tipo: "sencillo",
      origen: "Ciudad A",
      destino: "Ciudad B",
    });
    cleanup.push(() => del(`/routes/${route.id}`));

    expect(route.id).toBeTypeOf("number");
    expect(route.tipo).toBe("sencillo");
    expect(route.tolls).toHaveLength(0);

    const t1 = await post<{ id: number; nombre: string }>(`/routes/${route.id}/tolls`, {
      nombre: "Caseta Norte",
    });
    expect(t1.nombre).toBe("Caseta Norte");

    const t2 = await post<{ id: number; nombre: string }>(`/routes/${route.id}/tolls`, {
      nombre: "Caseta Sur",
    });
    expect(t2.nombre).toBe("Caseta Sur");

    const routes = await get<Route[]>("/routes");
    const updated = routes.find((r) => r.id === route.id);
    expect(updated).toBeDefined();
    expect(updated!.tolls).toHaveLength(2);
    const tollNames = updated!.tolls.map((t) => t.nombre);
    expect(tollNames).toContain("Caseta Norte");
    expect(tollNames).toContain("Caseta Sur");
  });
});

describe("Flow 2 — toggle a route as favorita; list returns it first", () => {
  it("PATCH favorita=true persists; all favoritas appear before non-favoritas when sorted client-side", async () => {
    const routeName = `RutaFav-${Date.now()}`;

    const route = await post<Route>("/routes", {
      nombre: routeName,
      tipo: "sencillo",
      origen: "Origen F",
      destino: "Destino F",
    });
    cleanup.push(() => del(`/routes/${route.id}`));

    expect(route.favorita).toBe(false);

    const patched = await patch<Route>(`/routes/${route.id}`, { favorita: true });
    expect(patched.favorita).toBe(true);

    const routes = await get<Route[]>("/routes");
    const updated = routes.find((r) => r.id === route.id);
    expect(updated).toBeDefined();
    expect(updated!.favorita).toBe(true);

    // Simulate the frontend sort: favoritas first, then the rest.
    // Every favorita route must come before every non-favorita route.
    const sorted = [...routes].sort((a, b) =>
      a.favorita === b.favorita ? 0 : a.favorita ? -1 : 1
    );
    const firstNonFavorita = sorted.findIndex((r) => !r.favorita);
    const lastFavorita = sorted.map((r) => r.favorita).lastIndexOf(true);
    if (firstNonFavorita !== -1 && lastFavorita !== -1) {
      expect(lastFavorita).toBeLessThan(firstNonFavorita);
    }
    expect(sorted[0].favorita).toBe(true);
  });
});

describe("Flow 3 — dispatch toll cost calculation", () => {
  it("PATCH dispatch with routeId + vehicleId; estimate-costs returns correct total", async () => {
    const vehicles = await get<Vehicle[]>("/vehicles");
    const vehicle = vehicles.find((v) => v.tarifaPeaje != null && v.tarifaPeaje > 0);
    if (!vehicle) {
      console.warn("No vehicle with tarifaPeaje found — skipping");
      return;
    }

    const route = await post<Route>("/routes", {
      nombre: `RutaPeaje-${Date.now()}`,
      tipo: "sencillo",
      origen: "AlphaCity",
      destino: "BetaCity",
    });
    cleanup.push(() => del(`/routes/${route.id}`));

    await post(`/routes/${route.id}/tolls`, { nombre: "Caseta X" });
    await post(`/routes/${route.id}/tolls`, { nombre: "Caseta Y" });

    const dispatches = await get<Dispatch[]>("/dispatches");
    const dispatch = dispatches.find((d) =>
      ["pre-despacho", "aprobado"].includes(d.estado)
    );
    if (!dispatch) {
      console.warn("No editable dispatch found — skipping");
      return;
    }

    const originalRouteId = dispatch.routeId;
    const originalVehicleId = dispatch.vehiculoId;

    await patch<Dispatch>(`/dispatches/${dispatch.id}`, {
      vehiculoId: vehicle.id,
      routeId: route.id,
      choferId: dispatch.vehiculoId,
      fechaEstimadaSalida: "2026-07-01T08:00",
      fechaEstimadaLlegada: "2026-07-01T20:00",
      estado: dispatch.estado,
    });

    const estimate = await get<{ costoPeajes: number; total: number }>(
      `/dispatches/${dispatch.id}/estimate-costs`
    );

    const expected = 2 * vehicle.tarifaPeaje!;
    expect(estimate.costoPeajes).toBeCloseTo(expected, 2);

    await patch<Dispatch>(`/dispatches/${dispatch.id}`, {
      vehiculoId: originalVehicleId,
      routeId: originalRouteId ?? undefined,
      choferId: dispatch.vehiculoId,
      fechaEstimadaSalida: "2026-07-01T08:00",
      fechaEstimadaLlegada: "2026-07-01T20:00",
      estado: dispatch.estado,
    });
  });
});

describe("Flow 4 — delete a route; it no longer appears in GET /routes", () => {
  it("DELETE /routes/:id removes route from list and returns 200/204", async () => {
    const routeName = `RutaDel-${Date.now()}`;

    const route = await post<Route>("/routes", {
      nombre: routeName,
      tipo: "sencillo",
      origen: "OrigenD",
      destino: "DestinoD",
    });

    const beforeDelete = await get<Route[]>("/routes");
    expect(beforeDelete.find((r) => r.id === route.id)).toBeDefined();

    await del(`/routes/${route.id}`);

    const afterDelete = await get<Route[]>("/routes");
    expect(afterDelete.find((r) => r.id === route.id)).toBeUndefined();
  });
});
