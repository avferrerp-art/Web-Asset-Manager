import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  almacenesTable,
  db,
  deliveriesTable,
  dispatchesTable,
  fuelPricesTable,
  personnelTable,
  pool,
  routePointsTable,
  runMigrations,
  salesTable,
  travelCostsTable,
  trasladosTable,
  vehiclesTable,
  viajesTable,
} from "@workspace/db";
import {
  GetDispatchResponse,
  GetViajeResponse,
  UpdateDispatchResponse,
} from "../../lib/api-zod/src/generated/api";
import { sql as viajesMigrationSql } from "../../lib/db/src/migrations/0013_viajes";
import { sql as viajesOrderMigrationSql } from "../../lib/db/src/migrations/0014_viajes_orden_unique";
import {
  deriveViajeEstado,
  syncViajeEstadoFromDispatch,
} from "../../artifacts/api-server/src/services/viajeEstadoSync";
import {
  deriveSaleEstado,
  reconcileSaleEstados,
  syncSaleEstadoFromDispatch,
} from "../../artifacts/api-server/src/services/saleEstadoSync";

vi.mock("../../artifacts/api-server/src/middlewares/requireAuth", () => ({
  requireAuth: (
    req: { headers?: Record<string, string | string[] | undefined> },
    res: {
      status: (code: number) => {
        json: (body: { error: string }) => void;
      };
    },
    next: () => void,
  ): void => {
    if (req.headers?.["x-test-auth"] === "authenticated") {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  },
}));

import app from "../../artifacts/api-server/src/app";

const suffix = `${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let vehicleIds: number[] = [];
let personnelIds: number[] = [];
let warehouseIds: number[] = [];
let viajeIds: number[] = [];
let dispatchIds: number[] = [];
let saleIds: number[] = [];
let trasladoIds: number[] = [];
let deliveryIds: number[] = [];
let insertedFuelPriceId: number | null = null;

function auth(): Record<string, string> {
  return {
    "x-test-auth": "authenticated",
    "Content-Type": "application/json",
  };
}

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { ...auth(), ...init.headers },
  });
}

async function createSale(options: { peso?: number | null; volumen?: number | null } = {}) {
  const [sale] = await db
    .insert(salesTable)
    .values({
      cliente: `Cliente conflicto ${suffix}`,
      destino: "Destino QA",
      almacenOrigen: "Origen QA",
      odooRef: `CONFLICT-SALE-${suffix}-${Math.random()}`,
      pesoTotal: "peso" in options ? options.peso : 100,
      volumenTotal: "volumen" in options ? options.volumen : 1,
    })
    .returning();
  saleIds.push(sale!.id);
  return sale!;
}

async function createSaleDispatch(options: {
  peso?: number | null;
  volumen?: number | null;
  pesoEstimadoKg?: number | null;
  volumenEstimadoM3?: number | null;
  estado?: string;
  vehicleId?: number;
  cargaParcial?: boolean;
  choferId?: number;
  ayudanteId?: number | null;
  salida?: string;
  llegada?: string;
}) {
  const [sale] = await db
    .insert(salesTable)
    .values({
      cliente: `Cliente viaje ${suffix}`,
      destino: "Destino QA",
      almacenOrigen: "Origen QA",
      odooRef: `VIAJE-SALE-${suffix}-${Math.random()}`,
      pesoTotal: "peso" in options ? options.peso : 100,
      volumenTotal: "volumen" in options ? options.volumen : 1,
    })
    .returning();
  saleIds.push(sale!.id);
  const [dispatch] = await db
    .insert(dispatchesTable)
    .values({
      tipo: "venta",
      ventaId: sale!.id,
      trasladoId: null,
      vehiculoId: options.vehicleId ?? vehicleIds[0]!,
      choferId: options.choferId ?? personnelIds[0]!,
      ayudanteId: options.ayudanteId ?? null,
      fechaEstimadaSalida: options.salida ?? "2035-08-01T08:00:00.000Z",
      fechaEstimadaLlegada: options.llegada ?? "2035-08-01T18:00:00.000Z",
      estado: options.estado ?? "pre-despacho",
      pesoEstimadoKg: options.pesoEstimadoKg ?? null,
      volumenEstimadoM3: options.volumenEstimadoM3 ?? null,
      cargaParcial: options.cargaParcial ?? false,
    })
    .returning();
  dispatchIds.push(dispatch!.id);
  return dispatch!;
}

async function createTransferDispatch(estado = "pre-despacho") {
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      ventaId: null,
      odooId: -1_500_000_000 - Math.floor(Math.random() * 100_000_000),
      tipo: "traslado",
      nombre: `QA/VIAJE/${suffix}/${Math.random()}`,
      estado: "assigned",
    })
    .returning();
  deliveryIds.push(delivery!.id);
  const [traslado] = await db
    .insert(trasladosTable)
    .values({
      deliveryId: delivery!.id,
      odooPickingId: delivery!.odooId,
      almacenOrigenId: warehouseIds[0]!,
      almacenDestinoId: warehouseIds[1]!,
      pesoCalculadoKg: 200,
      volumenCalculadoM3: 2,
    })
    .returning();
  trasladoIds.push(traslado!.id);
  const [dispatch] = await db
    .insert(dispatchesTable)
    .values({
      tipo: "traslado",
      ventaId: null,
      trasladoId: traslado!.id,
      vehiculoId: vehicleIds[0]!,
      choferId: personnelIds[0]!,
      fechaEstimadaSalida: "2035-08-02T08:00:00.000Z",
      fechaEstimadaLlegada: "2035-08-02T18:00:00.000Z",
      estado,
    })
    .returning();
  dispatchIds.push(dispatch!.id);
  return dispatch!;
}

async function postViaje(body: Record<string, unknown>) {
  const response = await api("/viajes", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (response.ok && typeof json.id === "number") viajeIds.push(json.id);
  return { response, json };
}

beforeAll(async () => {
  await runMigrations();
  await pool.query(viajesMigrationSql);
  await pool.query(viajesOrderMigrationSql);
  const vehicles = await db
    .insert(vehiclesTable)
    .values([
      {
        tipo: "camion",
        modelo: `Grande A ${suffix}`,
        capacidadPeso: 10_000,
        capacidadVolumen: 100,
        tipoCombustible: "diesel",
        rendimientoKmLitro: 8,
      },
      {
        tipo: "camion",
        modelo: `Pequeño ${suffix}`,
        capacidadPeso: 500,
        capacidadVolumen: 5,
        tipoCombustible: "diesel",
        rendimientoKmLitro: 8,
      },
      {
        tipo: "camion",
        modelo: `Grande B ${suffix}`,
        capacidadPeso: 20_000,
        capacidadVolumen: 200,
        tipoCombustible: "diesel",
        rendimientoKmLitro: 8,
      },
    ])
    .returning({ id: vehiclesTable.id });
  vehicleIds = vehicles.map(({ id }) => id);
  const personnel = await db
    .insert(personnelTable)
    .values([
      { nombre: `Chofer A ${suffix}`, rol: "chofer", tarifaPorKm: 0 },
      { nombre: `Chofer B ${suffix}`, rol: "chofer", tarifaPorKm: 0 },
      { nombre: `Ayudante ${suffix}`, rol: "ayudante", tarifaPorKm: 0 },
    ])
    .returning({ id: personnelTable.id });
  personnelIds = personnel.map(({ id }) => id);
  const [fuelPrice] = await db
    .select({ id: fuelPricesTable.id })
    .from(fuelPricesTable)
    .where(eq(fuelPricesTable.tipoCombustible, "diesel"));
  if (!fuelPrice) {
    const [inserted] = await db
      .insert(fuelPricesTable)
      .values({ tipoCombustible: "diesel", precioPorLitro: 1 })
      .returning({ id: fuelPricesTable.id });
    insertedFuelPriceId = inserted!.id;
  }
  const warehouses = await db
    .insert(almacenesTable)
    .values([
      {
        codigo: `VJ-O-${suffix}`,
        odooPrefix: `VJ-O-${suffix}`,
        nombre: "Origen viaje",
        plaza: "QA",
      },
      {
        codigo: `VJ-D-${suffix}`,
        odooPrefix: `VJ-D-${suffix}`,
        nombre: "Destino viaje",
        plaza: "QA",
      },
    ])
    .returning({ id: almacenesTable.id });
  warehouseIds = warehouses.map(({ id }) => id);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine test API port");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (dispatchIds.length > 0) {
    await db.delete(dispatchesTable).where(inArray(dispatchesTable.id, dispatchIds));
    dispatchIds = [];
  }
  if (viajeIds.length > 0) {
    await db.delete(viajesTable).where(inArray(viajesTable.id, viajeIds));
    viajeIds = [];
  }
  if (trasladoIds.length > 0) {
    await db.delete(trasladosTable).where(inArray(trasladosTable.id, trasladoIds));
    trasladoIds = [];
  }
  if (deliveryIds.length > 0) {
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
    deliveryIds = [];
  }
  if (saleIds.length > 0) {
    await db.delete(salesTable).where(inArray(salesTable.id, saleIds));
    saleIds = [];
  }
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await db.delete(personnelTable).where(inArray(personnelTable.id, personnelIds));
  await db.delete(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds));
  await db.delete(almacenesTable).where(inArray(almacenesTable.id, warehouseIds));
  if (insertedFuelPriceId !== null) {
    await db.delete(fuelPricesTable).where(eq(fuelPricesTable.id, insertedFuelPriceId));
  }
});

describe.sequential("viajes compartidos", () => {
  it("rechaza solapamientos de vehículo y personas en roles cruzados, pero permite límites y recursos liberados", async () => {
    const occupied = await createSaleDispatch({
      vehicleId: vehicleIds[0],
      choferId: personnelIds[0],
      ayudanteId: personnelIds[2],
      salida: "2035-09-01T08:00:00.000Z",
      llegada: "2035-09-01T10:00:00.000Z",
    });
    const unchanged = await api(`/dispatches/${occupied.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fechaEstimadaSalida: occupied.fechaEstimadaSalida,
        fechaEstimadaLlegada: occupied.fechaEstimadaLlegada,
      }),
    });
    expect(unchanged.status).toBe(200);
    const vehicleSale = await createSale();
    const vehicleConflict = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: vehicleSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[1],
        fechaEstimadaSalida: "2035-09-01T09:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-01T11:00:00.000Z",
      }),
    });
    expect(vehicleConflict.status).toBe(409);
    expect(await vehicleConflict.json()).toMatchObject({
      error: "vehicle_schedule_conflict",
    });

    const personSale = await createSale();
    const personConflict = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: personSale.id,
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[2],
        fechaEstimadaSalida: "2035-09-01T09:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-01T11:00:00.000Z",
      }),
    });
    expect(personConflict.status).toBe(409);
    expect(await personConflict.json()).toMatchObject({
      error: "person_schedule_conflict",
    });

    const consecutiveSale = await createSale();
    const consecutive = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: consecutiveSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-09-01T10:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-01T12:00:00.000Z",
      }),
    });
    expect(consecutive.status).toBe(201);
    const consecutiveJson = await consecutive.json();
    dispatchIds.push(consecutiveJson.id);

    await db
      .update(dispatchesTable)
      .set({ estado: "entregado" })
      .where(inArray(dispatchesTable.id, [occupied.id, consecutiveJson.id]));
    const releasedSale = await createSale();
    const released = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: releasedSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-09-01T09:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-01T11:00:00.000Z",
      }),
    });
    expect(released.status).toBe(201);
    dispatchIds.push((await released.json()).id);
  });

  it("crea tres paradas idénticas como un solo viaje físico y se autoexcluye al editar", async () => {
    const members: Array<{ id: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      const sale = await createSale();
      const response = await api("/dispatches", {
        method: "POST",
        body: JSON.stringify({
          tipo: "venta",
          ventaId: sale.id,
          vehiculoId: vehicleIds[0],
          choferId: personnelIds[0],
          fechaEstimadaSalida: "2035-09-02T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-09-02T18:00:00.000Z",
        }),
      });
      expect(response.status).toBe(201);
      const dispatch = await response.json();
      dispatchIds.push(dispatch.id);
      members.push(dispatch);
    }
    const created = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-09-02",
      despachoIds: members.map(({ id }) => id),
    });
    expect(created.response.status).toBe(201);
    expect(created.json.despachos).toHaveLength(3);
    const noOp = await api(`/viajes/${created.json.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
      }),
    });
    expect(noOp.status).toBe(200);
  });

  it("valida conflictos al editar un viaje sin confundir sus propias paradas", async () => {
    await createSaleDispatch({
      vehicleId: vehicleIds[2],
      choferId: personnelIds[1],
      salida: "2035-09-03T08:00:00.000Z",
      llegada: "2035-09-03T18:00:00.000Z",
    });
    const member = await createSaleDispatch({
      vehicleId: vehicleIds[0],
      choferId: personnelIds[0],
      salida: "2035-09-03T09:00:00.000Z",
      llegada: "2035-09-03T17:00:00.000Z",
    });
    const created = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-09-03",
      despachoIds: [member.id],
    });
    expect(created.response.status).toBe(201);
    const conflict = await api(`/viajes/${created.json.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
      }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "vehicle_schedule_conflict",
    });
  });

  it("serializa solicitudes simultáneas para recursos y modalidades de una orden", async () => {
    const firstSale = await createSale();
    const secondSale = await createSale();
    const resourceBodies = [
      {
        tipo: "venta",
        ventaId: firstSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-09-10T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-10T11:00:00.000Z",
      },
      {
        tipo: "venta",
        ventaId: secondSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[1],
        fechaEstimadaSalida: "2035-09-10T09:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-10T12:00:00.000Z",
      },
    ];
    const resourceResponses = await Promise.all(
      resourceBodies.map((body) =>
        api("/dispatches", { method: "POST", body: JSON.stringify(body) }),
      ),
    );
    expect(resourceResponses.map(({ status }) => status).sort()).toEqual([201, 409]);
    for (const response of resourceResponses) {
      const body = await response.json();
      if (response.status === 201) dispatchIds.push(body.id);
    }

    const sharedSale = await createSale({ peso: 100, volumen: 1 });
    const loadResponses = await Promise.all([
      api("/dispatches", {
        method: "POST",
        body: JSON.stringify({
          tipo: "venta",
          ventaId: sharedSale.id,
          vehiculoId: vehicleIds[0],
          choferId: personnelIds[0],
          fechaEstimadaSalida: "2035-09-11T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-09-11T10:00:00.000Z",
        }),
      }),
      api("/dispatches", {
        method: "POST",
        body: JSON.stringify({
          tipo: "venta",
          ventaId: sharedSale.id,
          vehiculoId: vehicleIds[2],
          choferId: personnelIds[1],
          fechaEstimadaSalida: "2035-09-12T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-09-12T10:00:00.000Z",
          cargaParcial: true,
          pesoEstimadoKg: 50,
        }),
      }),
    ]);
    expect(loadResponses.map(({ status }) => status).sort()).toEqual([201, 409]);
    for (const response of loadResponses) {
      const body = await response.json();
      if (response.status === 201) dispatchIds.push(body.id);
      else expect(body.error).toBe("order_load_mode_conflict");
    }
  });

  it("crea un reparto completo en orden con costos y puntos dentro de una sola transacción", async () => {
    const sale = await createSale({ peso: 2_000, volumen: 20 });
    const response = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[0],
            choferId: personnelIds[0],
            fechaEstimadaSalida: "2035-10-01T08:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-01T10:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 1_000,
            routePoints: [{ ubicacion: "Primera parada", orden: 1 }],
          },
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[1],
            choferId: personnelIds[1],
            fechaEstimadaSalida: "2035-10-01T10:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-01T12:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 500,
            routePoints: [{ ubicacion: "Segunda parada", orden: 1 }],
          },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body.map((dispatch: { vehiculoId: number }) => dispatch.vehiculoId)).toEqual([
      vehicleIds[0],
      vehicleIds[1],
    ]);
    dispatchIds.push(...body.map((dispatch: { id: number }) => dispatch.id));
    const costs = await db
      .select()
      .from(travelCostsTable)
      .where(inArray(travelCostsTable.despachoId, dispatchIds));
    const points = await db
      .select()
      .from(routePointsTable)
      .where(inArray(routePointsTable.despachoId, dispatchIds));
    expect(costs).toHaveLength(2);
    expect(points.map(({ ubicacion }) => ubicacion).sort()).toEqual([
      "Primera parada",
      "Segunda parada",
    ]);
  });

  it("acepta repartir la misma venta con el mismo camión en ventanas consecutivas", async () => {
    const sale = await createSale({ peso: 800, volumen: 4 });
    const response = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[1],
            choferId: personnelIds[0],
            fechaEstimadaSalida: "2035-10-04T08:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-04T10:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 400,
            volumenEstimadoM3: 2,
          },
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[1],
            choferId: personnelIds[0],
            fechaEstimadaSalida: "2035-10-04T10:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-04T12:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 400,
            volumenEstimadoM3: 2,
          },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body).toEqual([
      expect.objectContaining({
        ventaId: sale.id,
        vehiculoId: vehicleIds[1],
        choferId: personnelIds[0],
        cargaParcial: true,
        pesoEstimadoKg: 400,
        volumenEstimadoM3: 2,
      }),
      expect.objectContaining({
        ventaId: sale.id,
        vehiculoId: vehicleIds[1],
        choferId: personnelIds[0],
        cargaParcial: true,
        pesoEstimadoKg: 400,
        volumenEstimadoM3: 2,
      }),
    ]);
    dispatchIds.push(...body.map((dispatch: { id: number }) => dispatch.id));
  });

  it("rechaza el solapamiento parcial del mismo camión y revierte el lote completo", async () => {
    const sale = await createSale({ peso: 800, volumen: 4 });
    const before = await db
      .select({ id: dispatchesTable.id })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.ventaId, sale.id));
    const response = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[1],
            choferId: personnelIds[0],
            fechaEstimadaSalida: "2035-10-05T08:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-05T10:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 400,
            volumenEstimadoM3: 2,
          },
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[1],
            choferId: personnelIds[0],
            fechaEstimadaSalida: "2035-10-05T09:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-05T11:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 400,
            volumenEstimadoM3: 2,
          },
        ],
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "vehicle_schedule_conflict",
      tramoIndex: 1,
    });
    const after = await db
      .select({ id: dispatchesTable.id })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.ventaId, sale.id));
    expect(before).toHaveLength(0);
    expect(after).toHaveLength(0);
  });

  it("revierte el lote completo e identifica el tramo inválido", async () => {
    const sale = await createSale({ peso: 2_000, volumen: 20 });
    const before = await db
      .select({ id: dispatchesTable.id })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.ventaId, sale.id));
    const response = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[0],
            choferId: personnelIds[0],
            fechaEstimadaSalida: "2035-10-02T08:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-02T10:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 1_000,
          },
          {
            tipo: "venta",
            ventaId: sale.id,
            vehiculoId: vehicleIds[1],
            choferId: personnelIds[1],
            fechaEstimadaSalida: "2035-10-02T10:00:00.000Z",
            fechaEstimadaLlegada: "2035-10-02T12:00:00.000Z",
            cargaParcial: true,
            pesoEstimadoKg: 501,
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "vehicle_capacity_exceeded",
      tramoIndex: 1,
    });
    const after = await db
      .select({ id: dispatchesTable.id })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.ventaId, sale.id));
    expect(after).toHaveLength(before.length);
  });

  it("rechaza reglas inválidas del lote antes de escribir", async () => {
    const firstSale = await createSale();
    const secondSale = await createSale();
    const base = {
      tipo: "venta",
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fechaEstimadaSalida: "2035-10-03T08:00:00.000Z",
      fechaEstimadaLlegada: "2035-10-03T10:00:00.000Z",
      cargaParcial: true,
      pesoEstimadoKg: 50,
    };
    const mixed = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          { ...base, ventaId: firstSale.id },
          { ...base, ventaId: secondSale.id, vehiculoId: vehicleIds[1] },
        ],
      }),
    });
    expect(mixed.status).toBe(400);
    expect(await mixed.json()).toMatchObject({
      error: "batch_mixed_orders",
      tramoIndex: 1,
    });

    const duplicate = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          { ...base, ventaId: firstSale.id },
          { ...base, ventaId: firstSale.id, choferId: personnelIds[1] },
        ],
      }),
    });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({
      error: "batch_duplicate_vehicle_window",
      tramoIndex: 1,
    });

    const complete = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [{ ...base, ventaId: firstSale.id, cargaParcial: false }],
      }),
    });
    expect(complete.status).toBe(400);
    expect(await complete.json()).toMatchObject({
      error: "batch_partial_load_required",
      tramoIndex: 0,
    });

    const missingQuota = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [{
          ...base,
          ventaId: firstSale.id,
          pesoEstimadoKg: null,
        }],
      }),
    });
    expect(missingQuota.status).toBe(400);
    expect(await missingQuota.json()).toMatchObject({
      error: "partial_cargo_quota_required",
      tramoIndex: 0,
    });

    const missingSale = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [{ ...base, ventaId: 2_000_000_000 }],
      }),
    });
    expect(missingSale.status).toBe(400);
    expect(await missingSale.json()).toMatchObject({
      error: "sale_not_found",
      tramoIndex: 0,
    });

    const malformedSecondLeg = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [
          { ...base, ventaId: firstSale.id },
          {
            ...base,
            ventaId: firstSale.id,
            vehiculoId: undefined,
            choferId: personnelIds[1],
          },
        ],
      }),
    });
    expect(malformedSecondLeg.status).toBe(400);
    expect(await malformedSecondLeg.json()).toMatchObject({
      error: "invalid_dispatch_batch",
      tramoIndex: 1,
    });
  });

  it("acepta tramos de traslado y devuelve el lote ordenado", async () => {
    const [delivery] = await db
      .insert(deliveriesTable)
      .values({
        ventaId: null,
        odooId: -1_600_000_000 - Math.floor(Math.random() * 100_000_000),
        tipo: "traslado",
        nombre: `QA/BATCH/${suffix}/${Math.random()}`,
        estado: "assigned",
      })
      .returning();
    deliveryIds.push(delivery!.id);
    const [traslado] = await db
      .insert(trasladosTable)
      .values({
        deliveryId: delivery!.id,
        odooPickingId: delivery!.odooId,
        almacenOrigenId: warehouseIds[0]!,
        almacenDestinoId: warehouseIds[1]!,
        pesoCalculadoKg: 200,
        volumenCalculadoM3: 2,
      })
      .returning();
    trasladoIds.push(traslado!.id);

    const response = await api("/dispatches/batch", {
      method: "POST",
      body: JSON.stringify({
        tramos: [{
          tipo: "traslado",
          trasladoId: traslado!.id,
          vehiculoId: vehicleIds[0],
          choferId: personnelIds[0],
          fechaEstimadaSalida: "2035-10-03T12:00:00.000Z",
          fechaEstimadaLlegada: "2035-10-03T14:00:00.000Z",
          cargaParcial: true,
          pesoEstimadoKg: 200,
        }],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject([{ tipo: "traslado", trasladoId: traslado!.id }]);
    dispatchIds.push(body[0].id);
  });

  it("serializa lotes competidores y no deja escrituras parciales", async () => {
    const firstSale = await createSale();
    const secondSale = await createSale();
    const makeBody = (ventaId: number, choferId: number) => ({
      tramos: [
        {
          tipo: "venta",
          ventaId,
          vehiculoId: vehicleIds[0],
          choferId,
          fechaEstimadaSalida: "2035-10-04T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-10-04T10:00:00.000Z",
          cargaParcial: true,
          pesoEstimadoKg: 50,
        },
        {
          tipo: "venta",
          ventaId,
          vehiculoId: vehicleIds[2],
          choferId,
          fechaEstimadaSalida: "2035-10-04T10:00:00.000Z",
          fechaEstimadaLlegada: "2035-10-04T12:00:00.000Z",
          cargaParcial: true,
          pesoEstimadoKg: 50,
        },
      ],
    });
    const responses = await Promise.all(
      [
        makeBody(firstSale.id, personnelIds[0]!),
        makeBody(secondSale.id, personnelIds[1]!),
      ].map((body) =>
        api("/dispatches/batch", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
    );
    for (const response of responses) {
      const body = await response.json();
      if (response.status === 201) {
        expect(body).toHaveLength(2);
        dispatchIds.push(...body.map((dispatch: { id: number }) => dispatch.id));
      } else {
        expect(body).toMatchObject({
          error: "vehicle_schedule_conflict",
          tramoIndex: 0,
        });
      }
    }
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
  });

  it("impide mezclar cargas parciales y completas y limpia cuotas heredadas", async () => {
    const partialSale = await createSale({ peso: 1_000, volumen: 10 });
    const partial = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: partialSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-09-04T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-04T10:00:00.000Z",
        cargaParcial: true,
        pesoEstimadoKg: 200,
        volumenEstimadoM3: 2,
      }),
    });
    expect(partial.status).toBe(201);
    const partialJson = await partial.json();
    dispatchIds.push(partialJson.id);
    const mixedComplete = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: partialSale.id,
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
        fechaEstimadaSalida: "2035-09-05T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-05T10:00:00.000Z",
      }),
    });
    expect(mixedComplete.status).toBe(409);
    expect(await mixedComplete.json()).toMatchObject({
      error: "order_load_mode_conflict",
    });

    const converted = await api(`/dispatches/${partialJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ cargaParcial: false }),
    });
    expect(converted.status).toBe(200);
    expect(await converted.json()).toMatchObject({
      cargaParcial: false,
      pesoEstimadoKg: null,
      volumenEstimadoM3: null,
    });

    const completeSale = await createSale({ peso: 100, volumen: 1 });
    const complete = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: completeSale.id,
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-09-06T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-06T10:00:00.000Z",
      }),
    });
    expect(complete.status).toBe(201);
    dispatchIds.push((await complete.json()).id);
    const mixedPartial = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: completeSale.id,
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
        fechaEstimadaSalida: "2035-09-07T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-07T10:00:00.000Z",
        cargaParcial: true,
        pesoEstimadoKg: 50,
      }),
    });
    expect(mixedPartial.status).toBe(409);
    expect(await mixedPartial.json()).toMatchObject({
      error: "order_load_mode_conflict",
    });

    const transfer = await createTransferDispatch();
    const mixedTransfer = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "traslado",
        trasladoId: transfer.trasladoId,
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
        fechaEstimadaSalida: "2035-09-09T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-09-09T10:00:00.000Z",
        cargaParcial: true,
        pesoEstimadoKg: 50,
      }),
    });
    expect(mixedTransfer.status).toBe(409);
    expect(await mixedTransfer.json()).toMatchObject({
      error: "order_load_mode_conflict",
    });

    const replacementSale = await createSale({ peso: 100, volumen: 1 });
    const replacementPartial = await createSaleDispatch({
      cargaParcial: true,
      pesoEstimadoKg: 25,
      volumenEstimadoM3: 1,
      salida: "2035-09-08T08:00:00.000Z",
      llegada: "2035-09-08T10:00:00.000Z",
    });
    await db
      .update(dispatchesTable)
      .set({ ventaId: replacementSale.id })
      .where(eq(dispatchesTable.id, replacementPartial.id));
    const replacement = await api(`/dispatches/${replacementPartial.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        cargaParcial: false,
        pesoEstimadoKg: 80,
      }),
    });
    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({
      cargaParcial: false,
      pesoEstimadoKg: 80,
      volumenEstimadoM3: null,
    });
  });

  it("calcula viáticos individuales por kilómetros y conserva días por compatibilidad", async () => {
    await db
      .update(personnelTable)
      .set({ tarifaPorKm: 2 })
      .where(eq(personnelTable.id, personnelIds[0]!));
    const response = await api("/dispatches/estimate-costs-preview", {
      method: "POST",
      body: JSON.stringify({
        vehiculoId: vehicleIds[0],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-08-01T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-08-03T08:00:00.000Z",
        distanciaKm: 100,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      costoViaticos: 200,
      distanciaKm: 100,
      dias: 2,
    });
  });

  it("expone el viático derivado una sola vez en el detalle, y null sin distancia", async () => {
    await db
      .update(personnelTable)
      .set({ tarifaPorKm: 2 })
      .where(eq(personnelTable.id, personnelIds[0]!));
    const member = await createSaleDispatch({});
    const created = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-09",
      despachoIds: [member.id],
    });
    expect(created.response.status).toBe(201);
    expect(created.json.costoViaticosEstimado).toBeNull();

    const patch = await api(`/viajes/${created.json.id}`, {
      method: "PATCH",
      body: JSON.stringify({ distanciaTotalKm: 100 }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).costoViaticosEstimado).toBe(200);

    const detail = await api(`/viajes/${created.json.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).costoViaticosEstimado).toBe(200);

    const list = await api("/viajes");
    const listItem = (await list.json()).find(
      (viaje: { id: number }) => viaje.id === created.json.id,
    );
    expect(listItem).not.toHaveProperty("costoViaticosEstimado");
  });

  it("aplica la migración dos veces y conserva el FK SET NULL y el índice", async () => {
    const client = await pool.connect();
    const schemaName = `viajes_mig_${process.pid}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE vehicles (id integer PRIMARY KEY);
        CREATE TABLE personnel (id integer PRIMARY KEY);
        CREATE TABLE dispatches (id serial PRIMARY KEY);
      `);
      await client.query(viajesMigrationSql);
      await client.query(viajesMigrationSql);
      await client.query(viajesOrderMigrationSql);
      await client.query(viajesOrderMigrationSql);
      const constraint = await client.query<{ confdeltype: string }>(`
        SELECT confdeltype
        FROM pg_constraint
        WHERE conrelid = 'dispatches'::regclass
          AND contype = 'f'
          AND confrelid = 'viajes'::regclass
      `);
      expect(constraint.rows).toEqual([{ confdeltype: "n" }]);
      const index = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'dispatches_viaje_id_idx'
      `);
      expect(index.rows[0]!.count).toBe(1);
      const uniqueOrder = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'dispatches_viaje_orden_unique'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
      `);
      expect(uniqueOrder.rows[0]!.count).toBe(1);
      await client.query("INSERT INTO vehicles VALUES (1)");
      await client.query("INSERT INTO personnel VALUES (1)");
      await client.query(`
        INSERT INTO viajes (vehiculo_id, chofer_id, fecha) VALUES (1, 1, '2035-08-01');
        INSERT INTO dispatches (viaje_id, orden) VALUES (1, 1);
        DELETE FROM viajes WHERE id = 1;
      `);
      const detached = await client.query("SELECT viaje_id, orden FROM dispatches");
      expect(detached.rows).toEqual([{ viaje_id: null, orden: 1 }]);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("crea un viaje mixto, ordena sus paradas y propaga cambios operativos", async () => {
    const saleDispatch = await createSaleDispatch({});
    const transferDispatch = await createTransferDispatch();
    const { response, json } = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      ayudanteId: personnelIds[2],
      fecha: "2035-08-10",
      despachoIds: [saleDispatch.id, transferDispatch.id],
      notas: "Viaje mixto",
    });
    expect(response.status).toBe(201);
    expect(GetViajeResponse.safeParse(json).success).toBe(true);
    expect(json.despachos.map((dispatch: { tipo: string }) => dispatch.tipo)).toEqual([
      "venta",
      "traslado",
    ]);
    expect(
      json.despachos.map((dispatch: { orden: number }) => dispatch.orden),
    ).toEqual([1, 2]);
    const patch = await api(`/viajes/${json.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
        ayudanteId: null,
      }),
    });
    expect(patch.status).toBe(200);
    const members = await db
      .select()
      .from(dispatchesTable)
      .where(inArray(dispatchesTable.id, [saleDispatch.id, transferDispatch.id]));
    expect(
      members.map(({ vehiculoId, choferId, ayudanteId }) => ({
        vehiculoId,
        choferId,
        ayudanteId,
      })),
    ).toEqual([
      {
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
        ayudanteId: null,
      },
      {
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
        ayudanteId: null,
      },
    ]);
    const filtered = await api("/viajes?estado=en_curso&fecha=2035-08-10");
    expect(filtered.status).toBe(200);
    expect((await filtered.json()).some((viaje: { id: number }) => viaje.id === json.id)).toBe(true);
  });

  it("rechaza duplicados y capacidad insuficiente sin dejar asignaciones parciales", async () => {
    const safeDispatch = await createSaleDispatch({ peso: 100, volumen: 1 });
    const heavyDispatch = await createSaleDispatch({ peso: 900, volumen: 2 });
    const looseDispatch = await createSaleDispatch({ peso: 100, volumen: 1 });
    const duplicate = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [safeDispatch.id, safeDispatch.id],
    });
    expect(duplicate.response.status).toBe(400);
    expect(duplicate.json.error).toBe("duplicate_dispatch");
    const capacity = await postViaje({
      vehiculoId: vehicleIds[1],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [safeDispatch.id, heavyDispatch.id],
    });
    expect(capacity.response.status).toBe(400);
    expect(capacity.json.error).toBe("vehicle_capacity_exceeded");
    const unchanged = await db
      .select({ viajeId: dispatchesTable.viajeId, orden: dispatchesTable.orden })
      .from(dispatchesTable)
      .where(inArray(dispatchesTable.id, [safeDispatch.id, heavyDispatch.id]));
    expect(unchanged).toEqual([
      { viajeId: null, orden: null },
      { viajeId: null, orden: null },
    ]);
    await db
      .update(dispatchesTable)
      .set({ estado: "cancelado" })
      .where(inArray(dispatchesTable.id, [heavyDispatch.id, looseDispatch.id]));
    const owner = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [safeDispatch.id],
    });
    expect(owner.response.status).toBe(201);
    const occupied = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [safeDispatch.id, looseDispatch.id],
    });
    expect(occupied.response.status).toBe(400);
    expect(occupied.json.error).toBe("dispatch_already_assigned");
    const [loose] = await db
      .select({ viajeId: dispatchesTable.viajeId, orden: dispatchesTable.orden })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, looseDispatch.id));
    expect(loose).toEqual({ viajeId: null, orden: null });
  });

  it("suma estimaciones por despacho, respeta Odoo y rechaza por volumen consolidado", async () => {
    const estimated = await createSaleDispatch({
      peso: null,
      volumen: null,
      pesoEstimadoKg: 100,
      volumenEstimadoM3: 5,
    });
    const odooWins = await createSaleDispatch({
      peso: 100,
      volumen: 1,
      pesoEstimadoKg: 10_000,
      volumenEstimadoM3: 100,
    });

    const rejected = await postViaje({
      vehiculoId: vehicleIds[1],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [estimated.id, odooWins.id],
    });
    expect(rejected.response.status).toBe(400);
    expect(rejected.json.error).toBe("vehicle_capacity_exceeded");

    const accepted = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [estimated.id, odooWins.id],
    });
    expect(accepted.response.status).toBe(201);
    expect(accepted.json).toMatchObject({
      pesoTotalKg: 200,
      volumenTotalM3: 6,
      pesoIncompleto: false,
      volumenIncompleto: false,
    });

    const detail = await api(`/dispatches/${estimated.id}`);
    expect(await detail.json()).toMatchObject({
      pesoTotal: 100,
      volumenTotal: 5,
      pesoOrigen: "estimado",
      volumenOrigen: "estimado",
      pesoEstimadoKg: 100,
      volumenEstimadoM3: 5,
    });
  });

  it("usa cuotas parciales al crear, editar y consolidar aunque Odoo tenga un total mayor", async () => {
    const [sale] = await db
      .insert(salesTable)
      .values({
        cliente: `Cliente parcial ${suffix}`,
        destino: "Destino QA",
        almacenOrigen: "Origen QA",
        odooRef: `PARCIAL-${suffix}-${Math.random()}`,
        pesoTotal: 2_000,
        volumenTotal: 20,
      })
      .returning();
    saleIds.push(sale!.id);

    const missingQuota = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: sale!.id,
        vehiculoId: vehicleIds[1],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-08-01T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-08-01T18:00:00.000Z",
        cargaParcial: true,
      }),
    });
    expect(missingQuota.status).toBe(400);
    expect(await missingQuota.json()).toMatchObject({
      error: "partial_cargo_quota_required",
    });

    const createdResponse = await api("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        tipo: "venta",
        ventaId: sale!.id,
        vehiculoId: vehicleIds[1],
        choferId: personnelIds[0],
        fechaEstimadaSalida: "2035-08-01T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-08-01T18:00:00.000Z",
        cargaParcial: true,
        pesoEstimadoKg: 200,
        volumenEstimadoM3: 2,
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    dispatchIds.push(created.id);
    expect(created).toMatchObject({ cargaParcial: true, pesoEstimadoKg: 200 });

    const second = await createSaleDispatch({
      peso: 4_000,
      volumen: 40,
      cargaParcial: true,
      pesoEstimadoKg: 250,
      volumenEstimadoM3: 2,
      vehicleId: vehicleIds[1],
    });
    const trip = await postViaje({
      vehiculoId: vehicleIds[1],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [created.id, second.id],
    });
    expect(trip.response.status).toBe(201);
    expect(trip.json).toMatchObject({
      pesoTotalKg: 450,
      volumenTotalM3: 4,
    });

    const invalidEdit = await api(`/dispatches/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ pesoEstimadoKg: null, volumenEstimadoM3: null }),
    });
    expect(invalidEdit.status).toBe(400);
    expect(await invalidEdit.json()).toMatchObject({
      error: "partial_cargo_quota_required",
    });

    const invalidDetach = await api(`/dispatches/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        viajeId: null,
        pesoEstimadoKg: null,
        volumenEstimadoM3: null,
      }),
    });
    expect(invalidDetach.status).toBe(400);
    expect(await invalidDetach.json()).toMatchObject({
      error: "partial_cargo_quota_required",
    });
    const [stillGrouped] = await db
      .select({ viajeId: dispatchesTable.viajeId })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, created.id));
    expect(stillGrouped!.viajeId).toBe(trip.json.id);

    const validEdit = await api(`/dispatches/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ pesoEstimadoKg: 240 }),
    });
    expect(validEdit.status).toBe(200);
    expect(await validEdit.json()).toMatchObject({
      cargaParcial: true,
      pesoEstimadoKg: 240,
    });
  });

  it("no guarda una estimación si la nueva carga rebasa el vehículo", async () => {
    const dispatch = await createSaleDispatch({
      peso: null,
      volumen: null,
      vehicleId: vehicleIds[1],
    });
    const response = await api(`/dispatches/${dispatch.id}`, {
      method: "PATCH",
      body: JSON.stringify({ volumenEstimadoM3: 6 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("vehicle_capacity_exceeded");

    const [stored] = await db
      .select({ volumenEstimadoM3: dispatchesTable.volumenEstimadoM3 })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, dispatch.id));
    expect(stored!.volumenEstimadoM3).toBeNull();
  });

  it("rechaza editar una estimación que rebasa la capacidad del viaje agrupado", async () => {
    const first = await createSaleDispatch({
      peso: null,
      volumen: null,
      pesoEstimadoKg: 100,
      volumenEstimadoM3: 3,
      vehicleId: vehicleIds[1],
    });
    const second = await createSaleDispatch({
      peso: 100,
      volumen: 1,
      vehicleId: vehicleIds[1],
    });
    const trip = await postViaje({
      vehiculoId: vehicleIds[1],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [first.id, second.id],
    });
    expect(trip.response.status).toBe(201);

    const response = await api(`/dispatches/${first.id}`, {
      method: "PATCH",
      body: JSON.stringify({ volumenEstimadoM3: 5 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("vehicle_capacity_exceeded");

    const [stored] = await db
      .select({ volumenEstimadoM3: dispatchesTable.volumenEstimadoM3 })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, first.id));
    expect(stored!.volumenEstimadoM3).toBe(3);
  });

  it("no permite que una unión simultánea omita la capacidad consolidada", async () => {
    const starter = await createSaleDispatch({
      peso: 100,
      volumen: 4,
      vehicleId: vehicleIds[1],
    });
    const joining = await createSaleDispatch({
      peso: null,
      volumen: null,
      pesoEstimadoKg: 100,
      volumenEstimadoM3: 1,
      vehicleId: vehicleIds[1],
      estado: "cancelado",
    });
    const trip = await postViaje({
      vehiculoId: vehicleIds[1],
      choferId: personnelIds[0],
      fecha: "2035-08-11",
      despachoIds: [starter.id],
    });
    expect(trip.response.status).toBe(201);

    const [joinResponse, estimateResponse] = await Promise.all([
      api(`/dispatches/${joining.id}`, {
        method: "PATCH",
        body: JSON.stringify({ viajeId: trip.json.id }),
      }),
      api(`/dispatches/${joining.id}`, {
        method: "PATCH",
        body: JSON.stringify({ volumenEstimadoM3: 2 }),
      }),
    ]);
    expect([joinResponse.status, estimateResponse.status]).not.toEqual([200, 200]);
    expect([joinResponse.status, estimateResponse.status].some((status) => status === 200)).toBe(true);

    const [stored] = await db
      .select({
        viajeId: dispatchesTable.viajeId,
        volumenEstimadoM3: dispatchesTable.volumenEstimadoM3,
      })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, joining.id));
    if (stored!.viajeId === trip.json.id) {
      expect(stored!.volumenEstimadoM3).toBe(1);
    } else {
      expect(stored!.viajeId).toBeNull();
      expect(stored!.volumenEstimadoM3).toBe(2);
    }
  });

  it("mantiene los cuatro estados derivados y rechaza escribir estado a mano", async () => {
    expect(deriveViajeEstado([])).toBe("planificado");
    expect(deriveViajeEstado(["cancelado", "cancelado"])).toBe("cancelado");
    expect(deriveViajeEstado(["entregado", "cancelado"])).toBe("completado");
    expect(deriveViajeEstado(["entregado", "en-ruta"])).toBe("en_curso");
    const [empty] = await db
      .insert(viajesTable)
      .values({
        vehiculoId: vehicleIds[0]!,
        choferId: personnelIds[0]!,
        fecha: "2035-08-12",
      })
      .returning();
    viajeIds.push(empty!.id);
    await syncViajeEstadoFromDispatch(empty!.id);
    expect(
      (await db.select().from(viajesTable).where(eq(viajesTable.id, empty!.id)))[0]!.estado,
    ).toBe("planificado");
    const cancelled = await createSaleDispatch({ estado: "cancelado" });
    const cancelledViaje = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-12",
      despachoIds: [cancelled.id],
      estado: "completado",
    });
    expect(cancelledViaje.response.status).toBe(400);
    expect(cancelledViaje.json.error).toBe("derived_state_readonly");
    const created = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-12",
      despachoIds: [cancelled.id],
    });
    expect(created.json.estado).toBe("cancelado");
    const manual = await api(`/viajes/${created.json.id}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: "completado" }),
    });
    expect(manual.status).toBe(400);
    expect((await manual.json()).error).toBe("derived_state_readonly");
  });

  it("entrega una venta solo cuando todos sus despachos activos están entregados", async () => {
    expect(deriveSaleEstado([])).toBe("pendiente");
    expect(deriveSaleEstado(["cancelado"])).toBe("pendiente");
    expect(deriveSaleEstado(["entregado"])).toBe("entregado");
    expect(deriveSaleEstado(["entregado", "cancelado"])).toBe("entregado");
    expect(deriveSaleEstado(["entregado", "en-ruta"])).toBe("despachado");

    const first = await createSaleDispatch({ estado: "entregado" });
    const [second] = await db
      .insert(dispatchesTable)
      .values({
        ...first,
        id: undefined,
        estado: "en-ruta",
        viajeId: null,
        orden: null,
        createdAt: undefined,
      })
      .returning();
    dispatchIds.push(second!.id);

    await syncSaleEstadoFromDispatch(first.ventaId!);
    let [sale] = await db
      .select({ estado: salesTable.estado })
      .from(salesTable)
      .where(eq(salesTable.id, first.ventaId!));
    expect(sale!.estado).toBe("despachado");

    await db
      .update(dispatchesTable)
      .set({ estado: "entregado" })
      .where(eq(dispatchesTable.id, second!.id));
    await syncSaleEstadoFromDispatch(first.ventaId!);
    [sale] = await db
      .select({ estado: salesTable.estado })
      .from(salesTable)
      .where(eq(salesTable.id, first.ventaId!));
    expect(sale!.estado).toBe("entregado");

    await db
      .update(salesTable)
      .set({ estado: "pendiente" })
      .where(eq(salesTable.id, first.ventaId!));
    expect(await reconcileSaleEstados()).toBeGreaterThanOrEqual(1);
    [sale] = await db
      .select({ estado: salesTable.estado })
      .from(salesTable)
      .where(eq(salesTable.id, first.ventaId!));
    expect(sale!.estado).toBe("entregado");
  });

  it("recalcula ambos viajes al mover y retirar una parada", async () => {
    const delivered = await createSaleDispatch({ estado: "entregado" });
    const cancelled = await createSaleDispatch({ estado: "cancelado" });
    const first = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-13",
      despachoIds: [delivered.id],
    });
    const second = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-13",
      despachoIds: [cancelled.id],
    });
    expect(first.json.estado).toBe("completado");
    expect(second.json.estado).toBe("cancelado");
    const moved = await api(`/dispatches/${delivered.id}`, {
      method: "PATCH",
      body: JSON.stringify({ viajeId: second.json.id }),
    });
    expect(moved.status).toBe(200);
    expect(UpdateDispatchResponse.safeParse(await moved.json()).success).toBe(true);
    const afterMove = await db
      .select({ id: viajesTable.id, estado: viajesTable.estado })
      .from(viajesTable)
      .where(inArray(viajesTable.id, [first.json.id, second.json.id]));
    expect(afterMove).toContainEqual({ id: first.json.id, estado: "planificado" });
    expect(afterMove).toContainEqual({ id: second.json.id, estado: "completado" });
    const detached = await api(`/dispatches/${delivered.id}`, {
      method: "PATCH",
      body: JSON.stringify({ viajeId: null }),
    });
    expect(detached.status).toBe(200);
    expect(await detached.json()).toMatchObject({ viajeId: null, orden: null });
    const secondAfterDetach = await db
      .select({ estado: viajesTable.estado })
      .from(viajesTable)
      .where(eq(viajesTable.id, second.json.id));
    expect(secondAfterDetach[0]!.estado).toBe("cancelado");
    const detail = await api(`/dispatches/${delivered.id}`);
    expect(detail.status).toBe(200);
    expect(GetDispatchResponse.safeParse(await detail.json()).success).toBe(true);
  });

  it("asigna órdenes únicas cuando dos paradas se agregan al mismo tiempo", async () => {
    const first = await createSaleDispatch({ estado: "cancelado" });
    const second = await createSaleDispatch({ estado: "cancelado" });
    const starter = await createSaleDispatch({ estado: "cancelado" });
    const viaje = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-14",
      despachoIds: [starter.id],
    });
    const responses = await Promise.all([
      api(`/dispatches/${first.id}`, {
        method: "PATCH",
        body: JSON.stringify({ viajeId: viaje.json.id }),
      }),
      api(`/dispatches/${second.id}`, {
        method: "PATCH",
        body: JSON.stringify({ viajeId: viaje.json.id }),
      }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const stops = await db
      .select({ id: dispatchesTable.id, orden: dispatchesTable.orden })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.viajeId, viaje.json.id))
      .orderBy(dispatchesTable.orden);
    expect(stops.map(({ orden }) => orden)).toEqual([1, 2, 3]);
    expect(new Set(stops.map(({ orden }) => orden)).size).toBe(3);
  });

  it("mantiene las asignaciones alineadas si el viaje y una parada cambian a la vez", async () => {
    const starter = await createSaleDispatch({ estado: "pre-despacho" });
    const joining = await createSaleDispatch({ estado: "cancelado" });
    const viaje = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-15",
      despachoIds: [starter.id],
    });
    const responses = await Promise.all([
      api(`/viajes/${viaje.json.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          vehiculoId: vehicleIds[2],
          choferId: personnelIds[1],
        }),
      }),
      api(`/dispatches/${joining.id}`, {
        method: "PATCH",
        body: JSON.stringify({ viajeId: viaje.json.id }),
      }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const members = await db
      .select({
        vehiculoId: dispatchesTable.vehiculoId,
        choferId: dispatchesTable.choferId,
      })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.viajeId, viaje.json.id));
    expect(members).toHaveLength(2);
    expect(
      members.every(
        ({ vehiculoId, choferId }) =>
          vehiculoId === vehicleIds[2] && choferId === personnelIds[1],
      ),
    ).toBe(true);
  });

  it("protege un viajeId aparentemente sin cambios frente a una reasignación simultánea", async () => {
    const moving = await createSaleDispatch({ estado: "pre-despacho" });
    const otherStarter = await createSaleDispatch({ estado: "cancelado" });
    const first = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      fecha: "2035-08-16",
      despachoIds: [moving.id],
    });
    const second = await postViaje({
      vehiculoId: vehicleIds[2],
      choferId: personnelIds[1],
      fecha: "2035-08-16",
      despachoIds: [otherStarter.id],
    });
    const responses = await Promise.all([
      api(`/dispatches/${moving.id}`, {
        method: "PATCH",
        body: JSON.stringify({ viajeId: first.json.id }),
      }),
      api(`/dispatches/${moving.id}`, {
        method: "PATCH",
        body: JSON.stringify({ viajeId: second.json.id }),
      }),
    ]);
    expect(responses.every(({ status }) => status === 200 || status === 409)).toBe(true);
    expect(responses.some(({ status }) => status === 200)).toBe(true);
    const [dispatch] = await db
      .select()
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, moving.id));
    const [owner] = await db
      .select()
      .from(viajesTable)
      .where(eq(viajesTable.id, dispatch!.viajeId!));
    expect(dispatch).toMatchObject({
      vehiculoId: owner!.vehiculoId,
      choferId: owner!.choferId,
      ayudanteId: owner!.ayudanteId,
    });
    expect(dispatch!.orden).not.toBeNull();
    const tripStates = await db
      .select({ id: viajesTable.id, estado: viajesTable.estado })
      .from(viajesTable)
      .where(inArray(viajesTable.id, [first.json.id, second.json.id]));
    if (dispatch!.viajeId === first.json.id) {
      expect(tripStates).toContainEqual({ id: first.json.id, estado: "en_curso" });
      expect(tripStates).toContainEqual({ id: second.json.id, estado: "cancelado" });
    } else {
      expect(tripStates).toContainEqual({ id: first.json.id, estado: "planificado" });
      expect(tripStates).toContainEqual({ id: second.json.id, estado: "en_curso" });
    }
  });

  it("impide desalinear las asignaciones de un despacho que pertenece a un viaje", async () => {
    const member = await createSaleDispatch({ estado: "pre-despacho" });
    const viaje = await postViaje({
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      ayudanteId: personnelIds[2],
      fecha: "2035-08-17",
      despachoIds: [member.id],
    });
    expect(viaje.response.status).toBe(201);
    const response = await api(`/dispatches/${member.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        vehiculoId: vehicleIds[2],
        choferId: personnelIds[1],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "dispatch_assignments_owned_by_viaje",
    });
    const [dispatch] = await db
      .select()
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, member.id));
    expect(dispatch).toMatchObject({
      viajeId: viaje.json.id,
      vehiculoId: vehicleIds[0],
      choferId: personnelIds[0],
      ayudanteId: personnelIds[2],
      orden: 1,
    });
  });
});