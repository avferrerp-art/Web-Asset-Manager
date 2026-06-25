import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, personnelTable } from "@workspace/db";
import {
  CreatePersonnelBody,
  GetPersonnelParams,
  UpdatePersonnelParams,
  UpdatePersonnelBody,
  DeletePersonnelParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/personnel", async (_req, res): Promise<void> => {
  const personnel = await db.select().from(personnelTable).orderBy(personnelTable.createdAt);
  res.json(personnel);
});

router.post("/personnel", async (req, res): Promise<void> => {
  const parsed = CreatePersonnelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [person] = await db.insert(personnelTable).values(parsed.data).returning();
  res.status(201).json(person);
});

router.get("/personnel/:id", async (req, res): Promise<void> => {
  const params = GetPersonnelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [person] = await db.select().from(personnelTable).where(eq(personnelTable.id, params.data.id));
  if (!person) {
    res.status(404).json({ error: "Personnel not found" });
    return;
  }
  res.json(person);
});

router.patch("/personnel/:id", async (req, res): Promise<void> => {
  const params = UpdatePersonnelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePersonnelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [person] = await db.update(personnelTable).set(parsed.data).where(eq(personnelTable.id, params.data.id)).returning();
  if (!person) {
    res.status(404).json({ error: "Personnel not found" });
    return;
  }
  res.json(person);
});

router.delete("/personnel/:id", async (req, res): Promise<void> => {
  const params = DeletePersonnelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [person] = await db.delete(personnelTable).where(eq(personnelTable.id, params.data.id)).returning();
  if (!person) {
    res.status(404).json({ error: "Personnel not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
