import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, fuelPricesTable } from "@workspace/db";
import { UpdateFuelPriceParams, UpdateFuelPriceBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/fuel-prices", async (_req, res): Promise<void> => {
  const prices = await db.select().from(fuelPricesTable).orderBy(fuelPricesTable.tipoCombustible);
  res.json(prices);
});

router.patch("/fuel-prices/:tipoCombustible", async (req, res): Promise<void> => {
  const params = UpdateFuelPriceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateFuelPriceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(fuelPricesTable)
    .where(eq(fuelPricesTable.tipoCombustible, params.data.tipoCombustible));

  if (existing) {
    const [updated] = await db
      .update(fuelPricesTable)
      .set({ precioPorLitro: parsed.data.precioPorLitro, updatedAt: new Date() })
      .where(eq(fuelPricesTable.tipoCombustible, params.data.tipoCombustible))
      .returning();
    res.json(updated);
    return;
  }

  const [created] = await db
    .insert(fuelPricesTable)
    .values({ tipoCombustible: params.data.tipoCombustible, precioPorLitro: parsed.data.precioPorLitro })
    .returning();
  res.status(200).json(created);
});

export default router;
