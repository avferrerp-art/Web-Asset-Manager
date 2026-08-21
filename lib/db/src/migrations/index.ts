// Ordered list of embedded SQL migrations. Each module exports { name, sql }.
//
// HOW TO ADD A MIGRATION (when lib/db/src/schema changes):
// 1. Create lib/db/src/migrations/NNNN_short_description.ts (next sequential
//    number) exporting `name` (must match the filename, minus .ts) and `sql`.
//    Write idempotent DDL (IF NOT EXISTS / guarded constraints) — task-branch
//    databases may already have parts of it from `drizzle-kit push`.
// 2. Append the module to the `migrations` array below, in order.
// 3. Restart the api-server workflow: migrations run automatically at boot
//    and are tracked in the `_migrations` table (applied once per database).
import * as baseline from "./0000_baseline";
import * as odooWriteDateSyncAlerts from "./0001_odoo_write_date_sync_alerts";
import * as deliveries from "./0002_deliveries";
import * as syncStateDeliveries from "./0003_sync_state_deliveries";
import * as salesEstadoEntrega from "./0004_sales_estado_entrega";
import * as salesTotalesNullable from "./0005_sales_totales_nullable";
import * as almacenes from "./0006_almacenes";
import * as almacenesNombres from "./0007_almacenes_nombres";
import * as traslados from "./0008_traslados";
import * as productMeasurements from "./0009_product_measurements";

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  baseline,
  odooWriteDateSyncAlerts,
  deliveries,
  syncStateDeliveries,
  salesEstadoEntrega,
  salesTotalesNullable,
  almacenes,
  almacenesNombres,
  traslados,
  productMeasurements,
];
