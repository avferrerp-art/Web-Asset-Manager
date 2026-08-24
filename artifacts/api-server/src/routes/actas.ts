import { Router, type IRouter } from "express";
import { db, dispatchesTable, trasladosTable } from "@workspace/db";
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
  isFechaLlegadaFutura,
  parseFechaLlegada,
  registrarLlegada,
} from "../services/actasLlegada";
import { resolveCurrentPerson } from "../services/currentPerson";
import {
  canOperateAlmacen,
  resolveAlmacenAccess,
} from "../services/almacenAccess";

const router: IRouter = Router();

async function getDispatch(id: number) {
  const [dispatch] = await db
    .select({
      id: dispatchesTable.id,
      estado: dispatchesTable.estado,
      tipo: dispatchesTable.tipo,
      trasladoId: dispatchesTable.trasladoId,
      almacenDestinoId: trasladosTable.almacenDestinoId,
    })
    .from(dispatchesTable)
    .leftJoin(
      trasladosTable,
      eq(trasladosTable.id, dispatchesTable.trasladoId),
    )
    .where(eq(dispatchesTable.id, id));
  return dispatch ?? null;
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
  if (!(await getDispatch(params.data.id))) {
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
  if (isFechaLlegadaFutura(fechaLlegada)) {
    res.status(400).json({ error: "fecha_llegada_futura" });
    return;
  }
  const dispatch = await getDispatch(params.data.id);
  if (!dispatch) {
    res.status(404).json({ error: "despacho_no_encontrado" });
    return;
  }
  if (dispatch.estado !== "en-ruta" && dispatch.estado !== "entregado") {
    res.status(409).json({ error: "despacho_sin_salir" });
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
  const dispatch = await getDispatch(params.data.id);
  if (!dispatch) {
    res.status(404).json({ error: "despacho_no_encontrado" });
    return;
  }
  if (
    dispatch.tipo === "traslado" &&
    dispatch.trasladoId !== null &&
    dispatch.almacenDestinoId !== null &&
    !canOperateAlmacen(
      await resolveAlmacenAccess(req),
      dispatch.almacenDestinoId,
    )
  ) {
    res.status(403).json({ error: "almacen_no_autorizado" });
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