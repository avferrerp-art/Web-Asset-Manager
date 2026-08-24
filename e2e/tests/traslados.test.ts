import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, isNull } from "drizzle-orm";

const executeKwMock = vi.fn();
vi.mock("../../artifacts/api-server/src/lib/odooClient", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../artifacts/api-server/src/lib/odooClient")
  >();
  return {
    ...actual,
    getOdooConfig: () => ({
      url: "http://odoo.test",
      db: "test",
      username: "test",
      apiKey: "test",
    }),
    authenticate: async () => 1,
    executeKw: (...args: unknown[]) => executeKwMock(...args),
  };
});

import {
  almacenesTable,
  db,
  deliveryItemsTable,
  deliveriesTable,
  pool,
  productsTable,
  runMigrations,
  salesTable,
  trasladosTable,
} from "@workspace/db";
import { sql as trasladosMigrationSql } from "../../lib/db/src/migrations/0008_traslados";
import { recomputeDeliveryDerivedState } from "../../artifacts/api-server/src/services/deliveryEstado";
import {
  backfillInternalTransfers,
  syncDeliveries,
} from "../../artifacts/api-server/src/services/deliverySync";
import { getSaleDeliveryNames } from "../../artifacts/api-server/src/routes/sales";

const BASE = 92_100_000 + Math.floor(Math.random() * 1000) * 100;
const ODOO_IDS = [BASE + 1, BASE + 2, BASE + 3];
const SERVICE_BASE = BASE + 20;
const SERVICE_PICKING_IDS = Array.from({ length: 9 }, (_, index) => SERVICE_BASE + index);
const SERVICE_MOVE_IDS = Array.from({ length: 8 }, (_, index) => SERVICE_BASE + 20 + index);
const SERVICE_SALE_ODOO_IDS = [SERVICE_BASE + 40, SERVICE_BASE + 41];
const SERVICE_PRODUCT_ODOO_IDS = [SERVICE_BASE + 50, SERVICE_BASE + 51];
let saleId: number | null = null;

interface MockPicking {
  id: number;
  name: string;
  state: string;
  scheduled_date: string | false;
  date_done: string | false;
  origin: string | false;
  picking_type_id: [number, string];
  location_id: [number, string] | false;
  location_dest_id: [number, string] | false;
  backorder_id: [number, string] | false;
  sale_id: [number, string] | false;
  write_date: string;
  move_ids: number[];
}

interface MockMove {
  id: number;
  product_id: [number, string] | false;
  product_uom_qty: number;
  quantity: number;
  product_uom: [number, string] | false;
  state: string;
  picking_id: [number, string];
}

let protectedRemoteIds: number[] = [];
let mockedPickings: MockPicking[] = [];
let mockedMoves: MockMove[] = [];
let mockedRemoteIds: number[] = [];
let observedSearchReadDomains: unknown[][] = [];
let observedSearchDomains: unknown[][] = [];

function picking(
  id: number,
  overrides: Partial<MockPicking> = {},
): MockPicking {
  return {
    id,
    name: `TEST/INT/${id}`,
    state: "assigned",
    scheduled_date: "2030-01-01 10:00:00",
    date_done: false,
    origin: false,
    picking_type_id: [1, "Transferencias internas"],
    location_id: [1, "Urbin/Existencias"],
    location_dest_id: [2, "CCS/Existencias"],
    backorder_id: false,
    sale_id: false,
    write_date: "2030-01-01 10:00:00",
    move_ids: [],
    ...overrides,
  };
}

function move(
  id: number,
  pickingId: number,
  overrides: Partial<MockMove> = {},
): MockMove {
  return {
    id,
    product_id: false,
    product_uom_qty: 1,
    quantity: 0,
    product_uom: [1, "Unidades"],
    state: "assigned",
    picking_id: [pickingId, `TEST/INT/${pickingId}`],
    ...overrides,
  };
}

function configureOdoo(
  pickings: MockPicking[],
  moves: MockMove[] = [],
  remoteTestIds: number[] = pickings.map((record) => record.id),
): void {
  mockedPickings = pickings;
  mockedMoves = moves;
  mockedRemoteIds = [...protectedRemoteIds, ...remoteTestIds];
  observedSearchReadDomains = [];
  observedSearchDomains = [];
}

