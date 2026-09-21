import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clients: FakeClient[] = [];
let advisoryLockAvailable = true;

class FakeClient extends EventEmitter {
  locked = false;
  releasedWithError: boolean | undefined;
  query = vi.fn(async (text: string) => {
    if (text.includes("pg_try_advisory_lock")) {
      this.locked = advisoryLockAvailable;
      return { rows: [{ acquired: advisoryLockAvailable }] };
    }
    if (text.includes("pg_advisory_unlock")) {
      this.locked = false;
      return { rows: [{ unlocked: true }] };
    }
    return { rows: [{ "?column?": 1 }] };
  });
  release(error?: boolean) {
    this.releasedWithError = error;
  }
}

vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn(async () => {
      const client = new FakeClient();
      clients.push(client);
      return client;
    }),
  },
}));

vi.mock("../../artifacts/api-server/src/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { OdooError } from "../../artifacts/api-server/src/lib/odooClient";
import {
  coordinateOdooOperation,
  isTransientOdooError,
  retryTransientOperation,
} from "../../artifacts/api-server/src/services/synchronizationCoordinator";

describe("Odoo synchronization coordinator", () => {
  beforeEach(() => {
    clients.length = 0;
    advisoryLockAvailable = true;
    vi.clearAllMocks();
  });

  it("holds a dedicated advisory-lock connection and releases it after work", async () => {
    let observedLocked = false;
    const value = await coordinateOdooOperation({ operation: "test", retryTransient: false }, async () => {
      observedLocked = clients[0]?.locked === true;
      return 42;
    });

    expect(value).toBe(42);
    expect(observedLocked).toBe(true);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.locked).toBe(false);
    expect(clients[0]?.releasedWithError).toBe(false);
  });

  it("uses one lock for nested coordinated operations", async () => {
    await coordinateOdooOperation({ operation: "cycle", retryTransient: false }, async () => {
      await coordinateOdooOperation({ operation: "orders", retryTransient: false }, async () => undefined);
      await coordinateOdooOperation({ operation: "deliveries", retryTransient: false }, async () => undefined);
    });

    expect(clients).toHaveLength(1);
    expect(clients[0]?.query).toHaveBeenCalledTimes(3); // lock, liveness check, unlock
  });

  it("retries only bounded transient Odoo transport errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new OdooError("El servidor Odoo respondió HTTP 503 en /jsonrpc"))
      .mockResolvedValue("ok");

    await expect(
      retryTransientOperation(operation, { attempts: 3, delayMs: 0 }),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);

    const businessError = new OdooError("Error de Odoo: acceso denegado");
    expect(isTransientOdooError(businessError)).toBe(false);
    const rejected = vi.fn(async () => {
      throw businessError;
    });
    await expect(
      retryTransientOperation(rejected, { attempts: 3, delayMs: 0 }),
    ).rejects.toBe(businessError);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("fails closed before work can write after the lock session is lost", async () => {
    let writesAfterLoss = 0;
    const run = coordinateOdooOperation(
      {
        operation: "lock-loss",
        retryTransient: false,
        onLockLost: (error) => {
          throw error;
        },
      },
      async () => {
        await Promise.resolve();
        clients[0]?.emit("error", new Error("connection reset"));
        writesAfterLoss++;
      },
    );

    await expect(run).rejects.toMatchObject({ name: "OdooSyncLockLostError" });
    expect(writesAfterLoss).toBe(0);
    expect(clients[0]?.releasedWithError).toBe(true);
  });

  it("does not invoke work or status side effects when the lock is busy", async () => {
    advisoryLockAvailable = false;
    const work = vi.fn(async () => "should not run");

    await expect(
      coordinateOdooOperation(
        {
          operation: "busy",
          retryTransient: false,
          lockAttempts: 2,
          lockRetryMs: 0,
        },
        work,
      ),
    ).rejects.toMatchObject({ name: "OdooSyncBusyError" });

    expect(work).not.toHaveBeenCalled();
    expect(clients[0]?.releasedWithError).toBe(false);
  });

  it("stops after the configured transient retry budget is exhausted", async () => {
    const unavailable = vi.fn(async () => {
      throw new OdooError("El servidor Odoo respondió HTTP 503 en /jsonrpc");
    });

    await expect(
      retryTransientOperation(unavailable, { attempts: 3, delayMs: 0 }),
    ).rejects.toBeInstanceOf(OdooError);
    expect(unavailable).toHaveBeenCalledTimes(3);
  });
});