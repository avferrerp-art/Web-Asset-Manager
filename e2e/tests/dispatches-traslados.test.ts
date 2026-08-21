import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  actasLlegadaTable,
  almacenesTable,
  db,
  deliveriesTable,
  deliveryItemsTable,
  dispatchesTable,
  personnelTable,
  pool,
  runMigrations,
  salesTable,
  trasladosTable,
  vehiclesTable,
} from "@workspace/db";
import {
  GetTrasladoResponse,
  ListTrasladosResponseItem,
  RegisterDispatchActaResponse,
  UpdateTrasladoBody,
} from "../../lib/api-zod/src/generated/api";
import { sql as dispatchesMigrationSql } from "../../lib/db/src/migrations/0010_dispatches_polimorficos";
import { sql as actasMigrationSql } from "../../lib/db/src/migrations/0011_actas_llegada";
import {
  buildDispatchDetail,
  buildDispatchRow,
  exceedsDispatchCapacity,
} from "../../artifacts/api-server/src/routes/dispatches";
import {
  getTraslado,
  getTrasladoSummary,
  TrasladoPesoOdooReadonlyError,
  updateTrasladoLocalFields,
} from "../../artifacts/api-server/src/services/trasladoQueries";
import {
  confirmarRecepcion,
  registrarLlegada,
} from "../../artifacts/api-server/src/services/actasLlegada";
import {
  deriveTrasladoEstadoFromDispatch,
  reconcileTrasladoEstados,
  syncTrasladoEstadoFromDispatch,
} from "../../artifacts/api-server/src/services/trasladoEstadoSync";