async function cleanupServiceRows(): Promise<void> {
  await db
    .delete(trasladosTable)
    .where(inArray(trasladosTable.odooPickingId, SERVICE_PICKING_IDS));
  await db
    .delete(deliveriesTable)
    .where(inArray(deliveriesTable.odooId, SERVICE_PICKING_IDS));
  await db
    .delete(salesTable)
    .where(inArray(salesTable.odooId, SERVICE_SALE_ODOO_IDS));
  await db
    .delete(productsTable)
    .where(inArray(productsTable.odooId, SERVICE_PRODUCT_ODOO_IDS));
}

beforeAll(async () => {
  await runMigrations();
  await pool.query(trasladosMigrationSql);
  await pool.query(trasladosMigrationSql);

  executeKwMock.mockImplementation(
    async (_config, _uid, model, method, args) => {
      if (model === "stock.picking" && method === "fields_get") {
        return {
          location_id: { type: "many2one" },
          location_dest_id: { type: "many2one" },
          scheduled_date: { type: "datetime" },
          date_done: { type: "datetime" },
          backorder_id: { type: "many2one" },
        };
      }
      if (model === "stock.move" && method === "fields_get") {
        return { quantity: { type: "float" } };
      }
      if (model === "stock.picking" && method === "search_read") {
        const domain =
          ((args as unknown[][] | undefined)?.[0] as unknown[]) ?? [];
        observedSearchReadDomains.push(domain);
        const conditions = domain as Array<[string, string, unknown]>;
        const requestedCodes = conditions.find(
          ([field, operator]) =>
            field === "picking_type_id.code" && operator === "in",
        )?.[2] as string[] | undefined;
        const minimumWriteDate = conditions.find(
          ([field, operator]) => field === "write_date" && operator === ">=",
        )?.[2] as string | undefined;
        const minimumId = conditions.find(
          ([field, operator]) => field === "id" && operator === ">",
        )?.[2] as number | undefined;
        const excludesSaleLinked = conditions.some(
          ([field, operator, value]) =>
            field === "sale_id" && operator === "=" && value === false,
        );
        return mockedPickings.filter((record) => {
          const code = record.picking_type_id[1].includes("entrega")
            ? "outgoing"
            : "internal";
          return (
            (!requestedCodes || requestedCodes.includes(code)) &&
            (!excludesSaleLinked || record.sale_id === false) &&
            (!minimumWriteDate || record.write_date >= minimumWriteDate) &&
            (minimumId === undefined || record.id > minimumId)
          );
        });
      }
      if (model === "stock.picking" && method === "search") {
        const domain =
          ((args as unknown[][] | undefined)?.[0] as unknown[]) ?? [];
        observedSearchDomains.push(domain);
        const conditions = domain as Array<[string, string, unknown]>;
        const excludesSaleLinked = conditions.some(
          ([field, operator, value]) =>
            field === "sale_id" && operator === "=" && value === false,
        );
        if (!excludesSaleLinked) return mockedRemoteIds;
        const saleLinkedIds = new Set(
          mockedPickings
            .filter((record) => record.sale_id !== false)
            .map((record) => record.id),
        );
        return mockedRemoteIds.filter((id) => !saleLinkedIds.has(id));
      }
      if (model === "stock.move" && method === "read") {
        const requestedIds =
          (((args as unknown[][] | undefined)?.[0] as number[] | undefined) ?? []);
        return mockedMoves.filter((record) => requestedIds.includes(record.id));
      }
      throw new Error(`Unexpected Odoo call: ${model}.${method}`);
    },
  );
});

afterAll(async () => {
  await cleanupServiceRows();
  await db
    .delete(trasladosTable)
    .where(inArray(trasladosTable.odooPickingId, ODOO_IDS));
  await db
    .delete(deliveriesTable)
    .where(inArray(deliveriesTable.odooId, ODOO_IDS));
  if (saleId !== null) {
    await db.delete(salesTable).where(eq(salesTable.id, saleId));
  }
});

