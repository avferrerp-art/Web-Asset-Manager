import { pool } from "@workspace/db";

const DEFAULT_READINESS_TIMEOUT_MS = 1_500;

export type DatabaseProbe = () => Promise<unknown>;

let databaseProbeInFlight: Promise<unknown> | null = null;

function defaultDatabaseProbe(): Promise<unknown> {
  if (!databaseProbeInFlight) {
    databaseProbeInFlight = pool.query("SELECT 1").finally(() => {
      databaseProbeInFlight = null;
    });
  }
  return databaseProbeInFlight;
}

/**
 * Readiness is intentionally limited to dependencies required to serve API
 * traffic. Odoo is an external sync source and must never make the API
 * unready (or trigger a restart) when it is unavailable.
 */
export async function isDatabaseReady(
  probe: DatabaseProbe = defaultDatabaseProbe,
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Readiness probe timed out")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}