import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  almacenesTable,
  db,
  deliveriesTable,
  dispatchesTable,
  personnelTable,
  pool,
  runMigrations,
  salesTable,
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

async function createSaleDispatch(options: {
  peso?: number | null;
  volumen?: number | null;
  estado?: string;
  vehicleId?: number;
}) {
  const [sale] = await db
    .insert(salesTable)
    .values({
      cliente: `Cliente viaje ${suffix}`,
      destino: "Destino QA",
      almacenOrigen: "Origen QA",
      odooRef: `VIAJE-SALE-${suffix}-${Math.random()}`,
      pesoTotal: options.peso ?? 100,
      volumenTotal: options.volumen ?? 1,
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
      choferId: personnelIds[0]!,
      fechaEstimadaSalida: "2035-08-01T08:00:00.000Z",
      fechaEstimadaLlegada: "2035-08-01T18:00:00.000Z",
      estado: options.estado ?? "pre-despacho",
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
      { nombre: `Chofer A ${suffix}`, rol: "chofer", tarifaViaticos: 0 },
      { nombre: `Chofer B ${suffix}`, rol: "chofer", tarifaViaticos: 0 },
      { nombre: `Ayudante ${suffix}`, rol: "ayudante", tarifaViaticos: 0 },
    ])
    .returning({ id: personnelTable.id });
  personnelIds = personnel.map(({ id }) => id);
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
});

describe.sequential("viajes compartidos", () => {
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
    const first = await createSaleDispatch({ estado: "pre-despacho" });
    const second = await createSaleDispatch({ estado: "pre-despacho" });
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
    const joining = await createSaleDispatch({ estado: "pre-despacho" });
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