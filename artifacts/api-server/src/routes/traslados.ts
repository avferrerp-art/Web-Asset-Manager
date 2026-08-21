import { Router, type IRouter } from "express";
import {
  GetTrasladoParams,
  GetTrasladoResponse,
  ListTrasladosQueryParams,
  ListTrasladosResponse,
} from "@workspace/api-zod";
import {
  getTraslado,
  listTraslados,
  type TrasladoFilters,
} from "../services/trasladoQueries";

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

  const response = ListTrasladosResponse.parse(await listTraslados(parsed.data));
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

  const traslado = await getTraslado(parsed.data.id);
  if (!traslado) {
    res.status(404).json({ error: "Traslado no encontrado" });
    return;
  }

  res.json(GetTrasladoResponse.parse(traslado));
});

export default router;