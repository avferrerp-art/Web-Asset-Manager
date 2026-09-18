import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const executeKwMock = vi.hoisted(() => vi.fn());
vi.mock("../../artifacts/api-server/src/lib/odooClient", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../artifacts/api-server/src/lib/odooClient")
  >();
  return {
    ...actual,
    getOdooConfig: () => ({
      url: "http://odoo.quotations.test",
      db: "test",
      username: "test",
      apiKey: "test",
    }),
    authenticate: async () => 1,
    executeKw: (...args: unknown[]) => executeKwMock(...args),
  };
});

import { syncOdooOrders } from "../../artifacts/api-server/src/services/odooSync";
import {
  db,
  productsTable,
  runMigrations,
  saleItemsTable,
  salesTable,
  syncAlertsTable,
} from "@workspace/db";

type CommercialState = "draft" | "sent" | "sale" | "done";
interface RemoteOrder {
  id: number;
  name: string;
  state: CommercialState;
  partner_id: [number, string] | false;
  partner_shipping_id: false;
  user_id: false;
  note: false;
  order_line: number[];
  write_date: string;
}

const BASE = 810_000_000 + Math.floor(Math.random() * 100_000);
const PRODUCT_ODOO_ID = BASE + 90_000;
const NO_CATALOG_PRODUCT_ODOO_ID = BASE + 90_001;
const touchedOdooIds = Array.from({ length: 240 }, (_, index) => BASE + index + 1);
let productId: number;
let remoteOrders: RemoteOrder[] = [];
let remoteLines: Array<{
  id: number;
  order_id: [number, string];
  product_id: [number, string] | false;
  product_uom_qty: number;
}> = [];

function order(
  offset: number,
  state: CommercialState,
  overrides: Partial<RemoteOrder> = {},
): RemoteOrder {
  const id = BASE + offset;
  return {
    id,
    name: `Q-${id}`,
    state,
    partner_id: [id + 500_000, `Cliente ${id}`],
    partner_shipping_id: false,
    user_id: false,
    note: false,
    order_line: [],
    write_date: "2035-01-01 10:00:00",
    ...overrides,
  };
}

function line(
  remoteOrder: RemoteOrder,
  idOffset: number,
  quantity = 2,
  remoteProductId = PRODUCT_ODOO_ID,
) {
  return {
    id: BASE + 300_000 + idOffset,
    order_id: [remoteOrder.id, remoteOrder.name] as [number, string],
    product_id: [remoteProductId, "Producto cotización"] as [number, string],
    product_uom_qty: quantity,
  };
}

function configureOdoo(orders: RemoteOrder[], lines: typeof remoteLines = []): void {
  remoteOrders = orders;
  remoteLines = lines;
  executeKwMock.mockImplementation(
    async (
      _config: unknown,
      _uid: unknown,
      model: string,
      method: string,
      args: unknown[],
      kwargs?: { fields?: string[]; limit?: number },
    ) => {
      if (model === "sale.order" && method === "search_read") {
        const domain = (args[0] as unknown[][]) ?? [];
        const idClause = domain.find(
          (clause) => Array.isArray(clause) && clause[0] === "id" && clause[1] === ">",
        );
        const lastId = Number(idClause?.[2] ?? 0);
        return remoteOrders
          .filter((candidate) => candidate.id > lastId)
          .sort((a, b) => a.id - b.id)
          .slice(0, kwargs?.limit ?? 200);
      }
      if (model === "sale.order.line" && method === "read") {
        const ids = new Set(args[0] as number[]);
        return remoteLines.filter((candidate) => ids.has(candidate.id));
      }
      if (model === "product.product" && method === "read") {
        return (args[0] as number[]).map((id) => ({ id, weight: 5, volume: 0.25 }));
      }
      throw new Error(`Unexpected Odoo call: ${model}.${method}`);
    },
  );
}

async function localSale(odooId: number) {
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.odooId, odooId));
  expect(sale).toBeDefined();
  return sale!;
}

