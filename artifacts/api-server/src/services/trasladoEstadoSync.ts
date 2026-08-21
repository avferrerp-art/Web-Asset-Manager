import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, dispatchesTable, trasladosTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type TrasladoEstadoFromDispatch =
  | "por_planificar"
  | "planificado"
  | "en_carga"
  | "en_transito"
  | "entregado";

const ODOO_TERMINAL_STATES = ["confirmado_odoo", "cancelado"] as const;

/**
 * Deriva el estado logístico de un traslado a partir de TODOS sus despachos:
 * - algún despacho entregado             -> entregado
 * - algún despacho en ruta               -> en_transito
 * - algún despacho activo (no cancelado) -> conserva en_carga o planificado
 * - sin despachos o todos cancelados     -> por_planificar
 */
export function deriveTrasladoEstadoFromDispatch(
  dispatchEstados: string[],
  estadoActual?: string,
): TrasladoEstadoFromDispatch {
  if (dispatchEstados.includes("entregado")) return "entregado";
  if (dispatchEstados.includes("en-ruta")) return "en_transito";
  if (dispatchEstados.some((estado) => estado !== "cancelado")) {
    return estadoActual === "en_carga" ? "en_carga" : "planificado";
  }
  return "por_planificar";
}

/**
 * Sincroniza atómicamente el estado logístico de un traslado con sus
 * despachos. Los estados terminales gobernados por Odoo nunca se modifican.
 */
export async function syncTrasladoEstadoFromDispatch(
  trasladoId: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE traslados SET estado_logistico = CASE
      WHEN EXISTS (
        SELECT 1 FROM dispatches
        WHERE traslado_id = ${trasladoId}
          AND tipo = 'traslado'
          AND estado = 'entregado'
      ) THEN 'entregado'
      WHEN EXISTS (
        SELECT 1 FROM dispatches
        WHERE traslado_id = ${trasladoId}
          AND tipo = 'traslado'
          AND estado = 'en-ruta'
      ) THEN 'en_transito'
      WHEN EXISTS (
        SELECT 1 FROM dispatches
        WHERE traslado_id = ${trasladoId}
          AND tipo = 'traslado'
          AND estado <> 'cancelado'
      ) THEN CASE
        WHEN estado_logistico = 'en_carga' THEN 'en_carga'
        ELSE 'planificado'
      END
      ELSE 'por_planificar'
    END
    WHERE id = ${trasladoId}
      AND estado_logistico NOT IN ('confirmado_odoo', 'cancelado')
  `);
}

/**
 * Corrige de forma idempotente los estados históricos de traslados según sus
 * despachos. Agrupa los updates por estado y preserva los terminales de Odoo.
 */
export async function reconcileTrasladoEstados(
  onlyTrasladoIds?: number[],
): Promise<number> {
  if (onlyTrasladoIds?.length === 0) return 0;

  const result = await db.transaction(async (tx) => {
    // Bloquear primero los traslados no terminales evita que una reconciliación
    // basada en una lectura anterior pise una sincronización concurrente.
    const traslados = await tx
      .select({
        id: trasladosTable.id,
        estadoLogistico: trasladosTable.estadoLogistico,
      })
      .from(trasladosTable)
      .where(
        and(
          notInArray(trasladosTable.estadoLogistico, [
            ...ODOO_TERMINAL_STATES,
          ]),
          onlyTrasladoIds
            ? inArray(trasladosTable.id, onlyTrasladoIds)
            : undefined,
        ),
      )
      .for("update");

    if (traslados.length === 0) {
      return {
        corrected: 0,
        updates: [] as Array<{
          estadoLogistico: TrasladoEstadoFromDispatch;
          trasladoIds: number[];
        }>,
      };
    }

    const lockedTrasladoIds = traslados.map(({ id }) => id);
    const dispatches = await tx
      .select({
        trasladoId: dispatchesTable.trasladoId,
        estado: dispatchesTable.estado,
      })
      .from(dispatchesTable)
      .where(
        and(
          eq(dispatchesTable.tipo, "traslado"),
          inArray(dispatchesTable.trasladoId, lockedTrasladoIds),
        ),
      );

    const byTraslado = new Map<number, string[]>();
    for (const dispatch of dispatches) {
      if (dispatch.trasladoId === null) continue;
      const estados = byTraslado.get(dispatch.trasladoId) ?? [];
      estados.push(dispatch.estado);
      byTraslado.set(dispatch.trasladoId, estados);
    }

    const fixes = new Map<TrasladoEstadoFromDispatch, number[]>();
    for (const traslado of traslados) {
      const target = deriveTrasladoEstadoFromDispatch(
        byTraslado.get(traslado.id) ?? [],
        traslado.estadoLogistico,
      );
      if (target === traslado.estadoLogistico) continue;
      const ids = fixes.get(target) ?? [];
      ids.push(traslado.id);
      fixes.set(target, ids);
    }

    let corrected = 0;
    const updates: Array<{
      estadoLogistico: TrasladoEstadoFromDispatch;
      trasladoIds: number[];
    }> = [];
    for (const [estadoLogistico, ids] of fixes) {
      const updated = await tx
        .update(trasladosTable)
        .set({ estadoLogistico })
        .where(
          and(
            inArray(trasladosTable.id, ids),
            notInArray(trasladosTable.estadoLogistico, [
              ...ODOO_TERMINAL_STATES,
            ]),
          ),
        )
        .returning({ id: trasladosTable.id });
      const updatedIds = updated.map(({ id }) => id);
      corrected += updatedIds.length;
      updates.push({ estadoLogistico, trasladoIds: updatedIds });
    }

    return { corrected, updates };
  });

  for (const { estadoLogistico, trasladoIds } of result.updates) {
    logger.info(
      { estadoLogistico, trasladoIds },
      "Reconciliación de estados de traslado",
    );
  }

  logger.info(
    { corrected: result.corrected },
    "Reconciliación de estados de traslado completada",
  );
  return result.corrected;
}