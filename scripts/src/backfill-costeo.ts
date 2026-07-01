import { db, fuelPricesTable, routeTollsTable, vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULT_FUEL_TYPES = ["gasolina", "diesel", "gas"] as const;
const FALLBACK_PRECIO_POR_LITRO = 1.5;
const FALLBACK_TOLL_TARIFA = 1.5;

async function seedFuelPrices() {
  for (const tipoCombustible of DEFAULT_FUEL_TYPES) {
    const [existing] = await db
      .select()
      .from(fuelPricesTable)
      .where(eq(fuelPricesTable.tipoCombustible, tipoCombustible));
    if (!existing) {
      await db.insert(fuelPricesTable).values({
        tipoCombustible,
        precioPorLitro: FALLBACK_PRECIO_POR_LITRO,
      });
      console.log(`Seeded fuel_prices row for "${tipoCombustible}" at $${FALLBACK_PRECIO_POR_LITRO}/L`);
    }
  }
}

async function backfillRouteTollTarifas() {
  const vehicles = await db.select().from(vehiclesTable);
  const rates = vehicles
    .map((v) => v.tarifaPeaje)
    .filter((v): v is number => v != null && v > 0);
  const backfillValue = rates.length > 0
    ? rates.reduce((sum, r) => sum + r, 0) / rates.length
    : FALLBACK_TOLL_TARIFA;

  const zeroTolls = await db
    .select()
    .from(routeTollsTable)
    .where(eq(routeTollsTable.tarifa, 0));

  if (zeroTolls.length === 0) {
    console.log("No route_tolls rows need a tarifa backfill.");
    return;
  }

  await db
    .update(routeTollsTable)
    .set({ tarifa: backfillValue })
    .where(eq(routeTollsTable.tarifa, 0));

  console.log(
    `Backfilled ${zeroTolls.length} route_tolls row(s) with tarifa=${backfillValue.toFixed(2)} (derived from vehicles.tarifaPeaje average).`
  );
}

async function main() {
  await seedFuelPrices();
  await backfillRouteTollTarifas();
  console.log("Costeo backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Costeo backfill failed:", err);
  process.exit(1);
});
