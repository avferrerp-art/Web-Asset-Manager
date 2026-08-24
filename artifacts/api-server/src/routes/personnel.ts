import { Router, type IRouter } from "express";
import { asc, count, eq, inArray, notInArray, or } from "drizzle-orm";
import {
  almacenesTable,
  db,
  dispatchesTable,
  personnelTable,
} from "@workspace/db";
import {
  CreatePersonnelBody,
  CreatePersonnelResponse,
  GetPersonnelParams,
  GetPersonnelResponse,
  GetPersonnelWarehouseReportResponse,
  ListPersonnelResponse,
  ReplacePersonnelAlmacenesBody,
  ReplacePersonnelAlmacenesParams,
  ReplacePersonnelAlmacenesResponse,
  UpdatePersonnelParams,
  UpdatePersonnelBody,
  UpdatePersonnelResponse,
  DeletePersonnelParams,
} from "@workspace/api-zod";
import {
  listarAlmacenesAgrupadosPorPersonal,
  reemplazarAlmacenesDePersonal,
} from "../services/personnelAlmacenes";

const router: IRouter = Router();

async function hidratarPersonal(
  personnel: Array<typeof personnelTable.$inferSelect>,
) {
  const almacenesPorPersonal = await listarAlmacenesAgrupadosPorPersonal(
    personnel.map((person) => person.id),
  );

  return personnel.map((person) => ({
    ...person,
    createdAt: person.createdAt.toISOString(),
    almacenes: almacenesPorPersonal.get(person.id) ?? [],
  }));
}

router.get("/personnel", async (_req, res): Promise<void> => {
  const personnel = await db.select().from(personnelTable).orderBy(asc(personnelTable.nombre));
  res.json(ListPersonnelResponse.parse(await hidratarPersonal(personnel)));
});

router.post("/personnel", async (req, res): Promise<void> => {
  const parsed = CreatePersonnelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [person] = await db.insert(personnelTable).values(parsed.data).returning();
  const [hydratedPerson] = await hidratarPersonal([person]);
  res.status(201).json(CreatePersonnelResponse.parse(hydratedPerson));
});

// This static route must precede /personnel/:id so "reporte-almacenes" is
// never parsed as a personnel ID.
router.get("/personnel/reporte-almacenes", async (_req, res): Promise<void> => {
  const personnel = await db
    .select()
    .from(personnelTable)
    .where(notInArray(personnelTable.rol, ["chofer", "ayudante"]))
    .orderBy(asc(personnelTable.nombre));
  const hydratedPersonnel = await hidratarPersonal(personnel);
  const report = hydratedPersonnel
    .map((person) => ({
      ...person,
      sinAsignar: person.rol === "almacenista" && person.almacenes.length === 0,
    }))
    .sort(
      (left, right) =>
        Number(right.sinAsignar) - Number(left.sinAsignar) ||
        left.nombre.localeCompare(right.nombre, "es"),
    );

  res.json(GetPersonnelWarehouseReportResponse.parse(report));
});

router.put("/personnel/:id/almacenes", async (req, res): Promise<void> => {
  const params = ReplacePersonnelAlmacenesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReplacePersonnelAlmacenesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (new Set(parsed.data.almacenIds).size !== parsed.data.almacenIds.length) {
    res.status(400).json({ error: "Los almacenes no pueden repetirse." });
    return;
  }

  const [person] = await db
    .select()
    .from(personnelTable)
    .where(eq(personnelTable.id, params.data.id));
  if (!person) {
    res.status(404).json({ error: "Personnel not found" });
    return;
  }

  const assignedIds = parsed.data.almacenIds;
  const foundAlmacenes =
    assignedIds.length === 0
      ? []
      : await db
          .select({ id: almacenesTable.id })
          .from(almacenesTable)
          .where(inArray(almacenesTable.id, assignedIds));
  const foundIds = new Set(foundAlmacenes.map(({ id }) => id));
  const missingAlmacenIds = assignedIds.filter((id) => !foundIds.has(id));
  if (missingAlmacenIds.length > 0) {
    res.status(400).json({
      error: "Almacenes no encontrados.",
      missingAlmacenIds,
    });
    return;
  }

  await reemplazarAlmacenesDePersonal(params.data.id, assignedIds);
  const [hydratedPerson] = await hidratarPersonal([person]);
  res.json(ReplacePersonnelAlmacenesResponse.parse(hydratedPerson));
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
  const [hydratedPerson] = await hidratarPersonal([person]);
  res.json(GetPersonnelResponse.parse(hydratedPerson));
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
  const [hydratedPerson] = await hidratarPersonal([person]);
  res.json(UpdatePersonnelResponse.parse(hydratedPerson));
});

router.delete("/personnel/:id", async (req, res): Promise<void> => {
  const params = DeletePersonnelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [{ value: dispatchCount }] = await db
    .select({ value: count() })
    .from(dispatchesTable)
    .where(or(eq(dispatchesTable.choferId, params.data.id), eq(dispatchesTable.ayudanteId, params.data.id)));
  if (dispatchCount > 0) {
    res.status(409).json({
      error: "personnel_has_dispatches",
      dispatchCount,
      message: `Esta persona está vinculada a ${dispatchCount} despacho${dispatchCount === 1 ? "" : "s"} y no puede eliminarse.`,
    });
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
