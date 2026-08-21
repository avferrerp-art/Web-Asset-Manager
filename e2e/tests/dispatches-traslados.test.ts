import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
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
} from "@workspace/db";
import { UpdateTrasladoBody } from "../../lib/api-zod/src/generated/api";
import { sql as dispatchesMigrationSql } from "../../lib/db/src/migrations/0010_dispatches_polimorficos";
import {
  buildDispatchDetail,
  buildDispatchRow,
  exceedsDispatchCapacity,
} from "../../artifacts/api-server/src/routes/dispatches";
import {
  getTraslado,
  TrasladoPesoOdooReadonlyError,
  updateTrasladoLocalFields,
} from "../../artifacts/api-server/src/services/trasladoQueries";

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

  it("no bloquea medidas desconocidas y sí bloquea pesos conocidos sobre capacidad", () => {
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
  });
});