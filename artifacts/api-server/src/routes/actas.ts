import { Router, type IRouter } from "express";
import { db, dispatchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ConfirmDispatchActaBody,
  ConfirmDispatchActaParams,
  ConfirmDispatchActaResponse,
  GetDispatchActaParams,
  GetDispatchActaResponse,
  RegisterDispatchActaBody,
  RegisterDispatchActaParams,
  RegisterDispatchActaResponse,
} from "@workspace/api-zod";
import {
  confirmarRecepcion,
  getActaPorDespacho,
  parseFechaLlegada,
  registrarLlegada,
} from "../services/actasLlegada";
import { resolveCurrentPerson } from "../services/currentPerson";

const router: IRouter = Router();

async function dispatchExists(id: number): Promise<boolean> {
  const [dispatch] = await db
    .select({ id: dispatchesTable.id })
    .from(dispatchesTable)
    .where(eq(dispatchesTable.id, id));
  return Boolean(dispatch);
}

async function currentPersonId(req: Parameters<typeof resolveCurrentPerson>[0]) {
  const result = await resolveCurrentPerson(req);
  return result.ok ? result.person.id : null;
}

router.get("/dispatches/:id/acta", async (req, res): Promise<void> => {
  const params = GetDispatchActaParams.safeParse(req.params);
  if (!params.success || params.data.id <= 0) {
    res.status(400).json({ error: "id_invalido" });
    return;
  }
  if (!(await dispatchExists(params.data.id))) {
    res.status(404).json({ error: "despacho_no_encontrado" });
    return;
  }

  const acta = await getActaPorDespacho(params.data.id);
  if (!acta) {
    res.status(404).json({ error: "acta_no_registrada" });
    return;
  }
  res.json(GetDispatchActaResponse.parse(acta));
});

router.post("/dispatches/:id/acta", async (req, res): Promise<void> => {
  const params = RegisterDispatchActaParams.safeParse(req.params);
  const body = RegisterDispatchActaBody.safeParse(req.body);
  const inputKeys =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? Object.keys(req.body)
      : [];
  const hasOnlyAllowedFields = inputKeys.every(
    (key) => key === "fechaLlegada" || key === "novedadesViaje",
  );
  const fechaLlegada = parseFechaLlegada(req.body?.fechaLlegada);
  if (
    !params.success ||
    params.data.id <= 0 ||
    !body.success ||
    !hasOnlyAllowedFields ||
    !fechaLlegada
  ) {
    res.status(400).json({ error: "datos_de_acta_invalidos" });
    return;
  }
  if (!(await dispatchExists(params.data.id))) {
    res.status(404).json({ error: "despacho_no_encontrado" });
    return;
  }

  const acta = await registrarLlegada(params.data.id, {
    fechaLlegada,
    novedadesViaje: body.data.novedadesViaje,
    registradaPorId: await currentPersonId(req),
  });
  res.json(RegisterDispatchActaResponse.parse(acta));
});

router.patch("/dispatches/:id/acta", async (req, res): Promise<void> => {
  const params = ConfirmDispatchActaParams.safeParse(req.params);
  const body = ConfirmDispatchActaBody.safeParse(req.body);
  const inputKeys =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? Object.keys(req.body)
      : [];
  const hasOnlyAllowedFields = inputKeys.every(
    (key) => key === "recibidoPor" || key === "novedadesRecepcion",
  );
  if (
    !params.success ||
    params.data.id <= 0 ||
    !body.success ||
    inputKeys.length === 0 ||
    !hasOnlyAllowedFields
  ) {
    res.status(400).json({ error: "datos_de_recepcion_invalidos" });
    return;
  }
  if (!(await dispatchExists(params.data.id))) {
    res.status(404).json({ error: "despacho_no_encontrado" });
    return;
  }

  if (!(await getActaPorDespacho(params.data.id))) {
    res.status(409).json({ error: "acta_no_registrada" });
    return;
  }

  const acta = await confirmarRecepcion(params.data.id, {
    ...body.data,
    confirmadaPorId: await currentPersonId(req),
  });
  if (!acta) {
    res.status(409).json({ error: "acta_no_registrada" });
    return;
  }
  res.json(ConfirmDispatchActaResponse.parse(acta));
});

export default router;