async function importOrder(remoteOrder: RemoteOrder, quantity = 2) {
  const remoteLine = line(remoteOrder, remoteOrder.id - BASE, quantity);
  remoteOrder.order_line = [remoteLine.id];
  configureOdoo([remoteOrder], [remoteLine]);
  await syncOdooOrders();
  return {
    sale: await localSale(remoteOrder.id),
    item: (
      await db
        .select()
        .from(saleItemsTable)
        .where(eq(saleItemsTable.ventaId, (await localSale(remoteOrder.id)).id))
    )[0]!,
  };
}

beforeAll(async () => {
  await runMigrations();
  [productId] = (
    await db
      .insert(productsTable)
      .values({
        odooId: PRODUCT_ODOO_ID,
        odooRef: `QUOTE-PRODUCT-${BASE}`,
        nombre: "Producto cotización",
        pesoOdoo: 5,
        volumenOdoo: 0.25,
      })
      .returning({ id: productsTable.id })
  ).map((row) => row.id);
});

afterEach(async () => {
  executeKwMock.mockReset();
  remoteOrders = [];
  remoteLines = [];
  await db.delete(salesTable).where(inArray(salesTable.odooId, touchedOdooIds));
});

afterAll(async () => {
  await db.delete(productsTable).where(eq(productsTable.id, productId));
});

