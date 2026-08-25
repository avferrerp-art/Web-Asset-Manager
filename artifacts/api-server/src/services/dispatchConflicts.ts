import { and, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import {
  dispatchesTable,
  personnelTable,
  vehiclesTable,
} from "@workspace/db";

const RELEASED_STATES = ["entregado", "cancelado"] as const;

export class DispatchConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DispatchConflictError";
  }
}

export type DispatchConflictCandidate = Pick<
  typeof dispatchesTable.$inferSelect,
  | "id"
  | "tipo"
  | "ventaId"
  | "trasladoId"
  | "vehiculoId"
  | "choferId"
  | "ayudanteId"
  | "fechaEstimadaSalida"
  | "fechaEstimadaLlegada"
  | "estado"
  | "cargaParcial"
  | "viajeId"
>;

type ConflictOptions = {
  excludeDispatchIds?: number[];
  excludeViajeId?: number | null;
};

function overlapsStrictly(
  left: Pick<DispatchConflictCandidate, "fechaEstimadaSalida" | "fechaEstimadaLlegada">,
  right: Pick<DispatchConflictCandidate, "fechaEstimadaSalida" | "fechaEstimadaLlegada">,
): boolean {
  return (
    new Date(left.fechaEstimadaSalida).getTime() <
      new Date(right.fechaEstimadaLlegada).getTime() &&
    new Date(right.fechaEstimadaSalida).getTime() <
      new Date(left.fechaEstimadaLlegada).getTime()
  );
}

function sharedPerson(
  candidate: DispatchConflictCandidate,
  existing: typeof dispatchesTable.$inferSelect,
): number | null {
  const candidatePeople = [candidate.choferId, candidate.ayudanteId].filter(
    (id): id is number => id !== null,
  );
  const existingPeople = [existing.choferId, existing.ayudanteId].filter(
    (id): id is number => id !== null,
  );
  return candidatePeople.find((id) => existingPeople.includes(id)) ?? null;
}

function isSamePhysicalTrip(
  candidate: DispatchConflictCandidate,
  existing: typeof dispatchesTable.$inferSelect,
): boolean {
  return (
    candidate.vehiculoId === existing.vehiculoId &&
    candidate.choferId === existing.choferId &&
    candidate.ayudanteId === existing.ayudanteId &&
    new Date(candidate.fechaEstimadaSalida).getTime() ===
      new Date(existing.fechaEstimadaSalida).getTime() &&
    new Date(candidate.fechaEstimadaLlegada).getTime() ===
      new Date(existing.fechaEstimadaLlegada).getTime()
  );
}

function conflictScopeKeys(candidate: DispatchConflictCandidate): string[] {
  const keys = [
    `dispatch-resource:vehicle:${candidate.vehiculoId}`,
    `dispatch-resource:person:${candidate.choferId}`,
  ];
  if (candidate.ayudanteId !== null) {
    keys.push(`dispatch-resource:person:${candidate.ayudanteId}`);
  }
  if (candidate.tipo === "venta" && candidate.ventaId !== null) {
    keys.push(`dispatch-order:sale:${candidate.ventaId}`);
  }
  if (candidate.tipo === "traslado" && candidate.trasladoId !== null) {
    keys.push(`dispatch-order:transfer:${candidate.trasladoId}`);
  }
  return keys;
}

export async function lockDispatchConflictScopes(
  executor: any,
  candidates: DispatchConflictCandidate[],
): Promise<void> {
  const keys = [...new Set(candidates.flatMap(conflictScopeKeys))].sort();
  for (const key of keys) {
    await executor.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }
}

export async function validateOperationalConflicts(
  executor: any,
  candidate: DispatchConflictCandidate,
  options: ConflictOptions = {},
): Promise<void> {
  if (RELEASED_STATES.includes(candidate.estado as (typeof RELEASED_STATES)[number])) {
    return;
  }
  const conditions = [
    notInArray(dispatchesTable.estado, [...RELEASED_STATES]),
  ];
  const excludedIds = [...new Set([
    ...(options.excludeDispatchIds ?? []),
    ...(candidate.id ? [candidate.id] : []),
  ])];
  if (excludedIds.length > 0) {
    conditions.push(notInArray(dispatchesTable.id, excludedIds));
  }
  if (options.excludeViajeId != null) {
    conditions.push(or(
      isNull(dispatchesTable.viajeId),
      ne(dispatchesTable.viajeId, options.excludeViajeId),
    )!);
  }
  const occupied = await executor
    .select()
    .from(dispatchesTable)
    .where(and(...conditions));

  for (const existing of occupied) {
    if (!overlapsStrictly(candidate, existing)) continue;
    if (isSamePhysicalTrip(candidate, existing)) continue;
    if (existing.vehiculoId === candidate.vehiculoId) {
      const [vehicle] = await executor
        .select({ modelo: vehiclesTable.modelo })
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, candidate.vehiculoId));
      throw new DispatchConflictError(
        "vehicle_schedule_conflict",
        `El vehículo ${vehicle?.modelo ?? `#${candidate.vehiculoId}`} ya está asignado al despacho #${existing.id} en ese horario.`,
      );
    }
    const personId = sharedPerson(candidate, existing);
    if (personId !== null) {
      const [person] = await executor
        .select({ nombre: personnelTable.nombre })
        .from(personnelTable)
        .where(eq(personnelTable.id, personId));
      throw new DispatchConflictError(
        "person_schedule_conflict",
        `La persona ${person?.nombre ?? `#${personId}`} ya está asignada al despacho #${existing.id} en ese horario.`,
      );
    }
  }
}

export async function validateOrderLoadCoherence(
  executor: any,
  candidate: DispatchConflictCandidate,
): Promise<void> {
  if (candidate.estado === "cancelado") return;
  const entityCondition =
    candidate.tipo === "venta" && candidate.ventaId !== null
      ? eq(dispatchesTable.ventaId, candidate.ventaId)
      : candidate.tipo === "traslado" && candidate.trasladoId !== null
        ? eq(dispatchesTable.trasladoId, candidate.trasladoId)
        : null;
  if (!entityCondition) return;
  const existing = await executor
    .select({ id: dispatchesTable.id, cargaParcial: dispatchesTable.cargaParcial })
    .from(dispatchesTable)
    .where(and(
      entityCondition,
      ne(dispatchesTable.estado, "cancelado"),
      candidate.id ? ne(dispatchesTable.id, candidate.id) : undefined,
    ));
  const conflict = existing.find(
    (dispatch: { cargaParcial: boolean }) =>
      dispatch.cargaParcial !== candidate.cargaParcial,
  );
  if (conflict) {
    throw new DispatchConflictError(
      "order_load_mode_conflict",
      `La orden ya tiene el despacho #${conflict.id} con una modalidad de carga incompatible (parcial/completa).`,
    );
  }
}

export async function validateDispatchCandidate(
  executor: any,
  candidate: DispatchConflictCandidate,
  options: ConflictOptions = {},
): Promise<void> {
  await lockDispatchConflictScopes(executor, [candidate]);
  await validateOperationalConflicts(executor, candidate, options);
  await validateOrderLoadCoherence(executor, candidate);
}