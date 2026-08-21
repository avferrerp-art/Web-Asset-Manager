import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, dispatchesTable, routePointsTable, type Personnel } from "@workspace/db";
import {
  GetDriverDispatchParams,
  UpdateDriverDispatchStatusParams,
  UpdateDriverDispatchStatusBody,
  CompleteDriverRoutePointParams,
  CompleteDriverRoutePointBody,
} from "@workspace/api-zod";
import { buildDispatchRow, buildDispatchDetail } from "./dispatches";
import { syncLinkedDispatchEntity } from "../services/dispatchEstadoSync";
import {
  isFechaLlegadaFutura,
  parseFechaLlegada,
  registrarLlegada,
} from "../services/actasLlegada";
import { resolveCurrentPerson } from "../services/currentPerson";

const router: IRouter = Router();

async function resolveDriver(
  req: Request,
  res: Response,
): Promise<Personnel | null> {
  const currentPerson = await resolveCurrentPerson(req);
  if (currentPerson.ok) return currentPerson.person;

  if (currentPerson.reason === "unauthorized") {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (currentPerson.reason === "no_email") {
    res.status(404).json({
      error: "no_email",
      message: "Tu cuenta no tiene un email asociado.",
    });
    return null;
  }
  res.status(404).json({
    error: "not_linked",
    message: `No hay un chofer registrado con el email ${currentPerson.email}. Pide al administrador que agregue tu email en Personal.`,
  });
  return null;
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

router.post(
  "/driver/dispatches/:id/route-points/:pointId/complete",
  async (req, res): Promise<void> => {
    const person = await resolveDriver(req, res);
    if (!person) return;
    const params = CompleteDriverRoutePointParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CompleteDriverRoutePointBody.safeParse(req.body);
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
    const [point] = await db
      .update(routePointsTable)
      .set({ completado: body.data.completado })
      .where(
        and(
          eq(routePointsTable.id, params.data.pointId),
          eq(routePointsTable.despachoId, params.data.id),
        ),
      )
      .returning();
    if (!point) {
      res.status(404).json({ error: "Route point not found" });
      return;
    }
    res.json(point);
  },
);

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
    const inputKeys =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? Object.keys(req.body)
        : [];
    const hasOnlyAllowedFields = inputKeys.every(
      (key) =>
        key === "estado" ||
        key === "fechaLlegada" ||
        key === "novedadesViaje",
    );
    const includesActaFields =
      inputKeys.includes("fechaLlegada") ||
      inputKeys.includes("novedadesViaje");
    if (includesActaFields && req.body?.estado !== "entregado") {
      res.status(400).json({ error: "acta_fuera_de_contexto" });
      return;
    }
    const fechaLlegada = includesActaFields
      ? parseFechaLlegada(req.body?.fechaLlegada)
      : null;
    const body = UpdateDriverDispatchStatusBody.safeParse(req.body);
    if (!body.success || !hasOnlyAllowedFields) {
      res.status(400).json({
        error: body.success ? "datos_estado_invalidos" : body.error.message,
      });
      return;
    }
    if (includesActaFields && !fechaLlegada) {
      res.status(400).json({ error: "fecha_llegada_requerida" });
      return;
    }
    if (fechaLlegada && isFechaLlegadaFutura(fechaLlegada)) {
      res.status(400).json({ error: "fecha_llegada_futura" });
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
    await syncLinkedDispatchEntity(updated);
    if (nuevoEstado === "entregado" && fechaLlegada) {
      await registrarLlegada(updated.id, {
        fechaLlegada,
        novedadesViaje: body.data.novedadesViaje,
        registradaPorId: person.id,
      });
    }
    const row = await buildDispatchRow(updated);
    res.json(row);
  },
);

export default router;
