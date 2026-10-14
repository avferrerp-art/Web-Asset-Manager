import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  actasLlegadaTable,
  almacenesTable,
  db,
  deliveriesTable,
  dispatchesTable,
  personnelAlmacenesTable,
  personnelTable,
  runMigrations,
  salesTable,
  trasladosTable,
  vehiclesTable,
  type Personnel,
} from "@workspace/db";
import type { CurrentPersonResult } from "../../artifacts/api-server/src/services/currentPerson";
import { logger } from "../../artifacts/api-server/src/lib/logger";

const currentPersonMock = vi.hoisted(() => ({
  result: null as CurrentPersonResult | null,
}));

vi.mock("../../artifacts/api-server/src/services/currentPerson", () => ({
  resolveCurrentPerson: async () => currentPersonMock.result,
}));

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
const negativeOdooId = -1_600_000_000 + Math.floor(Math.random() * 100_000);

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let warehouseIds: number[] = [];
let deliveryIds: number[] = [];
let trasladoIds: number[] = [];
let dispatchIds: number[] = [];
let personnelIds: number[] = [];
let vehicleId: number;
let saleId: number;
let almacenista: Personnel;
let almacenistaSinAsignar: Personnel;
let oficina: Personnel;
let chofer: Personnel;
let ayudante: Personnel;
let adminAlmacenista: Personnel;

function auth(): Record<string, string> {
  return {
    "x-test-auth": "authenticated",
    "Content-Type": "application/json",
  };
}

function asCurrentPerson(person: Personnel): void {
  currentPersonMock.result = { ok: true, person };
}

async function setAssignments(personnelId: number, almacenIds: number[]) {
  await db
    .delete(personnelAlmacenesTable)
    .where(eq(personnelAlmacenesTable.personnelId, personnelId));
  if (almacenIds.length > 0) {
    await db.insert(personnelAlmacenesTable).values(
      almacenIds.map((almacenId) => ({ personnelId, almacenId })),
    );
  }
}

async function listedTransferIds(): Promise<number[]> {
  const response = await fetch(`${baseUrl}/api/traslados`, { headers: auth() });
  expect(response.status).toBe(200);
  const rows = (await response.json()) as Array<{ id: number }>;
  return rows
    .map((row) => row.id)
    .filter((id) => trasladoIds.includes(id))
    .sort((left, right) => left - right);
}

