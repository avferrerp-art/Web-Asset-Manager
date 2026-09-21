import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startOdooPolling, stopOdooPolling } from "./services/odooSync";

startOdooPolling({ ignoreEmbeddedDisable: true });
logger.info("Worker de sincronización Odoo iniciado");

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Deteniendo worker de sincronización Odoo");
  stopOdooPolling();
  await pool.end();
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));