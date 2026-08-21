import { runMigrations, verifySchema } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { startOdooPolling } from "./services/odooSync";
import { reconcileSaleEstados } from "./services/saleEstadoSync";
import { reconcileTrasladoEstados } from "./services/trasladoEstadoSync";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function prepareDatabase(): Promise<void> {
  // 1) Apply pending embedded migrations (lib/db/src/migrations).
  try {
    const result = await runMigrations();
    if (result.applied.length > 0) {
      logger.info({ applied: result.applied }, "Database migrations applied");
    } else {
      logger.info("Database migrations up to date");
    }
  } catch (err) {
    // Fail hard: running with a half-migrated schema causes opaque 500s later.
    logger.error({ err }, "Database migration failed — refusing to start");
    process.exit(1);
  }

  // 2) Verify critical columns/constraints and report anything missing.
  try {
    const problems = await verifySchema();
    if (problems.length === 0) {
      logger.info("Schema verification passed: all expected tables, columns and unique constraints present");
    } else {
      for (const p of problems) {
        logger.error(
          { table: p.table, kind: p.kind },
          `SCHEMA MISMATCH: ${p.detail}. Fix: add a migration in lib/db/src/migrations (see replit.md Gotchas).`,
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Schema verification could not run");
  }
}

await prepareDatabase();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startOdooPolling();
  void reconcileSaleEstados().catch((err) =>
    logger.error({ err }, "Reconciliación de estados de venta falló"),
  );
  void reconcileTrasladoEstados().catch((err) =>
    logger.error({ err }, "Reconciliación de estados de traslado falló"),
  );
});