describe("Odoo quotation synchronization", () => {
  it("requests all supported states and state field while preserving id pagination", async () => {
    const orders = Array.from({ length: 201 }, (_, index) =>
      order(index + 1, (["draft", "sent", "sale", "done"] as const)[index % 4]!),
    );
    configureOdoo(orders);

    const result = await syncOdooOrders({ dryRun: true });
    expect(result.imported).toBe(201);
    expect(
      await db.select().from(salesTable).where(inArray(salesTable.odooId, orders.map((row) => row.id))),
    ).toHaveLength(0);

    const calls = executeKwMock.mock.calls.filter(
      (call) => call[2] === "sale.order" && call[3] === "search_read",
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const domain = (call[4] as unknown[][])[0] as unknown[];
      expect(domain).toContainEqual(["state", "in", ["draft", "sent", "sale", "done"]]);
      expect((call[5] as { fields: string[] }).fields).toContain("state");
    }
    expect(((calls[1]![4] as unknown[][])[0] as unknown[])).toContainEqual([
      "id",
      ">",
      orders[199]!.id,
    ]);
  });

  it.each(["draft", "sent"] as const)("inserts %s orders, items, and commercial state", async (state) => {
    const remote = order(state === "draft" ? 210 : 211, state);
    const { sale, item } = await importOrder(remote);
    expect(sale.odooEstado).toBe(state);
    expect(sale.estado).toBe("pendiente");
    expect(item.productId).toBe(productId);
    expect(item.cantidad).toBe(2);
  });

  it("converts a pending quotation into the same sale without replacing unchanged items", async () => {
    const remote = order(212, "draft");
    const before = await importOrder(remote);

    remote.state = "sale";
    remote.write_date = "2035-01-02 10:00:00";
    configureOdoo([remote], remoteLines);
    const result = await syncOdooOrders();

    const after = await localSale(remote.id);
    const [afterItem] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.ventaId, after.id));
    expect(after.id).toBe(before.sale.id);
    expect(after.odooEstado).toBe("sale");
    expect(afterItem!.id).toBe(before.item.id);
    expect(result.alertsCreated).toBe(0);
  });

  it("preserves unchanged item identity when its Odoo product is absent from the local catalog", async () => {
    const remote = order(218, "draft");
    const remoteLine = line(remote, 218, 2, NO_CATALOG_PRODUCT_ODOO_ID);
    remote.order_line = [remoteLine.id];
    configureOdoo([remote], [remoteLine]);
    await syncOdooOrders();

    const beforeSale = await localSale(remote.id);
    const [beforeItem] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.ventaId, beforeSale.id));
    expect(beforeItem!.productId).toBeNull();

    remote.state = "sale";
    remote.write_date = "2035-01-02 11:00:00";
    configureOdoo([remote], [remoteLine]);
    await syncOdooOrders();

    const afterSale = await localSale(remote.id);
    const [afterItem] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.ventaId, afterSale.id));
    expect(afterSale.id).toBe(beforeSale.id);
    expect(afterSale.odooEstado).toBe("sale");
    expect(afterItem!.id).toBe(beforeItem!.id);
  });

  it("applies ordinary edits to pending quotations without creating alerts", async () => {
    const remote = order(213, "draft");
    const before = await importOrder(remote);
    remote.state = "sent";
    remote.partner_id = [remote.id + 500_000, "Cliente cotización editado"];
    remote.write_date = "2035-01-03 10:00:00";
    configureOdoo([remote], remoteLines);

    const result = await syncOdooOrders();
    const after = await localSale(remote.id);
    const alerts = await db
      .select()
      .from(syncAlertsTable)
      .where(eq(syncAlertsTable.ventaId, before.sale.id));
    expect(after.cliente).toBe("Cliente cotización editado");
    expect(after.odooEstado).toBe("sent");
    expect(result.alertsCreated).toBe(0);
    expect(alerts).toHaveLength(0);
  });

  it("corrects commercial state even when Odoo write_date is unchanged", async () => {
    const remote = order(214, "sale");
    const before = await importOrder(remote);
    await db
      .update(salesTable)
      .set({ odooEstado: "draft" })
      .where(eq(salesTable.id, before.sale.id));
    configureOdoo([remote], remoteLines);

    await syncOdooOrders();
    expect((await localSale(remote.id)).odooEstado).toBe("sale");
  });

  it("updates a commercial-only change on a non-pending sale without an alert", async () => {
    const remote = order(215, "draft");
    const before = await importOrder(remote);
    await db
      .update(salesTable)
      .set({ estado: "despachado" })
      .where(eq(salesTable.id, before.sale.id));
    remote.state = "sale";
    configureOdoo([remote], remoteLines);

    const result = await syncOdooOrders();
    expect((await localSale(remote.id)).odooEstado).toBe("sale");
    expect(result.alertsCreated).toBe(0);
    expect(
      await db.select().from(syncAlertsTable).where(eq(syncAlertsTable.ventaId, before.sale.id)),
    ).toHaveLength(0);
  });

  it("mirrors commercial state but still guards other edits on non-pending sales", async () => {
    const remote = order(216, "draft");
    const before = await importOrder(remote);
    await db
      .update(salesTable)
      .set({ estado: "despachado" })
      .where(eq(salesTable.id, before.sale.id));
    remote.state = "sale";
    remote.partner_id = [remote.id + 500_000, "Cambio bloqueado"];
    remote.write_date = "2035-01-04 10:00:00";
    configureOdoo([remote], remoteLines);

    const result = await syncOdooOrders();
    const after = await localSale(remote.id);
    expect(after.odooEstado).toBe("sale");
    expect(after.cliente).toBe(before.sale.cliente);
    expect(result.alertsCreated).toBe(1);
  });

  it("reports dry-run transitions without writing sale state, timestamps, items, or alerts", async () => {
    const remote = order(217, "draft");
    const before = await importOrder(remote);
    remote.state = "sale";
    remote.partner_id = [remote.id + 500_000, "Cambio dry-run"];
    remote.write_date = "2035-01-05 10:00:00";
    const changedLine = line(remote, 217, 9);
    remote.order_line = [changedLine.id];
    configureOdoo([remote], [changedLine]);

    const result = await syncOdooOrders({ dryRun: true });
    const after = await localSale(remote.id);
    const [afterItem] = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.ventaId, after.id));
    expect(result.dryRun).toBe(true);
    expect(after.odooEstado).toBe("draft");
    expect(after.cliente).toBe(before.sale.cliente);
    expect(after.odooWriteDate).toBe(before.sale.odooWriteDate);
    expect(afterItem!.cantidad).toBe(before.item.cantidad);
    expect(
      await db.select().from(syncAlertsTable).where(eq(syncAlertsTable.ventaId, before.sale.id)),
    ).toHaveLength(0);
  });
});