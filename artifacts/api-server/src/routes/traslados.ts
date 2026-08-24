import { Router, type IRouter } from "express";
import {
  UpdateTrasladoBody,
  UpdateTrasladoParams,
  UpdateTrasladoResponse,
  GetTrasladoParams,
  GetTrasladoResponse,
  ListTrasladosQueryParams,
  ListTrasladosResponse,
} from "@workspace/api-zod";
import {
  getTrasladoAlmacenes,
  getTraslado,
  listTraslados,
  TrasladoPesoOdooReadonlyError,
  type TrasladoFilters,
  updateTrasladoLocalFields,
} from "../services/trasladoQueries";
import {
  canAccessTraslado,
  resolveAlmacenAccess,
} from "../services/almacenAccess";

const router: IRouter = Router();

function hasValidWarehouseIds(filters: TrasladoFilters): boolean {
  return [filters.almacenOrigenId, filters.almacenDestinoId].every(
    (value) => value === undefined || (Number.isInteger(value) && value > 0),
  );
}

router.get("/traslados", async (req, res): Promise<void> => {
  const parsed = ListTrasladosQueryParams.safeParse(req.query);
  if (!parsed.success || !hasValidWarehouseIds(parsed.data)) {
    res.status(400).json({ error: "Filtros de traslados inválidos" });
    return;
  }

  const access = await resolveAlmacenAccess(req);
  const response = ListTrasladosResponse.parse(
    await listTraslados({
      ...parsed.data,
      ...(access.kind === "limited"
        ? { authorizedAlmacenIds: access.almacenIds }
        : {}),
    }),
  );
  res.json(response);
});

router.get("/traslados/:id", async (req, res): Promise<void> => {
  const parsed = GetTrasladoParams.safeParse(req.params);
  if (
    !parsed.success ||
    !Number.isInteger(parsed.data.id) ||
    parsed.data.id <= 0
  ) {
    res.status(400).json({ error: "id inválido" });
    return;
  }

  const almacenIds = await getTrasladoAlmacenes(parsed.data.id);
  if (!almacenIds) {
    res.status(404).json({ error: "Traslado no encontrado" });
    return;
  }
  if (!canAccessTraslado(await resolveAlmacenAccess(req), almacenIds)) {
    res.status(403).json({ error: "almacen_no_autorizado" });
    return;
  }

  const traslado = await getTraslado(parsed.data.id);
  if (!traslado) {
    res.status(404).json({ error: "Traslado no encontrado" });
    return;
  }

  res.json(GetTrasladoResponse.parse(traslado));
});

router.patch("/traslados/:id", async (req, res): Promise<void> => {
  const params = UpdateTrasladoParams.safeParse(req.params);
  const body = UpdateTrasladoBody.safeParse(req.body);
  if (
    !params.success ||
    !Number.isInteger(params.data.id) ||
    params.data.id <= 0 ||
    !body.success ||
    Object.keys(body.data).length === 0
  ) {
    res.status(400).json({ error: "Datos de traslado inválidos" });
    return;
  }

  try {
    const almacenIds = await getTrasladoAlmacenes(params.data.id);
    if (!almacenIds) {
      res.status(404).json({ error: "Traslado no encontrado" });
      return;
    }
    if (!canAccessTraslado(await resolveAlmacenAccess(req), almacenIds)) {
      res.status(403).json({ error: "almacen_no_autorizado" });
      return;
    }

    const updated = await updateTrasladoLocalFields(params.data.id, body.data);
    if (!updated) {
      res.status(404).json({ error: "Traslado no encontrado" });
      return;
    }
    res.json(UpdateTrasladoResponse.parse(updated));
  } catch (error) {
    if (error instanceof TrasladoPesoOdooReadonlyError) {
      res.status(400).json({
        error: "peso_odoo_readonly",
        message: error.message,
      });
      return;
    }
    throw error;
  }
});

export default router;