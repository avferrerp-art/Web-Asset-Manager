import { runMigrations, verifySchema } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { startOdooPolling } from "./services/odooSync";
import { reconcileSaleEstados } from "./services/saleEstadoSync";
import { reconcileTrasladoEstados } from "./services/trasladoEstadoSync";
import { reconcileViajeEstados } from "./services/viajeEstadoSync";

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
  // Replit Publish owns production DDL. Embedded migrations are a development
  // convenience only; running them during production boot can race instances
  // and bypass Publish's schema-diff safety checks.
  if (process.env.NODE_ENV === "development") {
    try {
      const result = await runMigrations();
      if (result.applied.length > 0) {
        logger.info({ applied: result.applied }, "Development database migrations applied");
      } else {
        logger.info("Development database migrations up to date");
      }
    } catch (err) {
      logger.error({ err }, "Development database migration failed — refusing to start");
      throw err;
    }
  } else {
    logger.info(
      { nodeEnv: process.env.NODE_ENV ?? "unset" },
      "Skipping startup migrations; schema changes are applied by Publish",
    );
  }

  // Verification is read-only and mandatory in every environment. Never serve
  // traffic against a schema that does not match the application.
  try {
    const problems = await verifySchema();
    if (problems.length === 0) {
      logger.info("Schema verification passed: all expected tables, columns and unique constraints present");
    } else {
      for (const p of problems) {
        logger.error(
          { table: p.table, kind: p.kind },
          `SCHEMA MISMATCH: ${p.detail}. Refusing to start; update the development schema and re-publish so Publish applies the production schema diff.`,
        );
      }
      throw new Error(`Schema verification found ${problems.length} problem(s)`);
    }
  } catch (err) {
    logger.error({ err }, "Schema verification failed — refusing to start");
    throw err;
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
  void reconcileViajeEstados().catch((err) =>
    logger.error({ err }, "Reconciliación de estados de viaje falló"),
  );
});
