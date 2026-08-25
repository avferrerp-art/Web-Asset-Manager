import { eq, inArray, sql } from "drizzle-orm";
import { db, dispatchesTable, salesTable } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Deriva el estado que debería tener una venta a partir de los estados de
 * TODOS sus despachos:
 * - todos los despachos activos entregados -> "entregado"
 * - algún despacho activo (no cancelado)  -> "despachado"
 * - sin despachos o todos cancelados      -> "pendiente"
 *
 * Solo se toca sales.estado; nunca otros campos de la venta.
 */
export function deriveSaleEstado(
  dispatchEstados: string[],
): "pendiente" | "despachado" | "entregado" {
  const active = dispatchEstados.filter((estado) => estado !== "cancelado");
  if (active.length > 0 && active.every((estado) => estado === "entregado")) return "entregado";
  if (active.length > 0) return "despachado";
  return "pendiente";
}

/**
 * Sincroniza el estado de una venta según el estado real de sus despachos.
 * Llamar después de cualquier creación, cambio de estado o eliminación de un
 * despacho. Devuelve el estado aplicado.
 */
export async function syncSaleEstadoFromDispatch(
  ventaId: number,
): Promise<void> {
  // Una sola sentencia SQL: la derivación y el update son atómicos, así dos
  // cambios concurrentes sobre despachos de la misma venta no pueden pisarse
  // con lecturas obsoletas.
  await db.execute(sql`
    UPDATE sales SET estado = CASE
      WHEN EXISTS (SELECT 1 FROM dispatches WHERE venta_id = ${ventaId} AND estado <> 'cancelado')
        AND NOT EXISTS (SELECT 1 FROM dispatches WHERE venta_id = ${ventaId} AND estado <> 'cancelado' AND estado <> 'entregado')
        THEN 'entregado'
      WHEN EXISTS (SELECT 1 FROM dispatches WHERE venta_id = ${ventaId} AND estado <> 'cancelado') THEN 'despachado'
      ELSE 'pendiente'
    END
    WHERE id = ${ventaId}
  `);
}

/**
 * Reconciliación idempotente: recorre las ventas y corrige su estado según el
 * estado real de sus despachos. Reglas:
 * - Ventas con al menos un despacho: estado derivado (ver deriveSaleEstado),
 *   sin importar su estado actual.
 * - Ventas SIN despachos pero marcadas "despachado": vuelven a "pendiente"
 *   (un "despachado" sin despacho activo es imposible por definición).
 * - Ventas sin despachos en "cancelado" o "entregado" no se tocan
 *   (pueden ser históricas legítimas anteriores al módulo de despachos).
 * Devuelve cuántas ventas corrigió.
 */
export async function reconcileSaleEstados(): Promise<number> {
  const sales = await db
    .select({ id: salesTable.id, estado: salesTable.estado })
    .from(salesTable);
  const dispatches = await db
    .select({ ventaId: dispatchesTable.ventaId, estado: dispatchesTable.estado })
    .from(dispatchesTable)
    .where(eq(dispatchesTable.tipo, "venta"));

  const byVenta = new Map<number, string[]>();
  for (const d of dispatches) {
    if (d.ventaId === null) continue;
    const list = byVenta.get(d.ventaId) ?? [];
    list.push(d.estado);
    byVenta.set(d.ventaId, list);
  }

  const fixes = new Map<string, number[]>();
  for (const sale of sales) {
    const dispatchEstados = byVenta.get(sale.id);
    let target: string;
    if (dispatchEstados && dispatchEstados.length > 0) {
      target = deriveSaleEstado(dispatchEstados);
    } else if (sale.estado === "despachado") {
      target = "pendiente";
    } else {
      continue;
    }
    if (target !== sale.estado) {
      const ids = fixes.get(target) ?? [];
      ids.push(sale.id);
      fixes.set(target, ids);
    }
  }

  let corrected = 0;
  for (const [estado, ids] of fixes) {
    await db
      .update(salesTable)
      .set({ estado })
      .where(inArray(salesTable.id, ids));
    corrected += ids.length;
    logger.info({ estado, ventaIds: ids }, "Reconciliación de estados de venta");
  }
  logger.info({ corrected }, "Reconciliación de estados de venta completada");
  return corrected;
}
