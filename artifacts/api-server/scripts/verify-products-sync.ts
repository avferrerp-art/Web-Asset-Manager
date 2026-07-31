/* Acceptance verification for Task 42 (run with tsx). */
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { syncOdooProducts } from "../src/services/productSync";

async function count() {
  const rows = await db.select({ id: productsTable.id }).from(productsTable);
  return rows.length;
}

async function main() {
  console.log("--- Sync #1 ---");
  const r1 = await syncOdooProducts();
  console.log(r1);
  const c1 = await count();
  console.log("count after sync1:", c1);

  // Pick a product and set a manual weight + dimensions
  const [p] = await db.select().from(productsTable).limit(1);
  if (!p) throw new Error("No products synced");
  await db
    .update(productsTable)
    .set({ pesoKg: 123.45, largoCm: 50, anchoCm: 40, altoCm: 30, dimensionesConfirmadas: true, notas: "medido a mano" })
    .where(eq(productsTable.id, p.id));
  console.log("Set manual fields on product id", p.id, "odooId", p.odooId);

  console.log("--- Sync #2 ---");
  const r2 = await syncOdooProducts();
  console.log(r2);
  const c2 = await count();
  console.log("count after sync2:", c2, c1 === c2 ? "(NO DUPLICATES ✓)" : "(DUPLICATES! ✗)");

  const [after] = await db.select().from(productsTable).where(eq(productsTable.id, p.id));
  console.log("After sync2 manual fields:", {
    pesoKg: after!.pesoKg,
    largoCm: after!.largoCm,
    anchoCm: after!.anchoCm,
    altoCm: after!.altoCm,
    dimensionesConfirmadas: after!.dimensionesConfirmadas,
    notas: after!.notas,
  });
  const ok =
    after!.pesoKg === 123.45 && after!.largoCm === 50 && after!.anchoCm === 40 &&
    after!.altoCm === 30 && after!.dimensionesConfirmadas === true && after!.notas === "medido a mano";
  console.log(ok ? "MANUAL FIELDS PRESERVED ✓" : "MANUAL FIELDS LOST ✗");

  // Filter check
  const sinDim = await db.select({ id: productsTable.id, dc: productsTable.dimensionesConfirmadas })
    .from(productsTable).where(eq(productsTable.dimensionesConfirmadas, false));
  const allFalse = sinDim.every(r => r.dc === false);
  console.log(`sin-dimensiones filter: ${sinDim.length} rows, all false: ${allFalse ? "✓" : "✗"}`);

  if (!ok || c1 !== c2) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
