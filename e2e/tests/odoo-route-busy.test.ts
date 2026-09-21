import { describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  syncOrders: vi.fn(),
  syncDeliveries: vi.fn(),
  recordOrdersError: vi.fn(),
  recordDeliveriesError: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {},
  syncAlertsTable: {},
}));

vi.mock("../../artifacts/api-server/src/services/odooSync", () => ({
  getSyncState: vi.fn(),
  recordSyncError: serviceMocks.recordOrdersError,
  syncOdooOrders: serviceMocks.syncOrders,
  testOdooConnection: vi.fn(),
}));

vi.mock("../../artifacts/api-server/src/services/deliverySync", () => ({
  syncDeliveries: serviceMocks.syncDeliveries,
  backfillInternalTransfers: vi.fn(),
  recordDeliverySyncError: serviceMocks.recordDeliveriesError,
}));

vi.mock("../../artifacts/api-server/src/services/productBackfill", () => ({
  backfillSaleItemProducts: vi.fn(),
}));
vi.mock("../../artifacts/api-server/src/services/destinoBackfill", () => ({
  backfillDestinos: vi.fn(),
}));
vi.mock("../../artifacts/api-server/src/services/deliveryEstado", () => ({
  recomputeDeliveryDerivedState: vi.fn(),
}));
vi.mock("../../artifacts/api-server/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import router from "../../artifacts/api-server/src/routes/odoo";
import { OdooSyncBusyError } from "../../artifacts/api-server/src/services/synchronizationCoordinator";

type Handler = (
  req: { query: Record<string, string>; log: { error: ReturnType<typeof vi.fn> } },
  res: {
    status: (code: number) => unknown;
    json: (body: unknown) => unknown;
  },
  next: () => void,
) => Promise<void>;

function handlerFor(path: string): Handler {
  const layer = (router as unknown as { stack: Array<{
    route?: { path: string; stack: Array<{ handle: Handler }> };
  }> }).stack.find((candidate) => candidate.route?.path === path);
  if (!layer?.route) throw new Error(`Route ${path} not found`);
  return layer.route.stack[0]!.handle;
}

async function invoke(path: string) {
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      body = value;
      return res;
    },
  };
  await handlerFor(path)(
    { query: {}, log: { error: vi.fn() } },
    res,
    () => undefined,
  );
  return { status, body };
}

describe("Odoo manual routes while another instance owns the lock", () => {
  it("returns 409 for order sync without overwriting persisted status", async () => {
    serviceMocks.syncOrders.mockRejectedValueOnce(new OdooSyncBusyError());

    const response = await invoke("/odoo/sync");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ ok: false });
    expect(serviceMocks.recordOrdersError).not.toHaveBeenCalled();
  });

  it("returns 409 for delivery sync without overwriting persisted status", async () => {
    serviceMocks.syncDeliveries.mockRejectedValueOnce(new OdooSyncBusyError());

    const response = await invoke("/odoo/sync-deliveries");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ ok: false });
    expect(serviceMocks.recordDeliveriesError).not.toHaveBeenCalled();
  });
});