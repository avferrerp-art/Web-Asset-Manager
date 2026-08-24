import { and, eq, inArray, sql } from "drizzle-orm";
import { db, dispatchesTable, viajesTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type ViajeEstado = "planificado" | "en_curso" | "completado" | "cancelado";

export function deriveViajeEstado(dispatchEstados: string[]): ViajeEstado {
  if (dispatchEstados.length === 0) return "planificado";
  if (dispatchEstados.every((estado) => estado === "cancelado")) return "cancelado";
  if (
    dispatchEstados
      .filter((estado) => estado !== "cancelado")
      .every((estado) => estado === "entregado")
  ) {
    return "completado";
  }
  return "en_curso";
}

/** Derives the persisted state in SQL so a stale application read cannot win. */
export function viajeEstadoUpdateSql(viajeId: number) {
  return sql`
    UPDATE viajes SET estado = CASE
      WHEN NOT EXISTS (SELECT 1 FROM dispatches WHERE viaje_id = ${viajeId})
        THEN 'planificado'
      WHEN NOT EXISTS (
        SELECT 1 FROM dispatches
        WHERE viaje_id = ${viajeId} AND estado <> 'cancelado'
      ) THEN 'cancelado'
      WHEN NOT EXISTS (
        SELECT 1 FROM dispatches
        WHERE viaje_id = ${viajeId}
          AND estado <> 'cancelado'
          AND estado <> 'entregado'
      ) THEN 'completado'
      ELSE 'en_curso'
    END
    WHERE id = ${viajeId}
  `;
}

export async function syncViajeEstadoFromDispatch(viajeId: number): Promise<void> {
  await db.execute(viajeEstadoUpdateSql(viajeId));
}

export async function reconcileViajeEstados(onlyViajeIds?: number[]): Promise<number> {
  if (onlyViajeIds?.length === 0) return 0;
  const result = await db.transaction(async (tx) => {
    const viajes = await tx
      .select({ id: viajesTable.id, estado: viajesTable.estado })
      .from(viajesTable)
      .where(onlyViajeIds ? inArray(viajesTable.id, onlyViajeIds) : undefined)
      .for("update");
    if (viajes.length === 0) return 0;
    const ids = viajes.map((viaje) => viaje.id);
    const dispatches = await tx
      .select({ viajeId: dispatchesTable.viajeId, estado: dispatchesTable.estado })
      .from(dispatchesTable)
      .where(inArray(dispatchesTable.viajeId, ids));
    const estados = new Map<number, string[]>();
    for (const dispatch of dispatches) {
      if (dispatch.viajeId === null) continue;
      const values = estados.get(dispatch.viajeId) ?? [];
      values.push(dispatch.estado);
      estados.set(dispatch.viajeId, values);
    }
    let corrected = 0;
    for (const viaje of viajes) {
      const estado = deriveViajeEstado(estados.get(viaje.id) ?? []);
      if (estado === viaje.estado) continue;
      const updated = await tx
        .update(viajesTable)
        .set({ estado })
        .where(and(eq(viajesTable.id, viaje.id), eq(viajesTable.estado, viaje.estado)))
        .returning({ id: viajesTable.id });
      corrected += updated.length;
    }
    return corrected;
  });
  logger.info({ corrected: result }, "Reconciliación de estados de viaje completada");
  return result;
}