import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, fuelPricesTable } from "@workspace/db";

const router: IRouter = Router();

const VALID_FUEL_TYPES = ["gasolina", "diesel", "gas"] as const;
type FuelType = typeof VALID_FUEL_TYPES[number];
const DEFAULT_PRICE = 1.5;

function isValidFuelType(v: unknown): v is FuelType {
  return VALID_FUEL_TYPES.includes(v as FuelType);
}

async function ensureAllFuelTypesExist(): Promise<void> {
  const existing = await db.select().from(fuelPricesTable);
  const existingTypes = new Set(existing.map((r) => r.tipoCombustible));
  const missing = VALID_FUEL_TYPES.filter((t) => !existingTypes.has(t));
  if (missing.length > 0) {
    await db
      .insert(fuelPricesTable)
      .values(missing.map((tipo) => ({ tipoCombustible: tipo, precioPorLitro: DEFAULT_PRICE })))
      .onConflictDoNothing();
  }
}

router.get("/settings/fuel-prices", async (req, res): Promise<void> => {
  await ensureAllFuelTypesExist();
  const rows = await db.select().from(fuelPricesTable).orderBy(fuelPricesTable.tipoCombustible);
  res.json(rows);
});

router.put("/settings/fuel-prices/:type", async (req, res): Promise<void> => {
  const { type } = req.params;
  if (!isValidFuelType(type)) {
    res.status(400).json({ error: "Tipo de combustible inválido. Use: gasolina, diesel, o gas" });
    return;
  }

  const { precioPorLitro } = req.body as { precioPorLitro: unknown };
  if (typeof precioPorLitro !== "number" || precioPorLitro <= 0 || !isFinite(precioPorLitro)) {
    res.status(400).json({ error: "precioPorLitro debe ser un número positivo" });
    return;
  }

  const [row] = await db
    .insert(fuelPricesTable)
    .values({ tipoCombustible: type, precioPorLitro })
    .onConflictDoUpdate({
      target: fuelPricesTable.tipoCombustible,
      set: { precioPorLitro, updatedAt: new Date() },
    })
    .returning();

  res.json(row);
});

export default router;