const suffix = `${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;
const negativeOdooId = -1_700_000_000 + Math.floor(Math.random() * 100_000);

let warehouseIds: number[] = [];
let deliveryIds: number[] = [];
let trasladoIds: number[] = [];
let dispatchIds: number[] = [];
let saleId: number | null = null;
let vehicleId: number | null = null;
let driverId: number | null = null;

beforeAll(async () => {
  await runMigrations();
  await pool.query(dispatchesMigrationSql);
  await pool.query(dispatchesMigrationSql);

  warehouseIds = (
    await db
      .insert(almacenesTable)
      .values([
        {
          codigo: `DSP-O-${suffix}`,
          odooPrefix: `DSP-O-${suffix}`,
          nombre: "Origen despacho traslado",
          plaza: "QA origen",
        },
        {
          codigo: `DSP-D-${suffix}`,
          odooPrefix: `DSP-D-${suffix}`,
          nombre: "Destino despacho traslado",
          plaza: "QA destino",
        },
      ])
      .returning({ id: almacenesTable.id })
  ).map((row) => row.id);

  [saleId] = (
    await db
      .insert(salesTable)
      .values({
        cliente: "Cliente despacho polimórfico",
        destino: "Destino venta QA",
        almacenOrigen: "Origen venta QA",
        odooRef: `SALE-DSP-${suffix}`,
        pesoTotal: 800,
        volumenTotal: 5,
      })
      .returning({ id: salesTable.id })
  ).map((row) => row.id);

  [vehicleId] = (
    await db
      .insert(vehiclesTable)
      .values({
        tipo: "camion",
        modelo: `Vehículo despacho ${suffix}`,
        capacidadPeso: 1_000,
        capacidadVolumen: 10,
        tipoCombustible: "diesel",
        rendimientoKmLitro: 8,
      })
      .returning({ id: vehiclesTable.id })
  ).map((row) => row.id);

  [driverId] = (
    await db
      .insert(personnelTable)
      .values({
        nombre: `Chofer despacho ${suffix}`,
        rol: "chofer",
        tarifaViaticos: 0,
      })
      .returning({ id: personnelTable.id })
  ).map((row) => row.id);

  deliveryIds = (
    await db
      .insert(deliveriesTable)
      .values([
        {
          ventaId: null,
          odooId: negativeOdooId,
          tipo: "traslado",
          nombre: `QA/INT/ESTIMADO-${suffix}`,
          estado: "assigned",
        },
        {
          ventaId: null,
          odooId: negativeOdooId - 1,
          tipo: "traslado",
          nombre: `QA/INT/ODOO-${suffix}`,
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
          pesoCalculadoKg: null,
          volumenCalculadoM3: null,
        },
        {
          deliveryId: deliveryIds[1],
          odooPickingId: negativeOdooId - 1,
          almacenOrigenId: warehouseIds[1],
          almacenDestinoId: warehouseIds[0],
          pesoCalculadoKg: 425,
          pesoEstimadoKg: 999,
          volumenCalculadoM3: 2,
        },
      ])
      .returning({ id: trasladosTable.id })
  ).map((row) => row.id);

  dispatchIds = (
    await db
      .insert(dispatchesTable)
      .values([
        {
          tipo: "venta",
          ventaId: saleId,
          trasladoId: null,
          vehiculoId: vehicleId,
          choferId: driverId,
          fechaEstimadaSalida: "2035-01-01T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-01-01T18:00:00.000Z",
        },
        {
          tipo: "traslado",
          ventaId: null,
          trasladoId: trasladoIds[0],
          vehiculoId: vehicleId,
          choferId: driverId,
          fechaEstimadaSalida: "2035-01-02T08:00:00.000Z",
          fechaEstimadaLlegada: "2035-01-02T18:00:00.000Z",
        },
      ])
      .returning({ id: dispatchesTable.id })
  ).map((row) => row.id);
});

afterAll(async () => {
  if (dispatchIds.length > 0) {
    await db.delete(dispatchesTable).where(inArray(dispatchesTable.id, dispatchIds));
  }
  if (trasladoIds.length > 0) {
    await db.delete(trasladosTable).where(inArray(trasladosTable.id, trasladoIds));
  }
  if (deliveryIds.length > 0) {
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
  }
  if (saleId !== null) {
    await db.delete(salesTable).where(inArray(salesTable.id, [saleId]));
  }
  if (vehicleId !== null) {
    await db.delete(vehiclesTable).where(inArray(vehiclesTable.id, [vehicleId]));
  }
  if (driverId !== null) {
    await db.delete(personnelTable).where(inArray(personnelTable.id, [driverId]));
  }
  if (warehouseIds.length > 0) {
    await db.delete(almacenesTable).where(inArray(almacenesTable.id, warehouseIds));
  }
});

describe("migración de despachos polimórficos", () => {
  it("preserva ventas, es idempotente y rechaza fuentes ambiguas o ausentes", async () => {
    const client = await pool.connect();
    const schemaName = `dispatch_poly_${process.pid}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE sales (id integer PRIMARY KEY);
        CREATE TABLE traslados (id integer PRIMARY KEY);
        CREATE TABLE dispatches (
          id serial PRIMARY KEY,
          venta_id integer NOT NULL
        );
        INSERT INTO sales (id) VALUES (1);
        INSERT INTO traslados (id) VALUES (2);
        INSERT INTO dispatches (venta_id) VALUES (1);
      `);

      await client.query(dispatchesMigrationSql);
      await client.query(dispatchesMigrationSql);

      const migrated = await client.query(
        `SELECT tipo, venta_id, traslado_id FROM dispatches`,
      );
      expect(migrated.rows).toEqual([
        { tipo: "venta", venta_id: 1, traslado_id: null },
      ]);

      await client.query("SAVEPOINT invalid_both");
      await expect(
        client.query(
          `INSERT INTO dispatches (tipo, venta_id, traslado_id) VALUES ('venta', 1, 2)`,
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT invalid_both");

      await client.query("SAVEPOINT invalid_none");
      await expect(
        client.query(
          `INSERT INTO dispatches (tipo, venta_id, traslado_id) VALUES ('venta', NULL, NULL)`,
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT invalid_none");

      await expect(
        client.query(
          `INSERT INTO dispatches (tipo, venta_id, traslado_id) VALUES ('traslado', NULL, 2)`,
        ),
      ).resolves.toBeDefined();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});


describe("peso efectivo y edición local del traslado", () => {
  it("rechaza cero y negativos en el contrato, pero acepta null", () => {
    expect(UpdateTrasladoBody.safeParse({ pesoEstimadoKg: 0 }).success).toBe(false);
    expect(UpdateTrasladoBody.safeParse({ pesoEstimadoKg: -1 }).success).toBe(false);
    expect(UpdateTrasladoBody.safeParse({ pesoEstimadoKg: null }).success).toBe(true);
  });

  it("usa la estimación solo sin peso Odoo y permite eliminarla", async () => {
    const estimated = await updateTrasladoLocalFields(trasladoIds[0]!, {
      pesoEstimadoKg: 3500,
      notas: "Estimación operativa",
    });
    expect(estimated).toMatchObject({
      pesoCalculadoKg: null,
      pesoEstimadoKg: 3500,
      pesoEfectivoKg: 3500,
      origenPeso: "estimado",
      notas: "Estimación operativa",
    });

    const cleared = await updateTrasladoLocalFields(trasladoIds[0]!, {
      pesoEstimadoKg: null,
    });
    expect(cleared).toMatchObject({
      pesoEstimadoKg: null,
      pesoEfectivoKg: null,
      origenPeso: null,
    });
  });

  it("prioriza Odoo y no permite sobrescribir ese peso", async () => {
    expect(await getTraslado(trasladoIds[1]!)).toMatchObject({
      pesoCalculadoKg: 425,
      pesoEstimadoKg: 999,
      pesoEfectivoKg: 425,
      origenPeso: "odoo",
    });
    await expect(
      updateTrasladoLocalFields(trasladoIds[1]!, { pesoEstimadoKg: 500 }),
    ).rejects.toBeInstanceOf(TrasladoPesoOdooReadonlyError);
  });
});

describe("despachos de venta y traslado", () => {
  it("mantiene la cabecera de venta y resuelve la cabecera/carga del traslado", async () => {
    const rows = await db
      .select()
      .from(dispatchesTable)
      .where(inArray(dispatchesTable.id, dispatchIds));
    const saleDispatch = rows.find((row) => row.tipo === "venta")!;
    const transferDispatch = rows.find((row) => row.tipo === "traslado")!;

    expect(await buildDispatchRow(saleDispatch)).toMatchObject({
      tipo: "venta",
      ventaId: saleId,
      trasladoId: null,
      referencia: `SALE-DSP-${suffix}`,
      origen: "Origen venta QA",
      destino: "Destino venta QA",
    });
    expect(await buildDispatchDetail(transferDispatch)).toMatchObject({
      tipo: "traslado",
      ventaId: null,
      trasladoId: trasladoIds[0],
      referencia: `QA/INT/ESTIMADO-${suffix}`,
      origen: "Origen despacho traslado",
      destino: "Destino despacho traslado",
      pesoTotal: null,
      volumenTotal: null,
      saleItems: [],
    });
  });

  it("no bloquea medidas desconocidas y sí bloquea pesos o volúmenes conocidos sobre capacidad", async () => {
    const capacidad = { capacidadPeso: 1_000, capacidadVolumen: 10 };
    expect(
      exceedsDispatchCapacity(capacidad, { pesoKg: null, volumenM3: null }),
    ).toBe(false);
    expect(
      exceedsDispatchCapacity(capacidad, { pesoKg: 1_001, volumenM3: null }),
    ).toBe(true);
    expect(
      exceedsDispatchCapacity(capacidad, { pesoKg: 999, volumenM3: 11 }),
    ).toBe(true);

    const unknownMeasures = await getTraslado(trasladoIds[0]!);
    const knownVolume = await getTraslado(trasladoIds[1]!);
    expect(
      exceedsDispatchCapacity(
        { capacidadPeso: 10_000, capacidadVolumen: 1 },
        {
          pesoKg: unknownMeasures!.pesoEfectivoKg,
          volumenM3: unknownMeasures!.volumenCalculadoM3,
        },
      ),
    ).toBe(false);
    expect(
      exceedsDispatchCapacity(
        { capacidadPeso: 10_000, capacidadVolumen: 1 },
        {
          pesoKg: knownVolume!.pesoEfectivoKg,
          volumenM3: knownVolume!.volumenCalculadoM3,
        },
      ),
    ).toBe(true);
  });

  it("deriva la secuencia completa sin retroceder estados terminales de Odoo", async () => {
    const trasladoId = trasladoIds[0]!;
    const originalDispatchId = dispatchIds[1]!;

    expect(deriveTrasladoEstadoFromDispatch([])).toBe("por_planificar");
    expect(deriveTrasladoEstadoFromDispatch(["cancelado", "aprobado"])).toBe(
      "planificado",
    );
    expect(
      deriveTrasladoEstadoFromDispatch(["entregado", "en-ruta", "aprobado"]),
    ).toBe("entregado");

    await syncTrasladoEstadoFromDispatch(trasladoId);
    let traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("planificado");

    await db
      .update(dispatchesTable)
      .set({ estado: "en-ruta" })
      .where(eq(dispatchesTable.id, originalDispatchId));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("en_transito");

    const [deliveredDispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-01-03T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-01-03T18:00:00.000Z",
        estado: "entregado",
      })
      .returning({ id: dispatchesTable.id });
    dispatchIds.push(deliveredDispatch!.id);

    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("entregado");

    await db
      .update(dispatchesTable)
      .set({ estado: "cancelado" })
      .where(eq(dispatchesTable.id, deliveredDispatch!.id));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("en_transito");

    await db
      .update(dispatchesTable)
      .set({ estado: "cancelado" })
      .where(eq(dispatchesTable.id, originalDispatchId));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("por_planificar");

    await db
      .update(dispatchesTable)
      .set({ estado: "pre-despacho" })
      .where(eq(dispatchesTable.id, originalDispatchId));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    await db
      .delete(dispatchesTable)
      .where(eq(dispatchesTable.id, originalDispatchId));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("por_planificar");

    await db
      .update(trasladosTable)
      .set({ estadoLogistico: "confirmado_odoo" })
      .where(eq(trasladosTable.id, trasladoId));
    await db
      .update(dispatchesTable)
      .set({ estado: "entregado" })
      .where(eq(dispatchesTable.id, deliveredDispatch!.id));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("confirmado_odoo");

    await db
      .update(trasladosTable)
      .set({ estadoLogistico: "cancelado" })
      .where(eq(trasladosTable.id, trasladoId));
    await syncTrasladoEstadoFromDispatch(trasladoId);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("cancelado");
  });

  it("reconcilia inconsistencias una sola vez y conserva estados de Odoo", async () => {
    const trasladoId = trasladoIds[1]!;
    const [dispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-01-04T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-01-04T18:00:00.000Z",
        estado: "en-ruta",
      })
      .returning({ id: dispatchesTable.id });
    dispatchIds.push(dispatch!.id);

    await db
      .update(trasladosTable)
      .set({ estadoLogistico: "por_planificar" })
      .where(eq(trasladosTable.id, trasladoId));
    expect(await reconcileTrasladoEstados([trasladoId])).toBe(1);
    let traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("en_transito");
    expect(await reconcileTrasladoEstados([trasladoId])).toBe(0);

    await db
      .update(trasladosTable)
      .set({ estadoLogistico: "confirmado_odoo" })
      .where(eq(trasladosTable.id, trasladoId));
    await db
      .update(dispatchesTable)
      .set({ estado: "entregado" })
      .where(eq(dispatchesTable.id, dispatch!.id));
    expect(await reconcileTrasladoEstados([trasladoId])).toBe(0);
    traslado = await getTraslado(trasladoId);
    expect(traslado!.estadoLogistico).toBe("confirmado_odoo");
  });
});

// ---------------------------------------------------------------------------
// Arrival-record task regression coverage
// ---------------------------------------------------------------------------

describe("migración 0011 actas_llegada", () => {
  it("es idempotente y crea exactamente un UNIQUE por despacho", async () => {
    const client = await pool.connect();
    const schemaName = `actas_llegada_mig_${process.pid}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}"`);

      // Stub the referenced tables so FK constraints resolve
      await client.query(`
        CREATE TABLE personnel (id serial PRIMARY KEY);
        CREATE TABLE dispatches (id serial PRIMARY KEY);
      `);

      // Run the migration twice – must not throw
      await client.query(actasMigrationSql);
      await client.query(actasMigrationSql);

      // Exactly one UNIQUE constraint on despacho_id
      const { rows } = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM pg_constraint
        WHERE conrelid = 'actas_llegada'::regclass
          AND contype = 'u'
          AND conname = 'actas_llegada_despacho_id_unique'
      `);
      expect(Number(rows[0]!.count)).toBe(1);

      // The FK must cascade when a dispatch is removed.
      await client.query(`INSERT INTO dispatches DEFAULT VALUES`);
      await client.query(`
        INSERT INTO actas_llegada (despacho_id, fecha_llegada)
        VALUES (1, now())
      `);
      await client.query(`DELETE FROM dispatches WHERE id = 1`);
      const cascaded = await client.query(
        `SELECT count(*)::int AS count FROM actas_llegada`,
      );
      expect(cascaded.rows[0]!.count).toBe(0);

      // Inserting two records with the same despacho_id must fail.
      await client.query(`INSERT INTO dispatches DEFAULT VALUES`);
      await client.query(`
        INSERT INTO actas_llegada (despacho_id, fecha_llegada)
        VALUES (2, now())
      `);
      await expect(
        client.query(`
          INSERT INTO actas_llegada (despacho_id, fecha_llegada)
          VALUES (2, now())
        `),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

describe("registrarLlegada y confirmarRecepcion", () => {
  // Track actas created in this suite so we can clean up
  const actaDispatchIds: number[] = [];

  afterEach(async () => {
    if (actaDispatchIds.length > 0) {
      await db
        .delete(actasLlegadaTable)
        .where(inArray(actasLlegadaTable.despachoId, actaDispatchIds));
      actaDispatchIds.length = 0;
    }
  });

  it("registrarLlegada: upsert preserva la confirmación del almacén y convierte texto en blanco en null", async () => {
    const despachoId = dispatchIds[0]!;
    actaDispatchIds.push(despachoId);

    // First registration – driver side
    const primera = await registrarLlegada(despachoId, {
      fechaLlegada: new Date("2035-06-01T10:00:00Z"),
      novedadesViaje: "Retraso en aduana",
      registradaPorId: null,
    });
    expect(primera).toBeDefined();
    expect(primera!.novedadesViaje).toBe("Retraso en aduana");
    expect(primera!.confirmadaAt).toBeNull();

    // Confirm through the warehouse service so attribution and capture time are covered.
    const confirmada = await confirmarRecepcion(despachoId, {
      recibidoPor: "Juan",
      novedadesRecepcion: "Recibido conforme",
      confirmadaPorId: driverId,
    });
    expect(confirmada!.confirmadaAt).not.toBeNull();
    expect(confirmada!.confirmadaPorId).toBe(driverId);

    // Upsert with blank novelty text → must stay as null and NOT wipe warehouse confirmation
    const segunda = await registrarLlegada(despachoId, {
      fechaLlegada: new Date("2035-06-01T10:30:00Z"),
      novedadesViaje: "   ",
      registradaPorId: null,
    });
    expect(segunda!.id).toBe(primera!.id);
    expect(segunda!.novedadesViaje).toBeNull();
    expect(segunda!.fechaLlegada.toISOString()).toBe(
      "2035-06-01T10:30:00.000Z",
    );

    // Warehouse confirmation fields are preserved by upsert (only driver fields overwritten)
    const [raw] = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, despachoId));
    expect(raw!.confirmadaAt).not.toBeNull();
    expect(raw!.confirmadaPorId).toBe(driverId);
    expect(raw!.novedadesRecepcion).toBe("Recibido conforme");

    // Validate against generated contract schema
    expect(RegisterDispatchActaResponse.safeParse(segunda!).success).toBe(true);
  });

  it("confirmarRecepcion devuelve null cuando no existe acta previa", async () => {
    // Use a dispatch that definitely has no acta (the second one, which
    // hasn't had registrarLlegada called yet in this suite run)
    const despachoId = dispatchIds[1]!;

    // Ensure there is no acta for this dispatch
    await db
      .delete(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, despachoId));

    const result = await confirmarRecepcion(despachoId, {
      recibidoPor: "Juan",
      novedadesRecepcion: "Sin novedad",
      confirmadaPorId: null,
    });
    expect(result).toBeNull();
  });
});

describe("recepcionSinValidar matrix", () => {
  // We create a dedicated dispatch+traslado pair per scenario and clean up after.
  const localDispatchIds: number[] = [];
  const localActaDispatchIds: number[] = [];
  const localTrasladoIds: number[] = [];
  const localDeliveryIds: number[] = [];

  afterEach(async () => {
    if (localActaDispatchIds.length > 0) {
      await db
        .delete(actasLlegadaTable)
        .where(inArray(actasLlegadaTable.despachoId, localActaDispatchIds));
      localActaDispatchIds.length = 0;
    }
    if (localDispatchIds.length > 0) {
      await db
        .delete(dispatchesTable)
        .where(inArray(dispatchesTable.id, localDispatchIds));
      localDispatchIds.length = 0;
    }
    if (localTrasladoIds.length > 0) {
      await db
        .delete(trasladosTable)
        .where(inArray(trasladosTable.id, localTrasladoIds));
      localTrasladoIds.length = 0;
    }
    if (localDeliveryIds.length > 0) {
      await db
        .delete(deliveriesTable)
        .where(inArray(deliveriesTable.id, localDeliveryIds));
      localDeliveryIds.length = 0;
    }
  });

  async function makeTransferDispatch(
    estadoOdoo: string,
    estadoLogistico: string,
    dispatchEstado: string,
  ) {
    const [delivery] = await db
      .insert(deliveriesTable)
      .values({
        ventaId: null,
        odooId: negativeOdooId - 100 - Math.floor(Math.random() * 10_000),
        tipo: "traslado",
        nombre: `QA/RSV-${suffix}-${Math.random()}`,
        estado: estadoOdoo,
      })
      .returning({ id: deliveriesTable.id });
    localDeliveryIds.push(delivery!.id);

    const [traslado] = await db
      .insert(trasladosTable)
      .values({
        deliveryId: delivery!.id,
        odooPickingId: negativeOdooId - 200 - Math.floor(Math.random() * 10_000),
        almacenOrigenId: warehouseIds[0]!,
        almacenDestinoId: warehouseIds[1]!,
        estadoLogistico,
      })
      .returning({ id: trasladosTable.id });
    localTrasladoIds.push(traslado!.id);

    const [dispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId: traslado!.id,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-06-01T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-06-01T18:00:00.000Z",
        estado: dispatchEstado,
      })
      .returning({ id: dispatchesTable.id });
    localDispatchIds.push(dispatch!.id);

    return { trasladoId: traslado!.id, dispatchId: dispatch!.id };
  }

  it("true: estadoLogistico=entregado, estadoOdoo=assigned, acta con 30h de antigüedad", async () => {
    const { trasladoId, dispatchId } = await makeTransferDispatch(
      "assigned",
      "entregado",
      "entregado",
    );
    localActaDispatchIds.push(dispatchId);

    // Insert an acta with fecha_llegada 30 hours ago
    await db.insert(actasLlegadaTable).values({
      despachoId: dispatchId,
      fechaLlegada: new Date(Date.now() - 30 * 60 * 60 * 1000),
      registradaPorId: null,
    });

    const summary = await getTrasladoSummary(trasladoId);
    expect(summary).not.toBeNull();
    expect(ListTrasladosResponseItem.safeParse(summary).success).toBe(true);
    expect(summary!.recepcionSinValidar).toBe(true);
  });

  it("false: acta solo tiene 2h de antigüedad (dentro del plazo)", async () => {
    const { trasladoId, dispatchId } = await makeTransferDispatch(
      "assigned",
      "entregado",
      "entregado",
    );
    localActaDispatchIds.push(dispatchId);

    await db.insert(actasLlegadaTable).values({
      despachoId: dispatchId,
      fechaLlegada: new Date(Date.now() - 2 * 60 * 60 * 1000),
      registradaPorId: null,
    });

    const summary = await getTrasladoSummary(trasladoId);
    expect(summary!.recepcionSinValidar).toBe(false);
  });

  it("false: estadoOdoo=done aunque hayan pasado 30h", async () => {
    const { trasladoId, dispatchId } = await makeTransferDispatch(
      "done",
      "entregado",
      "entregado",
    );
    localActaDispatchIds.push(dispatchId);

    await db.insert(actasLlegadaTable).values({
      despachoId: dispatchId,
      fechaLlegada: new Date(Date.now() - 30 * 60 * 60 * 1000),
      registradaPorId: null,
    });

    const summary = await getTrasladoSummary(trasladoId);
    expect(summary!.recepcionSinValidar).toBe(false);
  });

  it("false: estadoLogistico no es entregado (en_transito)", async () => {
    const { trasladoId, dispatchId } = await makeTransferDispatch(
      "assigned",
      "en_transito",
      "en-ruta",
    );
    localActaDispatchIds.push(dispatchId);

    await db.insert(actasLlegadaTable).values({
      despachoId: dispatchId,
      fechaLlegada: new Date(Date.now() - 30 * 60 * 60 * 1000),
      registradaPorId: null,
    });

    const summary = await getTrasladoSummary(trasladoId);
    expect(summary!.recepcionSinValidar).toBe(false);
  });

  it("false: solo existe acta sobre un despacho cancelado", async () => {
    // Cancelled dispatch must be ignored for actaVencida
    const { trasladoId, dispatchId } = await makeTransferDispatch(
      "assigned",
      "entregado",
      "cancelado",
    );
    localActaDispatchIds.push(dispatchId);

    await db.insert(actasLlegadaTable).values({
      despachoId: dispatchId,
      fechaLlegada: new Date(Date.now() - 30 * 60 * 60 * 1000),
      registradaPorId: null,
    });

    const summary = await getTrasladoSummary(trasladoId);
    expect(summary!.recepcionSinValidar).toBe(false);
  });
});

describe("detalle del traslado expone el despacho activo que gobierna el acta", () => {
  const localDispatchIds: number[] = [];
  const localActaDispatchIds: number[] = [];

  afterEach(async () => {
    if (localActaDispatchIds.length > 0) {
      await db
        .delete(actasLlegadaTable)
        .where(inArray(actasLlegadaTable.despachoId, localActaDispatchIds));
      localActaDispatchIds.length = 0;
    }
    if (localDispatchIds.length > 0) {
      await db
        .delete(dispatchesTable)
        .where(inArray(dispatchesTable.id, localDispatchIds));
      localDispatchIds.length = 0;
    }
  });

  it("getTraslado ignora el acta cancelada y conserva el despacho activo sin acta", async () => {
    const trasladoId = trasladoIds[0]!;

    // Create a cancelled dispatch with an acta
    const [cancelledDispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-07-01T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-07-01T18:00:00.000Z",
        estado: "cancelado",
      })
      .returning({ id: dispatchesTable.id });
    localDispatchIds.push(cancelledDispatch!.id);
    localActaDispatchIds.push(cancelledDispatch!.id);

    await db.insert(actasLlegadaTable).values({
      despachoId: cancelledDispatch!.id,
      fechaLlegada: new Date("2035-07-01T14:00:00Z"),
      novedadesViaje: "Acta de despacho cancelado",
      registradaPorId: null,
    });

    const detail = await getTraslado(trasladoId);
    expect(detail).not.toBeNull();
    expect(detail!.despachoActivo).not.toBeNull();
    expect(detail!.despachoActivo!.estado).not.toBe("cancelado");
    expect(detail!.acta).toBeNull();

    // Validate response shape against generated contract
    expect(GetTrasladoResponse.safeParse(detail).success).toBe(true);
  });

  it("getTraslado devuelve el acta del despacho activo cuando conviven uno activo y uno cancelado", async () => {
    const trasladoId = trasladoIds[0]!;

    // Active dispatch with acta
    const [activeDispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-07-02T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-07-02T18:00:00.000Z",
        estado: "entregado",
      })
      .returning({ id: dispatchesTable.id });
    localDispatchIds.push(activeDispatch!.id);
    localActaDispatchIds.push(activeDispatch!.id);

    await db.insert(actasLlegadaTable).values({
      despachoId: activeDispatch!.id,
      fechaLlegada: new Date("2035-07-02T14:00:00Z"),
      novedadesViaje: "Acta del despacho activo",
      registradaPorId: null,
    });

    // Cancelled dispatch with acta (should be ignored)
    const [cancelledDispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-07-03T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-07-03T18:00:00.000Z",
        estado: "cancelado",
      })
      .returning({ id: dispatchesTable.id });
    localDispatchIds.push(cancelledDispatch!.id);
    localActaDispatchIds.push(cancelledDispatch!.id);

    await db.insert(actasLlegadaTable).values({
      despachoId: cancelledDispatch!.id,
      fechaLlegada: new Date("2035-07-01T09:00:00Z"),
      novedadesViaje: "Acta descartada",
      registradaPorId: null,
    });

    const detail = await getTraslado(trasladoId);
    expect(detail!.despachoActivo).toEqual({
      id: activeDispatch!.id,
      estado: "entregado",
    });
    expect(detail!.acta).not.toBeNull();
    expect(detail!.acta!.despachoId).toBe(activeDispatch!.id);
    expect(detail!.acta!.novedadesViaje).toBe("Acta del despacho activo");
  });

  it("getTraslado expone el despacho activo aunque todavía no tenga acta", async () => {
    const trasladoId = trasladoIds[0]!;
    const [activeDispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-07-04T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-07-04T18:00:00.000Z",
        estado: "en-ruta",
      })
      .returning({ id: dispatchesTable.id });
    localDispatchIds.push(activeDispatch!.id);

    const detail = await getTraslado(trasladoId);

    expect(detail!.despachoActivo).toEqual({
      id: activeDispatch!.id,
      estado: "en-ruta",
    });
    expect(detail!.acta).toBeNull();
    expect(GetTrasladoResponse.safeParse(detail).success).toBe(true);
  });
});

describe("cantidadLineas no se multiplica con múltiples despachos", () => {
  const localDispatchIds: number[] = [];
  const localItemIds: number[] = [];

  afterEach(async () => {
    if (localDispatchIds.length > 0) {
      await db
        .delete(dispatchesTable)
        .where(inArray(dispatchesTable.id, localDispatchIds));
      localDispatchIds.length = 0;
    }
    if (localItemIds.length > 0) {
      await db
        .delete(deliveryItemsTable)
        .where(inArray(deliveryItemsTable.id, localItemIds));
      localItemIds.length = 0;
    }
  });

  it("dos despachos sobre el mismo traslado no duplican cantidadLineas", async () => {
    const trasladoId = trasladoIds[0]!;
    const delivery = await db
      .select({ id: deliveriesTable.id })
      .from(trasladosTable)
      .innerJoin(
        deliveriesTable,
        eq(deliveriesTable.id, trasladosTable.deliveryId),
      )
      .where(eq(trasladosTable.id, trasladoId));
    const deliveryId = delivery[0]!.id;

    // Insert 2 delivery items (odooMoveId must be unique and NOT NULL)
    const baseOdooMoveId = -(2_000_000_000) + Math.floor(Math.random() * 100_000);
    const items = await db
      .insert(deliveryItemsTable)
      .values([
        {
          deliveryId,
          odooMoveId: baseOdooMoveId,
          descripcion: "Producto A",
          cantidadDemanda: 10,
          cantidadEntregada: 10,
          uom: "kg",
        },
        {
          deliveryId,
          odooMoveId: baseOdooMoveId - 1,
          descripcion: "Producto B",
          cantidadDemanda: 5,
          cantidadEntregada: 5,
          uom: "kg",
        },
      ])
      .returning({ id: deliveryItemsTable.id });
    for (const item of items) localItemIds.push(item.id);

    // Add a second dispatch for the same traslado
    const [secondDispatch] = await db
      .insert(dispatchesTable)
      .values({
        tipo: "traslado",
        ventaId: null,
        trasladoId,
        vehiculoId: vehicleId!,
        choferId: driverId!,
        fechaEstimadaSalida: "2035-08-01T08:00:00.000Z",
        fechaEstimadaLlegada: "2035-08-01T18:00:00.000Z",
        estado: "pre-despacho",
      })
      .returning({ id: dispatchesTable.id });
    localDispatchIds.push(secondDispatch!.id);

    const summary = await getTrasladoSummary(trasladoId);
    // Must be exactly 2, not 4 (2 items × 2 dispatches)
    expect(summary!.cantidadLineas).toBe(2);

    // Also validate contract compliance
    expect(ListTrasladosResponseItem.safeParse(summary).success).toBe(true);
  });
});