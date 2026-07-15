import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response } from "express";
import { db, personnelTable, dispatchesTable } from "@workspace/db";
import {
  GetDriverDispatchParams,
  UpdateDriverDispatchStatusParams,
  UpdateDriverDispatchStatusBody,
} from "@workspace/api-zod";
import { buildDispatchRow, buildDispatchDetail } from "./dispatches";

const router: IRouter = Router();

async function resolveDriver(req: Request, res: Response) {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const user = await clerkClient.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;
  if (!email) {
    res.status(404).json({
      error: "no_email",
      message: "Tu cuenta no tiene un email asociado.",
    });
    return null;
  }
  const [person] = await db
    .select()
    .from(personnelTable)
    .where(sql`lower(${personnelTable.email}) = ${email.toLowerCase()}`);
  if (!person) {
    res.status(404).json({
      error: "not_linked",
      message: `No hay un chofer registrado con el email ${email}. Pide al administrador que agregue tu email en Personal.`,
    });
    return null;
  }
  return person;
}

router.get("/driver/me", async (req, res): Promise<void> => {
  const person = await resolveDriver(req, res);
  if (!person) return;
  res.json(person);
});

router.get("/driver/dispatches", async (req, res): Promise<void> => {
  const person = await resolveDriver(req, res);
  if (!person) return;
  const rows = await db
    .select()
    .from(dispatchesTable)
    .where(eq(dispatchesTable.choferId, person.id))
    .orderBy(desc(dispatchesTable.createdAt));
  const result = await Promise.all(rows.map((d) => buildDispatchRow(d)));
  res.json(result);
});

router.get("/driver/dispatches/:id", async (req, res): Promise<void> => {
  const person = await resolveDriver(req, res);
  if (!person) return;
  const params = GetDriverDispatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [dispatch] = await db
    .select()
    .from(dispatchesTable)
    .where(eq(dispatchesTable.id, params.data.id));
  if (!dispatch || dispatch.choferId !== person.id) {
    res.status(404).json({ error: "Dispatch not found" });
    return;
  }
  const detail = await buildDispatchDetail(dispatch);
  res.json(detail);
});

const allowedTransitions: Record<string, string[]> = {
  "en-ruta": ["aprobado", "en-ruta"],
  entregado: ["en-ruta"],
};

router.post(
  "/driver/dispatches/:id/status",
  async (req, res): Promise<void> => {
    const person = await resolveDriver(req, res);
    if (!person) return;
    const params = UpdateDriverDispatchStatusParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateDriverDispatchStatusBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [dispatch] = await db
      .select()
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, params.data.id));
    if (!dispatch || dispatch.choferId !== person.id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    const nuevoEstado = body.data.estado;
    const validFrom = allowedTransitions[nuevoEstado] ?? [];
    if (!validFrom.includes(dispatch.estado)) {
      res.status(400).json({
        error: "invalid_transition",
        message: `No se puede cambiar de "${dispatch.estado}" a "${nuevoEstado}".`,
      });
      return;
    }
    const [updated] = await db
      .update(dispatchesTable)
      .set({ estado: nuevoEstado })
      .where(eq(dispatchesTable.id, dispatch.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    const row = await buildDispatchRow(updated);
    res.json(row);
  },
);

export default router;
