import { describe, expect, it } from "vitest";
import { deriveSyncStatusVisibility } from "../../artifacts/logistics/src/components/odoo-sync-status";

describe("Odoo sync status visibility", () => {
  it("warns when a sync has never run", () => {
    expect(deriveSyncStatusVisibility({ result: null, completedAt: null })).toEqual({
      running: false,
      neverSynced: true,
      stale: false,
    });
  });

  it("does not call an active first run never-synced", () => {
    expect(
      deriveSyncStatusVisibility({
        result: "running",
        completedAt: null,
        stale: false,
      }),
    ).toEqual({
      running: true,
      neverSynced: false,
      stale: false,
    });
  });

  it("detects a stale first run from the backend flag", () => {
    expect(
      deriveSyncStatusVisibility({
        result: "running",
        completedAt: null,
        stale: true,
      }),
    ).toEqual({
      running: true,
      neverSynced: false,
      stale: true,
    });
  });

  it("does not invent staleness from a client-side age threshold", () => {
    expect(
      deriveSyncStatusVisibility({
        result: "ok",
        completedAt: "2000-01-01T00:00:00.000Z",
        stale: false,
      }).stale,
    ).toBe(false);
  });
});