/**
 * Verification for the sale_items productId backfill (run twice → idempotent).
 * Run with: node scripts/run-verify-backfill.mjs   (from artifacts/api-server)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { backfillSaleItemProducts } from "../src/services/productBackfill";

const before = await db.execute(
  sql`SELECT count(*)::int AS n FROM sale_items WHERE product_id IS NULL`,
);
console.log("items with null product_id before:", before.rows[0].n);

const run1 = await backfillSaleItemProducts();
console.log("run 1:", run1);
const run2 = await backfillSaleItemProducts();
console.log("run 2:", run2);
if (run2.linked !== 0 || run2.dimensionsUpdated !== 0 || run2.salesRecalculated !== 0) {
  console.error("FAIL: second run made changes", run2);
  process.exit(1);
}

const after = await db.execute(
  sql`SELECT count(*)::int AS n FROM sale_items WHERE product_id IS NULL`,
);
console.log("items with null product_id after:", after.rows[0].n);
console.log("ALL CHECKS PASSED");
process.exit(0);
