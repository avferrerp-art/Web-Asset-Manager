import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  almacenesTable,
  db,
  deliveriesTable,
  deliveryItemsTable,
  productsTable,
  trasladosTable,
} from "@workspace/db";
import {
  GetTrasladoResponse,
  ListTrasladosResponse,
} from "../../lib/api-zod/src/generated/api";
import {
  getTraslado,
  listTraslados,
} from "../../artifacts/api-server/src/services/trasladoQueries";
import {
  formatTrasladoMedida,
  trasladoSinMedida,
} from "../../artifacts/logistics/src/lib/traslado-medidas";

const suffix = `${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;
const negativeBase = -1_900_000_000 + Math.floor(Math.random() * 100_000);

let warehouseIds: number[] = [];
let deliveryIds: number[] = [];
let transferIds: number[] = [];
let productId: number | null = null;

beforeAll(async () => {
  const warehouses = await db
    .insert(almacenesTable)
    .values([
      {
        codigo: `QA-A-${suffix}`,
        odooPrefix: `QA-A-${suffix}`,
        nombre: "Depósito Ávila",
        plaza: "Caracas QA",
      },
      {
        codigo: `QA-L-${suffix}`,
        odooPrefix: `QA-L-${suffix}`,
        nombre: "Lechería QA",
        plaza: "Oriente QA",
      },
    ])
    .returning({ id: almacenesTable.id });
  warehouseIds = warehouses.map((warehouse) => warehouse.id);

  [productId] = (
    await db
      .insert(productsTable)
      .values({
        odooId: negativeBase - 1,
        odooRef: `PROD-QA-${suffix}`,
        nombre: "Producto de prueba de traslados",
      })
      .returning({ id: productsTable.id })
  ).map((product) => product.id);

  const deliveries = await db
    .insert(deliveriesTable)
    .values([
      {
        ventaId: null,
        odooId: negativeBase - 10,
        tipo: "traslado",
        nombre: `QA/INT/RECIENTE-${suffix}`,
        estado: "done",
        fechaProgramada: new Date("2035-03-20T10:00:00.000Z"),
        fechaEfectiva: new Date("2035-03-20T15:00:00.000Z"),
      },
      {
        ventaId: null,
        odooId: negativeBase - 11,
        tipo: "traslado",
        nombre: `QA/INT/ANTIGUO-${suffix}`,
        estado: "cancel",
        fechaProgramada: new Date("2034-03-20T10:00:00.000Z"),
      },
      {
        ventaId: null,
        odooId: negativeBase - 12,
        tipo: "traslado",
        nombre: `QA/INT/SIN-FECHA-${suffix}`,
        estado: "draft",
        fechaProgramada: null,
      },
    ])
    .returning({ id: deliveriesTable.id });
  deliveryIds = deliveries.map((delivery) => delivery.id);

  const transfers = await db
    .insert(trasladosTable)
    .values([
      {
        deliveryId: deliveryIds[0],
        odooPickingId: negativeBase - 10,
        almacenOrigenId: warehouseIds[0],
        almacenDestinoId: warehouseIds[1],
        estadoLogistico: "confirmado_odoo",
        pesoCalculadoKg: null,
        volumenCalculadoM3: null,
      },
      {
        deliveryId: deliveryIds[1],
        odooPickingId: negativeBase - 11,
        almacenOrigenId: warehouseIds[0],
        almacenDestinoId: warehouseIds[0],
        estadoLogistico: "cancelado",
        pesoCalculadoKg: 123.5,
        volumenCalculadoM3: 1.25,
      },
      {
        deliveryId: deliveryIds[2],
        odooPickingId: negativeBase - 12,
        almacenOrigenId: warehouseIds[1],
        almacenDestinoId: warehouseIds[0],
        estadoLogistico: "por_planificar",
      },
    ])
    .returning({ id: trasladosTable.id });
  transferIds = transfers.map((transfer) => transfer.id);

  await db.insert(deliveryItemsTable).values([
    {
      deliveryId: deliveryIds[0]!,
      productId,
      odooMoveId: negativeBase - 20,
      descripcion: "Producto con recepción completa",
      cantidadDemanda: 4,
      cantidadEntregada: 4,
      uom: "Unidades",
      estado: "done",
    },
    {
      deliveryId: deliveryIds[0]!,
      productId: null,
      odooMoveId: negativeBase - 21,
      descripcion: "Producto con recepción incompleta",
      cantidadDemanda: 10,
      cantidadEntregada: 7,
      uom: "Unidades",
      estado: "done",
    },
    {
      deliveryId: deliveryIds[1]!,
      productId,
      odooMoveId: negativeBase - 22,
      descripcion: "Producto cancelado",
      cantidadDemanda: 1,
      cantidadEntregada: 0,
      uom: "Unidades",
      estado: "cancel",
    },
  ]);
});

afterAll(async () => {
  if (transferIds.length > 0) {
    await db.delete(trasladosTable).where(inArray(trasladosTable.id, transferIds));
  }
  if (deliveryIds.length > 0) {
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, deliveryIds));
  }
  if (productId !== null) {
    await db.delete(productsTable).where(inArray(productsTable.id, [productId]));
  }
  if (warehouseIds.length > 0) {
    await db.delete(almacenesTable).where(inArray(almacenesTable.id, warehouseIds));
  }
});

describe("traslados read queries and contract", () => {
  it("only treats null measures as missing Odoo data", () => {
    expect(trasladoSinMedida(null)).toBe(true);
    expect(trasladoSinMedida(0)).toBe(false);
    expect(formatTrasladoMedida(null, "kg")).toBe("sin dato en Odoo");
    expect(formatTrasladoMedida(0, "kg")).toBe("0 kg");
    expect(formatTrasladoMedida(12.5, "m³")).toBe("12.5 m³");
  });

  it("orders scheduled transfers newest first and leaves null dates last", async () => {
    const rows = (await listTraslados()).filter((row) => transferIds.includes(row.id));

    expect(rows.map((row) => row.id)).toEqual([
      transferIds[0],
      transferIds[1],
      transferIds[2],
    ]);
    expect(rows[2]!.fechaProgramada).toBeNull();
    expect(ListTrasladosResponse.safeParse(rows).success).toBe(true);
  });

  it("returns canonical warehouses, derived flags, nullable measures, and line counts", async () => {
    const rows = await listTraslados({ search: `RECIENTE-${suffix}` });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: transferIds[0],
      almacenOrigen: { nombre: "Depósito Ávila" },
      almacenDestino: { nombre: "Lechería QA" },
      cruzaPlaza: true,
      mismoAlmacen: false,
      cantidadLineas: 2,
      pesoCalculadoKg: null,
      volumenCalculadoM3: null,
    });

    const sameWarehouse = await listTraslados({ estadoOdoo: "cancel" });
    const testRow = sameWarehouse.find((row) => row.id === transferIds[1]);
    expect(testRow).toMatchObject({
      mismoAlmacen: true,
      cruzaPlaza: false,
      pesoCalculadoKg: 123.5,
      volumenCalculadoM3: 1.25,
    });
  });

  it("applies warehouse and state filters independently", async () => {
    const origin = await listTraslados({ almacenOrigenId: warehouseIds[1] });
    expect(origin.filter((row) => transferIds.includes(row.id)).map((row) => row.id)).toEqual([
      transferIds[2],
    ]);

    const destination = await listTraslados({ almacenDestinoId: warehouseIds[1] });
    expect(
      destination.filter((row) => transferIds.includes(row.id)).map((row) => row.id),
    ).toEqual([transferIds[0]]);

    const logistical = await listTraslados({ estadoLogistico: "por_planificar" });
    expect(
      logistical.filter((row) => transferIds.includes(row.id)).map((row) => row.id),
    ).toEqual([transferIds[2]]);
  });

  it("searches references and canonical warehouse names without case or accents", async () => {
    const byOrigin = await listTraslados({ search: "DEPOSITO avila" });
    expect(byOrigin.filter((row) => transferIds.includes(row.id))).toHaveLength(3);

    const byDestination = await listTraslados({ search: "lecheria" });
    expect(
      byDestination.filter((row) => transferIds.includes(row.id)).map((row) => row.id),
    ).toEqual([transferIds[0], transferIds[2]]);
  });

  it("returns detail lines with product code and demand-minus-received difference", async () => {
    const detail = await getTraslado(transferIds[0]!);
    expect(detail).not.toBeNull();
    expect(detail!.lineas).toHaveLength(2);
    expect(detail!.lineas[0]).toMatchObject({
      codigo: `PROD-QA-${suffix}`,
      demanda: 4,
      cantidad: 4,
      diferencia: 0,
    });
    expect(detail!.lineas[1]).toMatchObject({
      codigo: null,
      demanda: 10,
      cantidad: 7,
      diferencia: 3,
    });
    expect(GetTrasladoResponse.safeParse(detail).success).toBe(true);
  });

  it("returns null for an unknown transfer so the route can respond 404", async () => {
    expect(await getTraslado(2_147_483_647)).toBeNull();
  });
});