beforeAll(async () => {
  await runMigrations();

  warehouseIds = (
    await db
      .insert(almacenesTable)
      .values([
        {
          codigo: `ACC-A-${suffix}`,
          odooPrefix: `ACC-A-${suffix}`,
          nombre: "Almacén acceso A",
          plaza: "Plaza A",
        },
        {
          codigo: `ACC-B-${suffix}`,
          odooPrefix: `ACC-B-${suffix}`,
          nombre: "Almacén acceso B",
          plaza: "Plaza B",
        },
        {
          codigo: `ACC-C-${suffix}`,
          odooPrefix: `ACC-C-${suffix}`,
          nombre: "Almacén acceso C",
          plaza: "Plaza C",
        },
      ])
      .returning({ id: almacenesTable.id })
  ).map((row) => row.id);

  const people = await db
    .insert(personnelTable)
    .values([
      {
        nombre: `Almacenista ${suffix}`,
        rol: "almacenista",
        tarifaPorKm: 0,
        email: `almacenista-${suffix}@test.invalid`,
      },
      {
        nombre: `Almacenista sin asignar ${suffix}`,
        rol: "almacenista",
        tarifaPorKm: 0,
        email: `sin-asignar-${suffix}@test.invalid`,
      },
      {
        nombre: `Oficina ${suffix}`,
        rol: "oficina",
        tarifaPorKm: 0,
        email: `oficina-${suffix}@test.invalid`,
      },
      {
        nombre: `Chofer ${suffix}`,
        rol: "chofer",
        tarifaPorKm: 0,
        email: `chofer-${suffix}@test.invalid`,
      },
      {
        nombre: `Ayudante ${suffix}`,
        rol: "ayudante",
        tarifaPorKm: 0,
        email: `ayudante-${suffix}@test.invalid`,
      },
      {
        nombre: `Admin almacenista ${suffix}`,
        rol: "almacenista",
        tarifaPorKm: 0,
        email: `ADMIN-${suffix}@test.invalid`,
      },
    ])
    .returning();
  [
    almacenista,
    almacenistaSinAsignar,
    oficina,
    chofer,
    ayudante,
    adminAlmacenista,
  ] = people;
  personnelIds = people.map((person) => person.id);

  await setAssignments(almacenista.id, [warehouseIds[0]!]);
  await setAssignments(adminAlmacenista.id, [warehouseIds[0]!]);

  deliveryIds = (
    await db
      .insert(deliveriesTable)
      .values([
        {
          ventaId: null,
          odooId: negativeOdooId,
          tipo: "traslado",
          nombre: `QA/ACCESS/A-B-${suffix}`,
          estado: "assigned",
        },
        {
          ventaId: null,
          odooId: negativeOdooId - 1,
          tipo: "traslado",
          nombre: `QA/ACCESS/B-C-${suffix}`,
          estado: "assigned",
        },
        {
          ventaId: null,
          odooId: negativeOdooId - 2,
          tipo: "traslado",
          nombre: `QA/ACCESS/C-C-${suffix}`,
          estado: "assigned",
        },
      ])
      .returning({ id: deliveriesTable.id })
  ).map((row) => row.id);

  trasladoIds = (
    await db
      .insert(trasladosTable)
      .values([
        {
          deliveryId: deliveryIds[0],
          odooPickingId: negativeOdooId,
          almacenOrigenId: warehouseIds[0],
          almacenDestinoId: warehouseIds[1],
        },
        {
          deliveryId: deliveryIds[1],
          odooPickingId: negativeOdooId - 1,
          almacenOrigenId: warehouseIds[1],
          almacenDestinoId: warehouseIds[2],
        },
        {
          deliveryId: deliveryIds[2],
          odooPickingId: negativeOdooId - 2,
          almacenOrigenId: warehouseIds[2],
          almacenDestinoId: warehouseIds[2],
        },
      ])
      .returning({ id: trasladosTable.id })
  ).map((row) => row.id);

  [vehicleId] = (
    await db
      .insert(vehiclesTable)
      .values({
        tipo: "camion",
        modelo: `Vehículo acceso ${suffix}`,
        capacidadPeso: 1_000,
        capacidadVolumen: 10,
        tipoCombustible: "diesel",
        rendimientoKmLitro: 8,
      })
      .returning({ id: vehiclesTable.id })
  ).map((row) => row.id);
  [saleId] = (
    await db
      .insert(salesTable)
      .values({
        cliente: `Cliente acceso ${suffix}`,
        destino: "Destino acceso",
        almacenOrigen: "Origen acceso",
        odooRef: `SALE-ACCESS-${suffix}`,
      })
      .returning({ id: salesTable.id })
  ).map((row) => row.id);

  dispatchIds = (
    await db
      .insert(dispatchesTable)
      .values([
        {
          tipo: "traslado",
          ventaId: null,
          trasladoId: trasladoIds[0],
          vehiculoId: vehicleId,
          choferId: chofer.id,
          fechaEstimadaSalida: "2035-06-01T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-06-01T18:00:00.000Z",
          estado: "entregado",
        },
        {
          tipo: "venta",
          ventaId: saleId,
          trasladoId: null,
          vehiculoId: vehicleId,
          choferId: chofer.id,
          fechaEstimadaSalida: "2035-06-02T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-06-02T18:00:00.000Z",
          estado: "entregado",
        },
      ])
      .returning({ id: dispatchesTable.id })
  ).map((row) => row.id);
  await db.insert(actasLlegadaTable).values(
    dispatchIds.map((despachoId) => ({
      despachoId,
      fechaLlegada: new Date("2035-06-01T17:00:00.000Z"),
      registradaPorId: null,
    })),
  );

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

afterEach(() => {
  currentPersonMock.result = null;
  delete process.env.ADMIN_EMAILS;
});

afterAll(async () => {
  delete process.env.ADMIN_EMAILS;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (dispatchIds.length > 0) {
    await db
      .delete(actasLlegadaTable)
      .where(inArray(actasLlegadaTable.despachoId, dispatchIds));
    await db
      .delete(dispatchesTable)
      .where(inArray(dispatchesTable.id, dispatchIds));
  }
  if (trasladoIds.length > 0) {
    await db.delete(trasladosTable).where(inArray(trasladosTable.id, trasladoIds));
  }
  if (deliveryIds.length > 0) {
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
  }
  if (saleId) {
    await db.delete(salesTable).where(eq(salesTable.id, saleId));
  }
  if (personnelIds.length > 0) {
    await db
      .delete(personnelAlmacenesTable)
      .where(inArray(personnelAlmacenesTable.personnelId, personnelIds));
    await db.delete(personnelTable).where(inArray(personnelTable.id, personnelIds));
  }
  if (vehicleId) {
    await db.delete(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  }
  if (warehouseIds.length > 0) {
    await db.delete(almacenesTable).where(inArray(almacenesTable.id, warehouseIds));
  }
});

describe("warehouse access for transfers", () => {
  it("limits a single assigned warehouse and denies detail and writes outside its scope", async () => {
    asCurrentPerson(almacenista);
    expect(await listedTransferIds()).toEqual([trasladoIds[0]]);

    const missingDetail = await fetch(`${baseUrl}/api/traslados/2147483647`, {
      headers: auth(),
    });
    expect(missingDetail.status).toBe(404);
    expect(await missingDetail.json()).toEqual({ error: "Traslado no encontrado" });

    const missingUpdate = await fetch(`${baseUrl}/api/traslados/2147483647`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ notas: "No existe" }),
    });
    expect(missingUpdate.status).toBe(404);
    expect(await missingUpdate.json()).toEqual({ error: "Traslado no encontrado" });

    const detail = await fetch(`${baseUrl}/api/traslados/${trasladoIds[1]}`, {
      headers: auth(),
    });
    expect(detail.status).toBe(403);
    expect(await detail.json()).toEqual({ error: "almacen_no_autorizado" });

    const update = await fetch(`${baseUrl}/api/traslados/${trasladoIds[2]}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ notas: "No debe guardarse" }),
    });
    expect(update.status).toBe(403);
    expect(await update.json()).toEqual({ error: "almacen_no_autorizado" });
    const [unchanged] = await db
      .select({ notas: trasladosTable.notas })
      .from(trasladosTable)
      .where(eq(trasladosTable.id, trasladoIds[2]!));
    expect(unchanged!.notas).toBeNull();
  });

  it("includes transfers touching any of multiple assigned warehouses", async () => {
    await setAssignments(almacenista.id, [warehouseIds[0]!, warehouseIds[1]!]);
    asCurrentPerson(almacenista);
    expect(await listedTransferIds()).toEqual([trasladoIds[0], trasladoIds[1]]);
  });

  it("preserves full access for unlinked, office, driver, and assistant accounts", async () => {
    currentPersonMock.result = {
      ok: false,
      reason: "not_linked",
      email: `web-${suffix}@test.invalid`,
    };
    expect(await listedTransferIds()).toEqual([...trasladoIds].sort((a, b) => a - b));

    currentPersonMock.result = { ok: false, reason: "no_email" };
    expect(await listedTransferIds()).toEqual([...trasladoIds].sort((a, b) => a - b));

    for (const person of [oficina, chofer, ayudante]) {
      asCurrentPerson(person);
      expect(await listedTransferIds()).toEqual(
        [...trasladoIds].sort((a, b) => a - b),
      );
    }
  });

  it("keeps an unassigned warehouse operator unblocked and emits an operational warning", async () => {
    const warning = vi.spyOn(logger, "warn");
    asCurrentPerson(almacenistaSinAsignar);

    expect(await listedTransferIds()).toEqual([...trasladoIds].sort((a, b) => a - b));
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ personnelId: almacenistaSinAsignar.id }),
      expect.stringContaining("sin almacenes asignados"),
    );
    warning.mockRestore();
  });

  it("applies ADMIN_EMAILS case-insensitively before limiting an assigned warehouse operator", async () => {
    process.env.ADMIN_EMAILS = `other@test.invalid, admin-${suffix}@TEST.INVALID`;
    asCurrentPerson(adminAlmacenista);
    expect(await listedTransferIds()).toEqual([...trasladoIds].sort((a, b) => a - b));
  });
});

describe("warehouse access for arrival confirmation", () => {
  it("only lets a transfer arrival be confirmed from its destination warehouse", async () => {
    await setAssignments(almacenista.id, [warehouseIds[0]!]);
    asCurrentPerson(almacenista);
    const denied = await fetch(`${baseUrl}/api/dispatches/${dispatchIds[0]}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ recibidoPor: "Origen no autorizado" }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "almacen_no_autorizado" });

    const [unconfirmed] = await db
      .select({ confirmadaAt: actasLlegadaTable.confirmadaAt })
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, dispatchIds[0]!));
    expect(unconfirmed!.confirmadaAt).toBeNull();

    await setAssignments(almacenista.id, [warehouseIds[1]!]);
    const confirmed = await fetch(`${baseUrl}/api/dispatches/${dispatchIds[0]}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ recibidoPor: "Destino autorizado" }),
    });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).recibidoPor).toBe("Destino autorizado");
  });

  it("does not restrict sale dispatch arrival confirmations", async () => {
    await setAssignments(almacenista.id, [warehouseIds[0]!]);
    asCurrentPerson(almacenista);
    const response = await fetch(`${baseUrl}/api/dispatches/${dispatchIds[1]}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ recibidoPor: "Recepción de venta" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).recibidoPor).toBe("Recepción de venta");
  });
});