import { AsyncLocalStorage } from "node:async_hooks";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { OdooError } from "../lib/odooClient";

const LOCK_NAMESPACE = 0x4c4f4749; // "LOGI"
const LOCK_RESOURCE = 0x4f444f4f; // "ODOO"
const LOCK_ATTEMPTS = 6;
const LOCK_RETRY_MS = 250;
const OPERATION_ATTEMPTS = 3;

const lockContext = new AsyncLocalStorage<boolean>();

export class OdooSyncBusyError extends Error {
  constructor() {
    super("Otra sincronización de Odoo está en ejecución; intente nuevamente en unos segundos.");
    this.name = "OdooSyncBusyError";
  }
}

export class OdooSyncLockLostError extends Error {
  constructor() {
    super("Se perdió el bloqueo de coordinación durante la sincronización de Odoo.");
    this.name = "OdooSyncLockLostError";
  }
}

export function odooSyncHttpStatus(error: unknown): 400 | 409 | 500 {
  if (error instanceof OdooSyncBusyError) return 409;
  if (error instanceof OdooError) return 400;
  return 500;
}

export interface CoordinationOptions {
  operation: string;
  retryTransient?: boolean;
  /**
   * Test seam only. Production deliberately terminates the process when the
   * lock-owning PostgreSQL session dies: work uses other pooled sessions and
   * cannot otherwise be cancelled/fenced safely.
   */
  onLockLost?: (error: OdooSyncLockLostError) => never;
  /** Test-only override; production uses the bounded constants above. */
  lockAttempts?: number;
  /** Test-only override; production uses the bounded constants above. */
  lockRetryMs?: number;
}

export function isTransientOdooError(error: unknown): boolean {
  if (!(error instanceof OdooError)) return false;
  return (
    error.message.includes("No se pudo conectar al servidor Odoo") ||
    /respondió HTTP (?:408|425|429|5\d\d)\b/.test(error.message)
  );
}

export async function retryTransientOperation<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? OPERATION_ATTEMPTS;
  const delayMs = options.delayMs ?? 500;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientOdooError(error)) throw error;
      await delay(delayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

/**
 * Serializes every Odoo mutation across processes with a session advisory lock.
 * The checked-out connection is held for the complete operation. Nested calls
 * reuse the outer coordination scope, allowing a full orders→deliveries cycle
 * to remain atomic with respect to other sync triggers.
 */
export async function coordinateOdooOperation<T>(
  options: CoordinationOptions,
  operation: () => Promise<T>,
): Promise<T> {
  if (lockContext.getStore()) {
    return options.retryTransient === false
      ? operation()
      : retryTransientOperation(operation);
  }

  const client = await pool.connect();
  let acquired = false;
  let lockLost = false;
  let rejectLockLoss: ((error: Error) => void) | undefined;
  const lockLoss = new Promise<never>((_resolve, reject) => {
    rejectLockLoss = reject;
  });
  // A checked-out pg client emits error when its session dies. PostgreSQL then
  // releases the advisory lock, so continuing would no longer be exclusive.
  const onClientError = () => {
    if (!acquired || lockLost) return;
    lockLost = true;
    const error = new OdooSyncLockLostError();
    rejectLockLoss?.(error);

    // Promise.race alone is NOT a cancellation mechanism. The sync's writes use
    // other pool sessions and could continue after PostgreSQL released this
    // session lock. Fail-stop is therefore the only safe response without
    // routing every sync query through this client: synchronous process.exit
    // prevents any further side effects before another instance can proceed.
    if (options.onLockLost) options.onLockLost(error);
    logger.fatal(
      { err: error, operation: options.operation },
      "Sesión del bloqueo Odoo perdida; terminando el proceso para preservar exclusión",
    );
    process.exit(70);
  };
  client.on("error", onClientError);

  try {
    const lockAttempts = options.lockAttempts ?? LOCK_ATTEMPTS;
    const lockRetryMs = options.lockRetryMs ?? LOCK_RETRY_MS;
    for (let attempt = 1; attempt <= lockAttempts; attempt++) {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS acquired",
        [LOCK_NAMESPACE, LOCK_RESOURCE],
      );
      acquired = result.rows[0]?.acquired === true;
      if (acquired) break;
      if (attempt < lockAttempts) await delay(lockRetryMs);
    }
    if (!acquired) throw new OdooSyncBusyError();

    logger.info({ operation: options.operation }, "Bloqueo global de sincronización Odoo adquirido");
    const work = lockContext.run(true, () =>
      options.retryTransient === false
        ? operation()
        : retryTransientOperation(operation),
    );
    const result = await Promise.race([work, lockLoss]);

    // Detect a session that was lost without an emitted error before returning
    // success. This query also proves the dedicated lock connection is alive.
    await client.query("SELECT 1");
    if (lockLost) throw new OdooSyncLockLostError();
    return result;
  } finally {
    client.off("error", onClientError);
    if (acquired && !lockLost) {
      try {
        const unlocked = await client.query<{ unlocked: boolean }>(
          "SELECT pg_advisory_unlock($1, $2) AS unlocked",
          [LOCK_NAMESPACE, LOCK_RESOURCE],
        );
        if (unlocked.rows[0]?.unlocked !== true) {
          logger.error({ operation: options.operation }, "El bloqueo Odoo no pudo liberarse limpiamente");
        }
      } catch (error) {
        lockLost = true;
        logger.error({ err: error, operation: options.operation }, "Falló la liberación del bloqueo Odoo");
      }
    }
    client.release(lockLost);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}