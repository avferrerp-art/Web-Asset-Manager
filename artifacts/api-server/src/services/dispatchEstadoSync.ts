import { dispatchesTable } from "@workspace/db";
import { syncSaleEstadoFromDispatch } from "./saleEstadoSync";
import { syncTrasladoEstadoFromDispatch } from "./trasladoEstadoSync";

/**
 * Mantiene sincronizada la entidad vinculada a un despacho sin mezclar las
 * reglas de ventas y traslados.
 */
export async function syncLinkedDispatchEntity(
  dispatch: typeof dispatchesTable.$inferSelect,
): Promise<void> {
  if (dispatch.tipo === "venta" && dispatch.ventaId !== null) {
    await syncSaleEstadoFromDispatch(dispatch.ventaId);
  } else if (
    dispatch.tipo === "traslado" &&
    dispatch.trasladoId !== null
  ) {
    await syncTrasladoEstadoFromDispatch(dispatch.trasladoId);
  }
}