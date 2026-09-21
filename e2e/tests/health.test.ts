import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseReady } from "../../artifacts/api-server/src/services/health";

afterEach(() => {
  vi.useRealTimers();
});

describe("database readiness", () => {
  it("reports ready when the database probe succeeds", async () => {
    await expect(isDatabaseReady(async () => undefined, 100)).resolves.toBe(true);
  });

  it("reports not ready without leaking a database error", async () => {
    await expect(
      isDatabaseReady(async () => {
        throw new Error("secret connection detail");
      }, 100),
    ).resolves.toBe(false);
  });

  it("bounds a stalled database probe", async () => {
    vi.useFakeTimers();
    const readiness = isDatabaseReady(
      () => new Promise(() => undefined),
      100,
    );

    await vi.advanceTimersByTimeAsync(100);

    await expect(readiness).resolves.toBe(false);
  });
});