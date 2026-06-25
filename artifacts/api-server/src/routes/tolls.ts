import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tollRoutesTable } from "@workspace/db";
import {
  ListTollsResponse,
  CreateTollBody,
  CreateTollResponse,
  UpdateTollParams,
  UpdateTollBody,
  UpdateTollResponse,
  DeleteTollParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tolls", async (_req, res): Promise<void> => {
  const tolls = await db.select().from(tollRoutesTable).orderBy(tollRoutesTable.id);
  res.json(ListTollsResponse.parse(tolls));
});

router.post("/tolls", async (req, res): Promise<void> => {
  const parsed = CreateTollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [toll] = await db.insert(tollRoutesTable).values(parsed.data).returning();
  res.status(201).json(CreateTollResponse.parse(toll));
});

router.patch("/tolls/:id", async (req, res): Promise<void> => {
  const params = UpdateTollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [toll] = await db.update(tollRoutesTable).set(parsed.data).where(eq(tollRoutesTable.id, params.data.id)).returning();
  if (!toll) {
    res.status(404).json({ error: "Toll route not found" });
    return;
  }
  res.json(UpdateTollResponse.parse(toll));
});

router.delete("/tolls/:id", async (req, res): Promise<void> => {
  const params = DeleteTollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [toll] = await db.delete(tollRoutesTable).where(eq(tollRoutesTable.id, params.data.id)).returning();
  if (!toll) {
    res.status(404).json({ error: "Toll route not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
