import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, isNull } from "drizzle-orm";
import {
  almacenesTable,
  db,
  deliveriesTable,
  pool,
  runMigrations,
  salesTable,
  trasladosTable,
} from "@workspace/db";
import { sql as trasladosMigrationSql } from "../../lib/db/src/migrations/0008_traslados";

const BASE = 92_100_000 + Math.floor(Math.random() * 1000) * 100;
const ODOO_IDS = [BASE + 1, BASE + 2];
let saleId: number | null = null;

beforeAll(async () => {
  await runMigrations();
  await pool.query(trasladosMigrationSql);
  await pool.query(trasladosMigrationSql);
});

afterAll(async () => {
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
