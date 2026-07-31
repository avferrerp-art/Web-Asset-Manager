/**
 * Verification script for the Odoo product sync (Task: create products table & fix sync).
 *
 * Checks:
 *  1. `products` table exists with a UNIQUE constraint on odoo_id (required by the upsert).
 *  2. `odoo_sync_state` has the product-sync columns.
 *  3. syncOdooProducts() runs twice without error (idempotent upsert) and rows exist.
 *
 * Run with: node scripts/run-product-sync.mjs   (from artifacts/api-server)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { syncOdooProducts } from "../src/services/productSync";

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

const constraints = await db.execute(sql`
  SELECT conname, contype FROM pg_constraint WHERE conrelid = 'products'::regclass
`);
const hasUnique = constraints.rows.some((r) => r.contype === "u");
if (!hasUnique) fail("products table missing UNIQUE constraint on odoo_id");
console.log("OK: products table exists with UNIQUE constraint");

const cols = await db.execute(sql`
  SELECT column_name FROM information_schema.columns WHERE table_name = 'odoo_sync_state'
`);
const names = new Set(cols.rows.map((r) => r.column_name as string));
for (const c of [
  "last_products_sync_at",
  "last_products_result",
  "last_products_error",
  "products_created_count",
  "products_updated_count",
]) {
  if (!names.has(c)) fail(`odoo_sync_state missing column ${c}`);
}
console.log("OK: odoo_sync_state has all product-sync columns");

const run1 = await syncOdooProducts();
console.log("sync run 1:", run1);
const run2 = await syncOdooProducts();
console.log("sync run 2:", run2);
if (run2.total === 0) fail("sync returned 0 products");

const count = await db.execute(sql`SELECT count(*)::int AS n FROM products`);
console.log(`OK: products rows in DB: ${count.rows[0].n}`);
console.log("ALL CHECKS PASSED");
process.exit(0);