describe("Modelo persistente de traslados", () => {
  it("repairs a partial transfer table and remains idempotent", async () => {
    const client = await pool.connect();
    const schemaName = `task101_partial_${process.pid}`;

    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE "deliveries" (
          "id" integer PRIMARY KEY,
          "venta_id" integer NOT NULL
        );
        CREATE TABLE "products" ("id" integer PRIMARY KEY);
        CREATE TABLE "almacenes" ("id" integer PRIMARY KEY);
        CREATE TABLE "traslados" (
          "estado_logistico" text,
          "created_at" timestamp with time zone
        );
        INSERT INTO "traslados" ("estado_logistico", "created_at")
        VALUES (NULL, NULL);
      `);

      await client.query(trasladosMigrationSql);
      await client.query(trasladosMigrationSql);

      const { rows } = await client.query<{
        id: number;
        estado_logistico: string;
        created_at: Date;
      }>(`SELECT "id", "estado_logistico", "created_at" FROM "traslados"`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBeGreaterThan(0);
      expect(rows[0]!.estado_logistico).toBe("por_planificar");
      expect(rows[0]!.created_at).toBeInstanceOf(Date);

      const { rows: constraints } = await client.query<{
        constraint_type: string;
        delete_action: string | null;
      }>(
        `
        SELECT
          tc.constraint_type,
          rc.delete_rule AS delete_action
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.referential_constraints rc
          ON rc.constraint_schema = tc.constraint_schema
          AND rc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = $1
          AND tc.table_name = 'traslados'
      `,
        [schemaName],
      );
      expect(
        constraints.filter(
          (constraint) => constraint.constraint_type === "PRIMARY KEY",
        ),
      ).toHaveLength(1);
      expect(
        constraints.filter(
          (constraint) => constraint.constraint_type === "UNIQUE",
        ),
      ).toHaveLength(2);
      expect(
        constraints.some(
          (constraint) =>
            constraint.constraint_type === "FOREIGN KEY" &&
            constraint.delete_action === "SET NULL",
        ),
      ).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("keeps every migrated delivery classified", async () => {
    const unclassified = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(isNull(deliveriesTable.tipo));
    expect(unclassified).toHaveLength(0);
  });

  it("supports sale and transfer movements and preserves a transfer after its delivery is deleted", async () => {
    const [sale] = await db
      .insert(salesTable)
      .values({
        cliente: "Cliente Test Traslados",
        destino: "Destino Test Traslados",
      })
      .returning({ id: salesTable.id });
    saleId = sale!.id;

    const [saleDelivery] = await db
      .insert(deliveriesTable)
      .values({
        ventaId: sale.id,
        odooId: ODOO_IDS[0]!,
        nombre: `TEST/OUT/${ODOO_IDS[0]}`,
        estado: "assigned",
        almacenOrigen: "CCS/Existencias",
      })
      .returning();
    expect(saleDelivery!.tipo).toBe("venta");

    const [transferDelivery] = await db
      .insert(deliveriesTable)
      .values({
        ventaId: null,
        odooId: ODOO_IDS[1]!,
        tipo: "traslado",
        nombre: `TEST/INT/${ODOO_IDS[1]}`,
        estado: "done",
        almacenOrigen: "Urbin/Existencias",
        almacenCodigo: "Urbin",
        almacenDestino: "LEC/Existencias",
        almacenDestinoCodigo: "LEC",
      })
      .returning();
    expect(transferDelivery).toMatchObject({
      ventaId: null,
      tipo: "traslado",
      almacenDestino: "LEC/Existencias",
      almacenDestinoCodigo: "LEC",
    });

    await db.insert(deliveriesTable).values({
      ventaId: sale.id,
      odooId: ODOO_IDS[2]!,
      tipo: "traslado",
      nombre: `TEST/INT/${ODOO_IDS[2]}`,
      estado: "done",
      almacenOrigen: "LEC/Existencias",
      fechaProgramada: new Date("2030-01-01T00:00:00Z"),
    });

    await recomputeDeliveryDerivedState([sale.id]);
    const [derivedSale] = await db
      .select()
      .from(salesTable)
      .where(eq(salesTable.id, sale.id));
    expect(derivedSale).toMatchObject({
      estadoEntrega: "pendiente",
      almacenOrigen: "CCS/Existencias",
      almacenesMultiples: false,
    });

    const nombresByVenta = await getSaleDeliveryNames();
    expect(nombresByVenta.get(sale.id)).toEqual([saleDelivery.nombre]);

    const warehouses = await db
      .select({ id: almacenesTable.id, codigo: almacenesTable.codigo })
      .from(almacenesTable);
    const warehouseByCode = new Map(
      warehouses.map((warehouse) => [warehouse.codigo, warehouse.id]),
    );
    const originId = warehouseByCode.get("URB");
    const destinationId = warehouseByCode.get("LEC");
    expect(originId).toBeDefined();
    expect(destinationId).toBeDefined();

    const [transfer] = await db
      .insert(trasladosTable)
      .values({
        deliveryId: transferDelivery.id,
        odooPickingId: transferDelivery.odooId,
        almacenOrigenId: originId!,
        almacenDestinoId: destinationId!,
        pesoCalculadoKg: 120,
        volumenCalculadoM3: 1.5,
        notas: "Traslado de prueba",
      })
      .returning();
    expect(transfer!.estadoLogistico).toBe("por_planificar");

    await db
      .delete(deliveriesTable)
      .where(eq(deliveriesTable.id, transferDelivery.id));

    const [preserved] = await db
      .select()
      .from(trasladosTable)
      .where(eq(trasladosTable.id, transfer!.id));
    expect(preserved).toMatchObject({
      deliveryId: null,
      odooPickingId: transferDelivery.odooId,
      almacenOrigenId: originId,
      almacenDestinoId: destinationId,
      estadoLogistico: "por_planificar",
    });
  });
});

describe("Sincronización de traslados internos Odoo", () => {
  beforeEach(async () => {
    await cleanupServiceRows();
    executeKwMock.mockClear();
    const existingDeliveries = await db
      .select({ odooId: deliveriesTable.odooId })
      .from(deliveriesTable);
    protectedRemoteIds = existingDeliveries
      .map((delivery) => delivery.odooId)
      .filter((odooId) => !SERVICE_PICKING_IDS.includes(odooId));
    configureOdoo([]);
  });

  it("classifies by sale_id, resolves warehouses once, calculates nullable totals, and is idempotent", async () => {
    const [sale] = await db
      .insert(salesTable)
      .values({
        cliente: "Venta vinculada sync traslado",
        destino: "Caracas",
        odooId: SERVICE_SALE_ODOO_IDS[0],
        odooRef: `S${SERVICE_SALE_ODOO_IDS[0]}`,
      })
      .returning({ id: salesTable.id });
    await db.insert(productsTable).values([
      {
        odooId: SERVICE_PRODUCT_ODOO_IDS[0]!,
        odooRef: `P${SERVICE_PRODUCT_ODOO_IDS[0]}`,
        nombre: "Producto con peso y volumen",
        pesoOdoo: 2.5,
        volumenOdoo: 0.25,
      },
      {
        odooId: SERVICE_PRODUCT_ODOO_IDS[1]!,
        odooRef: `P${SERVICE_PRODUCT_ODOO_IDS[1]}`,
        nombre: "Producto solo con peso",
        pesoOdoo: 1,
        volumenOdoo: null,
      },
    ]);

    const linkedSalePicking = picking(SERVICE_PICKING_IDS[0]!, {
      name: `TEST/OUT/${SERVICE_PICKING_IDS[0]}`,
      picking_type_id: [2, "Órdenes de entrega"],
      origin: `S${SERVICE_SALE_ODOO_IDS[0]}`,
      sale_id: [SERVICE_SALE_ODOO_IDS[0]!, "Venta vinculada"],
      location_dest_id: [9, "Clientes/Ubicaciones"],
    });
    const orphanSalePicking = picking(SERVICE_PICKING_IDS[1]!, {
      name: `TEST/OUT/${SERVICE_PICKING_IDS[1]}`,
      picking_type_id: [2, "Órdenes de entrega"],
      sale_id: [SERVICE_SALE_ODOO_IDS[1]!, "Venta aún no importada"],
      origin: `S${SERVICE_SALE_ODOO_IDS[1]}`,
      location_dest_id: [9, "Clientes/Ubicaciones"],
    });
    const measuredTransfer = picking(SERVICE_PICKING_IDS[2]!, {
      state: "assigned",
      move_ids: [SERVICE_MOVE_IDS[0]!, SERVICE_MOVE_IDS[1]!],
    });
    const draftSameOriginTransfer = picking(SERVICE_PICKING_IDS[3]!, {
      state: "draft",
      location_id: [7, "PREFIJO-NO-CONOCIDO/Existencias"],
      location_dest_id: [8, "PREFIJO-NO-CONOCIDO/Existencias"],
    });
    const moves = [
      move(SERVICE_MOVE_IDS[0]!, measuredTransfer.id, {
        product_id: [SERVICE_PRODUCT_ODOO_IDS[0]!, "Producto con peso y volumen"],
        product_uom_qty: 2,
        quantity: 0,
      }),
      move(SERVICE_MOVE_IDS[1]!, measuredTransfer.id, {
        product_id: [SERVICE_PRODUCT_ODOO_IDS[1]!, "Producto solo con peso"],
        product_uom_qty: 3,
        quantity: 0,
      }),
    ];
    configureOdoo(
      [
        linkedSalePicking,
        orphanSalePicking,
        measuredTransfer,
        draftSameOriginTransfer,
      ],
      moves,
    );

    const first = await syncDeliveries();
    expect(first).toMatchObject({
      created: 4,
      updated: 0,
      unmatched: 1,
      transfersCreated: 2,
      transfersUpdated: 0,
      intraplazaTransfers: 1,
      interplazaTransfers: 0,
      transfersWithWeight: 1,
      transfersWithVolume: 1,
      transfersByOdooState: { assigned: 1, draft: 1 },
      unknownWarehousePrefixes: ["PREFIJO-NO-CONOCIDO"],
    });

    const syncedDeliveries = await db
      .select()
      .from(deliveriesTable)
      .where(
        inArray(deliveriesTable.odooId, [
          linkedSalePicking.id,
          orphanSalePicking.id,
          measuredTransfer.id,
          draftSameOriginTransfer.id,
        ]),
      );
    const deliveryByOdooId = new Map(
      syncedDeliveries.map((delivery) => [delivery.odooId, delivery]),
    );
    expect(deliveryByOdooId.get(linkedSalePicking.id)).toMatchObject({
      tipo: "venta",
      ventaId: sale!.id,
    });
    expect(deliveryByOdooId.get(orphanSalePicking.id)).toMatchObject({
      tipo: "venta",
      ventaId: null,
    });
    expect(deliveryByOdooId.get(measuredTransfer.id)).toMatchObject({
      tipo: "traslado",
      ventaId: null,
      almacenOrigen: "Urbin/Existencias",
      almacenDestino: "CCS/Existencias",
      almacenCodigo: "Urbin",
      almacenDestinoCodigo: "CCS",
    });
    expect(deliveryByOdooId.get(draftSameOriginTransfer.id)).toMatchObject({
      tipo: "traslado",
      estado: "draft",
      almacenOrigen: "PREFIJO-NO-CONOCIDO/Existencias",
      almacenDestino: "PREFIJO-NO-CONOCIDO/Existencias",
    });

    const transfers = await db
      .select()
      .from(trasladosTable)
      .where(
        inArray(trasladosTable.odooPickingId, [
          measuredTransfer.id,
          draftSameOriginTransfer.id,
        ]),
      );
    const transferByOdooId = new Map(
      transfers.map((transfer) => [transfer.odooPickingId, transfer]),
    );
    expect(transferByOdooId.get(measuredTransfer.id)).toMatchObject({
      estadoLogistico: "por_planificar",
      pesoCalculadoKg: 8,
      volumenCalculadoM3: 0.5,
    });
    expect(transferByOdooId.get(measuredTransfer.id)?.almacenOrigenId).not.toBeNull();
    expect(transferByOdooId.get(measuredTransfer.id)?.almacenDestinoId).not.toBeNull();
    expect(transferByOdooId.get(draftSameOriginTransfer.id)).toMatchObject({
      almacenOrigenId: null,
      almacenDestinoId: null,
      estadoLogistico: "por_planificar",
      pesoCalculadoKg: null,
      volumenCalculadoM3: null,
    });

    const itemRows = await db
      .select()
      .from(deliveryItemsTable)
      .where(
        inArray(deliveryItemsTable.odooMoveId, [
          SERVICE_MOVE_IDS[0]!,
          SERVICE_MOVE_IDS[1]!,
        ]),
      );
    expect(itemRows).toHaveLength(2);
    expect(itemRows.map((item) => item.cantidadDemanda).sort()).toEqual([2, 3]);
    expect(itemRows.every((item) => item.cantidadEntregada === 0)).toBe(true);

    const second = await syncDeliveries();
    expect(second).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 4,
      itemsUpserted: 0,
      transfersCreated: 0,
      transfersUpdated: 0,
      orphanedTransfers: 0,
    });
    const transferCount = await db
      .select({ id: trasladosTable.id })
      .from(trasladosTable)
      .where(
        inArray(trasladosTable.odooPickingId, [
          measuredTransfer.id,
          draftSameOriginTransfer.id,
        ]),
      );
    expect(transferCount).toHaveLength(2);
  });

  it("never regresses local progress and treats done/cancel as authoritative", async () => {
    const transferPicking = picking(SERVICE_PICKING_IDS[4]!, {
      state: "assigned",
      write_date: "2031-01-01 10:00:00",
    });
    configureOdoo([transferPicking]);
    await syncDeliveries();

    await db
      .update(trasladosTable)
      .set({ estadoLogistico: "en_transito" })
      .where(eq(trasladosTable.odooPickingId, transferPicking.id));

    configureOdoo([
      {
        ...transferPicking,
        state: "waiting",
        write_date: "2031-01-02 10:00:00",
      },
    ]);
    await syncDeliveries();
    let [stored] = await db
      .select()
      .from(trasladosTable)
      .where(eq(trasladosTable.odooPickingId, transferPicking.id));
    expect(stored!.estadoLogistico).toBe("en_transito");

    configureOdoo([
      {
        ...transferPicking,
        state: "done",
        write_date: "2031-01-03 10:00:00",
      },
    ]);
    await syncDeliveries();
    [stored] = await db
      .select()
      .from(trasladosTable)
      .where(eq(trasladosTable.odooPickingId, transferPicking.id));
    expect(stored!.estadoLogistico).toBe("confirmado_odoo");

    configureOdoo([
      {
        ...transferPicking,
        state: "cancel",
        write_date: "2031-01-04 10:00:00",
      },
    ]);
    await syncDeliveries();
    [stored] = await db
      .select()
      .from(trasladosTable)
      .where(eq(trasladosTable.odooPickingId, transferPicking.id));
    expect(stored!.estadoLogistico).toBe("cancelado");
  });

  it("deletes a missing mirror and its items but preserves the orphaned transfer", async () => {
    const transferPicking = picking(SERVICE_PICKING_IDS[5]!, {
      move_ids: [SERVICE_MOVE_IDS[2]!],
    });
    configureOdoo(
      [transferPicking],
      [move(SERVICE_MOVE_IDS[2]!, transferPicking.id)],
    );
    await syncDeliveries();

    configureOdoo([], [], []);
    const result = await syncDeliveries();
    expect(result).toMatchObject({
      deleted: 1,
      orphanedTransfers: 1,
    });

    const delivery = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.odooId, transferPicking.id));
    expect(delivery).toHaveLength(0);
    const items = await db
      .select()
      .from(deliveryItemsTable)
      .where(eq(deliveryItemsTable.odooMoveId, SERVICE_MOVE_IDS[2]!));
    expect(items).toHaveLength(0);
    const [transfer] = await db
      .select()
      .from(trasladosTable)
      .where(eq(trasladosTable.odooPickingId, transferPicking.id));
    expect(transfer).toMatchObject({
      deliveryId: null,
      odooPickingId: transferPicking.id,
    });
  });

  it("backfills all internal history idempotently without contaminating the normal watermark", async () => {
    const [sale] = await db
      .insert(salesTable)
      .values({
        cliente: "Venta que fija watermark",
        destino: "Caracas",
        odooId: SERVICE_SALE_ODOO_IDS[0],
        odooRef: `S${SERVICE_SALE_ODOO_IDS[0]}`,
      })
      .returning({ id: salesTable.id });
    const watermarkPickingId = SERVICE_PICKING_IDS[6]!;
    await db.insert(deliveriesTable).values({
      ventaId: sale!.id,
      tipo: "venta",
      odooId: watermarkPickingId,
      nombre: `TEST/OUT/${watermarkPickingId}`,
      estado: "assigned",
      odooWriteDate: "2099-01-01 00:00:00",
    });

    const historicalTransfer = picking(SERVICE_PICKING_IDS[7]!, {
      write_date: "2199-01-01 00:00:00",
    });
    const saleLinkedInternal = picking(SERVICE_PICKING_IDS[8]!, {
      name: `TEST/INT-SALE/${SERVICE_PICKING_IDS[8]}`,
      sale_id: [SERVICE_SALE_ODOO_IDS[0]!, "Venta vinculada"],
      origin: `S${SERVICE_SALE_ODOO_IDS[0]}`,
      write_date: "2199-01-01 00:00:00",
    });
    configureOdoo(
      [historicalTransfer, saleLinkedInternal],
      [],
      [historicalTransfer.id, saleLinkedInternal.id],
    );
    const first = await backfillInternalTransfers();
    expect(first).toMatchObject({
      created: 1,
      transfersCreated: 1,
    });
    expect(observedSearchReadDomains[0]).toEqual([
      ["picking_type_id.code", "in", ["internal"]],
      ["sale_id", "=", false],
      ["id", ">", 0],
    ]);
    expect(observedSearchDomains[0]).toEqual([
      ["picking_type_id.code", "in", ["internal"]],
      ["sale_id", "=", false],
    ]);

    const [historicalDelivery] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.odooId, historicalTransfer.id));
    expect(historicalDelivery!.odooWriteDate).toBeNull();
    const saleLinkedInternalMirror = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.odooId, saleLinkedInternal.id));
    expect(saleLinkedInternalMirror).toHaveLength(0);
    const saleMirrorAfterBackfill = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.odooId, watermarkPickingId));
    expect(saleMirrorAfterBackfill).toHaveLength(1);

    const second = await backfillInternalTransfers();
    expect(second).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 1,
      transfersCreated: 0,
      transfersUpdated: 0,
    });

    configureOdoo(
      [historicalTransfer],
      [],
      [watermarkPickingId, historicalTransfer.id],
    );
    const firstNormal = await syncDeliveries();
    expect(observedSearchReadDomains[0]).toEqual([
      ["picking_type_id.code", "in", ["outgoing", "internal"]],
      ["id", ">", 0],
      ["write_date", ">=", "2099-01-01 00:00:00"],
    ]);
    expect(firstNormal).toMatchObject({
      created: 0,
      updated: 1,
      transfersCreated: 0,
      transfersUpdated: 1,
      deleted: 0,
    });

    const secondNormal = await syncDeliveries();
    expect(secondNormal).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 1,
      transfersCreated: 0,
      transfersUpdated: 0,
      deleted: 0,
    });
    const preservedDeliveries = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.odooId, historicalTransfer.id));
    const preservedTransfers = await db
      .select({ id: trasladosTable.id })
      .from(trasladosTable)
      .where(eq(trasladosTable.odooPickingId, historicalTransfer.id));
    expect(preservedDeliveries).toHaveLength(1);
    expect(preservedTransfers).toHaveLength(1);
  });
});
