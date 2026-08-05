import { inArray, sql } from "drizzle-orm";
import { db, salesTable, deliveriesTable } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Deriva el estado de ENTREGA de una venta a partir de los estados de sus
 * albaranes de Odoo (deliveries.estado, valores crudos de stock.picking:
 * draft/waiting/confirmed/assigned/done/cancel).
 *
 * IMPORTANTE: esto NO toca sales.estado (interno, derivado de despachos por
 * saleEstadoSync.ts). Va en el campo separado sales.estadoEntrega.
 *
 * Reglas (los albaranes en `cancel` se ignoran en la derivación pero siguen
 * guardados en la tabla deliveries):
 * - Sin albaranes                       → sin_albaran
 * - Todos en `cancel`                   → cancelado
 * - Todos los NO cancelados en `done`   → entregado
 * - Algunos `done` y otros no           → parcial
 * - Ningún activo en `done`             → pendiente
 */
export function deriveEstadoEntrega(
  estadosDeAlbaranes: string[],
): "sin_albaran" | "cancelado" | "entregado" | "parcial" | "pendiente" {
  if (estadosDeAlbaranes.length === 0) return "sin_albaran";
  const activos = estadosDeAlbaranes.filter((e) => e !== "cancel");
  if (activos.length === 0) return "cancelado";
  const done = activos.filter((e) => e === "done").length;
  if (done === activos.length) return "entregado";
  if (done > 0) return "parcial";
  return "pendiente";
}

export interface DeliveryForDerivation {
  estado: string;
  almacenOrigen: string | null;
  fechaProgramada: Date | null;
}

/**
 * Deriva el almacén de origen de la venta: el del albarán NO cancelado más
 * reciente por fechaProgramada (null last). También reporta si hay albaranes
 * (incluidos los cancelados) de MÁS de un almacén: un albarán cancelado en un
 * almacén y reemitido desde otro (ej. S01344: CCS cancelado → LEC activo)
 * sigue siendo una señal operativa de "varios almacenes" para el operador.
 *
 * Decisión multi-almacén (ej. real: S01344 con CCS y LEC): guardamos el más
 * reciente en sales.almacenOrigen y un flag booleano sales.almacenesMultiples.
 * Se eligió un campo derivado (y no cálculo en la UI desde los albaranes)
 * porque la lista de ventas debe poder señalar "varios almacenes" sin hacer
 * N+1 requests a GET /sales/{id}/deliveries.
 */
export function deriveAlmacenOrigen(albaranes: DeliveryForDerivation[]): {
  almacenOrigen: string | null;
  almacenesMultiples: boolean;
} {
  const activos = albaranes.filter((a) => a.estado !== "cancel");
  if (activos.length === 0) return { almacenOrigen: null, almacenesMultiples: false };
  const sorted = [...activos].sort((a, b) => {
    const ta = a.fechaProgramada ? a.fechaProgramada.getTime() : -Infinity;
    const tb = b.fechaProgramada ? b.fechaProgramada.getTime() : -Infinity;
    return tb - ta;
  });
  // El flag considera TODOS los albaranes (incluidos cancelados): un albarán
  // cancelado en un almacén y reemitido desde otro sigue implicando logística
  // multi-almacén para el operador.
  const distinct = new Set(albaranes.map((a) => a.almacenOrigen).filter((x) => x !== null));
  return {
    almacenOrigen: sorted[0]!.almacenOrigen,
    almacenesMultiples: distinct.size > 1,
  };
}

export interface DeliveryStateRecomputeResult {
  examined: number;
  updated: number;
  distribution: Record<string, number>;
}

/**
 * Recalcula estadoEntrega, almacenOrigen y almacenesMultiples para las ventas
 * indicadas (o TODAS si saleIds es undefined) a partir de los albaranes ya en
 * DB. Idempotente: solo escribe cuando hay cambios y NUNCA toca sales.estado.
 */
export async function recomputeDeliveryDerivedState(
  saleIds?: number[],
): Promise<DeliveryStateRecomputeResult> {
  if (saleIds !== undefined && saleIds.length === 0) {
    return { examined: 0, updated: 0, distribution: {} };
  }

  const sales = await db
    .select({
      id: salesTable.id,
      estadoEntrega: salesTable.estadoEntrega,
      almacenOrigen: salesTable.almacenOrigen,
      almacenesMultiples: salesTable.almacenesMultiples,
    })
    .from(salesTable)
    .where(saleIds ? inArray(salesTable.id, saleIds) : sql`true`);

  const deliveries = await db
    .select({
      ventaId: deliveriesTable.ventaId,
      estado: deliveriesTable.estado,
      almacenOrigen: deliveriesTable.almacenOrigen,
      fechaProgramada: deliveriesTable.fechaProgramada,
    })
    .from(deliveriesTable)
    .where(saleIds ? inArray(deliveriesTable.ventaId, saleIds) : sql`true`);

  const byVenta = new Map<number, DeliveryForDerivation[]>();
  for (const d of deliveries) {
    const list = byVenta.get(d.ventaId) ?? [];
    list.push(d);
    byVenta.set(d.ventaId, list);
  }

  let updated = 0;
  const distribution: Record<string, number> = {};
  for (const sale of sales) {
    const albaranes = byVenta.get(sale.id) ?? [];
    const estadoEntrega = deriveEstadoEntrega(albaranes.map((a) => a.estado));
    const { almacenOrigen, almacenesMultiples } = deriveAlmacenOrigen(albaranes);
    distribution[estadoEntrega] = (distribution[estadoEntrega] ?? 0) + 1;

    if (
      sale.estadoEntrega !== estadoEntrega ||
      sale.almacenOrigen !== almacenOrigen ||
      sale.almacenesMultiples !== almacenesMultiples
    ) {
      await db
        .update(salesTable)
        .set({ estadoEntrega, almacenOrigen, almacenesMultiples })
        .where(sql`${salesTable.id} = ${sale.id}`);
      updated++;
    }
  }

  const result = { examined: sales.length, updated, distribution };
  logger.info({ result, scoped: saleIds !== undefined }, "Derivación de estadoEntrega completada");
  return result;
}
