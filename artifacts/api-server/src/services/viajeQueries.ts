import {
  and,
  asc,
  desc,
  eq,
  inArray,
  max,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  dispatchesTable,
  personnelTable,
  salesTable,
  trasladosTable,
  vehiclesTable,
  viajesTable,
} from "@workspace/db";
import { effectiveDispatchMeasure, exceedsDispatchCapacity } from "./dispatchCapacity";
import { deriveViajeEstado, viajeEstadoUpdateSql } from "./viajeEstadoSync";

export class ViajeInputError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ViajeInputError";
  }
}

type ViajeInput = {
  vehiculoId: number;
  choferId: number;
  ayudanteId?: number | null;
  fecha: string;
  despachoIds: number[];
  notas?: string | null;
};

type ViajeUpdate = {
  vehiculoId?: number;
  choferId?: number;
  ayudanteId?: number | null;
  fecha?: string;
  notas?: string | null;
  distanciaTotalKm?: number | null;
  totalPeajesEstimado?: number | null;
};

async function loadDispatchCargoWith(
  executor: any,
  dispatch: typeof dispatchesTable.$inferSelect,
) {
  if (dispatch.tipo === "venta" && dispatch.ventaId !== null) {
    const [sale] = await executor
      .select({ pesoKg: salesTable.pesoTotal, volumenM3: salesTable.volumenTotal })
      .from(salesTable)
      .where(eq(salesTable.id, dispatch.ventaId));
    return {
      pesoKg: effectiveDispatchMeasure(sale?.pesoKg, dispatch.pesoEstimadoKg, true),
      volumenM3: effectiveDispatchMeasure(sale?.volumenM3, dispatch.volumenEstimadoM3, true),
    };
  }
  if (dispatch.tipo === "traslado" && dispatch.trasladoId !== null) {
    const [traslado] = await executor
      .select({
        pesoCalculadoKg: trasladosTable.pesoCalculadoKg,
        pesoEstimadoKg: trasladosTable.pesoEstimadoKg,
        volumenM3: trasladosTable.volumenCalculadoM3,
      })
      .from(trasladosTable)
      .where(eq(trasladosTable.id, dispatch.trasladoId));
    return {
      pesoKg: effectiveDispatchMeasure(traslado?.pesoCalculadoKg, dispatch.pesoEstimadoKg),
      volumenM3: effectiveDispatchMeasure(traslado?.volumenM3, dispatch.volumenEstimadoM3),
    };
  }
  return { pesoKg: null, volumenM3: null };
}

async function validateOperationalReferences(
  tx: any,
  input: { vehiculoId: number; choferId: number; ayudanteId?: number | null },
) {
  const [vehicle, driver] = await Promise.all([
    tx
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, input.vehiculoId))
      .then((rows: Array<typeof vehiclesTable.$inferSelect>) => rows[0] ?? null),
    tx
      .select()
      .from(personnelTable)
      .where(eq(personnelTable.id, input.choferId))
      .then((rows: Array<typeof personnelTable.$inferSelect>) => rows[0] ?? null),
  ]);
  if (!vehicle) {
    throw new ViajeInputError(400, "vehicle_not_found", "El vehículo indicado no existe.");
  }
  if (!driver) {
    throw new ViajeInputError(400, "driver_not_found", "El chofer indicado no existe.");
  }
  if (input.ayudanteId !== null && input.ayudanteId !== undefined) {
    const [assistant] = await tx
      .select()
      .from(personnelTable)
      .where(eq(personnelTable.id, input.ayudanteId));
    if (!assistant) {
      throw new ViajeInputError(400, "assistant_not_found", "El ayudante indicado no existe.");
    }
  }
  return vehicle;
}

async function validateCapacity(
  vehicle: typeof vehiclesTable.$inferSelect,
  dispatches: Array<typeof dispatchesTable.$inferSelect>,
  executor: any = db,
) {
  const carga = { pesoKg: 0, volumenM3: 0 };
  for (const dispatch of dispatches) {
    const dispatchCargo = await loadDispatchCargoWith(executor, dispatch);
    carga.pesoKg += dispatchCargo.pesoKg ?? 0;
    carga.volumenM3 += dispatchCargo.volumenM3 ?? 0;
  }
  if (exceedsDispatchCapacity(vehicle, carga)) {
    throw new ViajeInputError(
      400,
      "vehicle_capacity_exceeded",
      `El vehículo ${vehicle.modelo} no alcanza para la carga consolidada de los despachos seleccionados (${carga.pesoKg}kg / ${carga.volumenM3}m³).`,
    );
  }
}

export async function listViajes(filters: { estado?: string; fecha?: string } = {}) {
  const driverTable = alias(personnelTable, "viaje_chofer");
  const assistantTable = alias(personnelTable, "viaje_ayudante");
  const conditions: SQL[] = [];
  if (filters.estado) conditions.push(eq(viajesTable.estado, filters.estado));
  if (filters.fecha) conditions.push(eq(viajesTable.fecha, filters.fecha));
  const rows = await db
    .select({
      viaje: viajesTable,
      vehiculoModelo: vehiclesTable.modelo,
      choferNombre: driverTable.nombre,
      ayudanteNombre: assistantTable.nombre,
      cantidadDespachos: sql<number>`(
        SELECT count(*)::int
        FROM dispatches AS viaje_dispatch
        WHERE viaje_dispatch.viaje_id = ${viajesTable.id}
      )`,
    })
    .from(viajesTable)
    .leftJoin(vehiclesTable, eq(viajesTable.vehiculoId, vehiclesTable.id))
    .leftJoin(driverTable, eq(viajesTable.choferId, driverTable.id))
    .leftJoin(assistantTable, eq(viajesTable.ayudanteId, assistantTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(viajesTable.fecha), desc(viajesTable.id));
  return rows.map(({ viaje, cantidadDespachos, ...joined }) => ({
    ...viaje,
    ...joined,
    cantidadDespachos: Number(cantidadDespachos),
  }));
}

export async function getViajeRecord(id: number) {
  const [viaje] = await db.select().from(viajesTable).where(eq(viajesTable.id, id));
  if (!viaje) return null;
  const dispatches = await db
    .select()
    .from(dispatchesTable)
    .where(eq(dispatchesTable.viajeId, id))
    .orderBy(dispatchesTable.orden, dispatchesTable.id);
  const cargas = await Promise.all(
    dispatches.map((dispatch) => loadDispatchCargoWith(db, dispatch)),
  );
  return {
    viaje,
    dispatches,
    carga: {
      pesoTotalKg: cargas.reduce((total, carga) => total + (carga.pesoKg ?? 0), 0),
      volumenTotalM3: cargas.reduce((total, carga) => total + (carga.volumenM3 ?? 0), 0),
      pesoIncompleto: cargas.some((carga) => carga.pesoKg === null),
      volumenIncompleto: cargas.some((carga) => carga.volumenM3 === null),
    },
  };
}

export async function createViaje(input: ViajeInput) {
  if (new Set(input.despachoIds).size !== input.despachoIds.length) {
    throw new ViajeInputError(400, "duplicate_dispatch", "Un despacho no puede repetirse dentro del viaje.");
  }
  return db.transaction(async (tx) => {
    const vehicle = await validateOperationalReferences(tx, input);
    const dispatches = await tx
      .select()
      .from(dispatchesTable)
      .where(inArray(dispatchesTable.id, input.despachoIds))
      .for("update");
    if (dispatches.length !== input.despachoIds.length) {
      throw new ViajeInputError(404, "dispatch_not_found", "Uno o más despachos no existen.");
    }
    if (dispatches.some((dispatch) => dispatch.viajeId !== null)) {
      throw new ViajeInputError(400, "dispatch_already_assigned", "Uno o más despachos ya pertenecen a otro viaje.");
    }
    await validateCapacity(vehicle, dispatches, tx);
    const [viaje] = await tx
      .insert(viajesTable)
      .values({
        vehiculoId: input.vehiculoId,
        choferId: input.choferId,
        ayudanteId: input.ayudanteId ?? null,
        fecha: input.fecha,
        notas: input.notas ?? null,
      })
      .returning();
    for (const [index, dispatchId] of input.despachoIds.entries()) {
      await tx
        .update(dispatchesTable)
        .set({
          viajeId: viaje!.id,
          orden: index + 1,
          vehiculoId: viaje!.vehiculoId,
          choferId: viaje!.choferId,
          ayudanteId: viaje!.ayudanteId,
        })
        .where(eq(dispatchesTable.id, dispatchId));
    }
    const estados = dispatches.map((dispatch) => dispatch.estado);
    const estado = deriveViajeEstado(estados);
    const [updated] = await tx
      .update(viajesTable)
      .set({ estado })
      .where(eq(viajesTable.id, viaje!.id))
      .returning();
    return updated!;
  });
}

export async function updateViaje(id: number, data: ViajeUpdate) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(viajesTable)
      .where(eq(viajesTable.id, id))
      .for("update");
    if (!existing) return null;
    const operational = {
      vehiculoId: data.vehiculoId ?? existing.vehiculoId,
      choferId: data.choferId ?? existing.choferId,
      ayudanteId: "ayudanteId" in data ? data.ayudanteId : existing.ayudanteId,
    };
    const vehicle = await validateOperationalReferences(tx, operational);
    const members = await tx
      .select()
      .from(dispatchesTable)
      .where(eq(dispatchesTable.viajeId, id))
      .for("update");
    await validateCapacity(vehicle, members, tx);
    const [viaje] = await tx
      .update(viajesTable)
      .set(data)
      .where(eq(viajesTable.id, id))
      .returning();
    if (members.length > 0) {
      await tx
        .update(dispatchesTable)
        .set(operational)
        .where(eq(dispatchesTable.viajeId, id));
    }
    return viaje!;
  });
}

const PRESERVE_CURRENT_VIAJE = Symbol("preserve-current-viaje");

async function mutateDispatchViaje(
  dispatchId: number,
  requestedViajeId: number | null | typeof PRESERVE_CURRENT_VIAJE,
  updateData: Record<string, unknown>,
) {
  const [snapshot] = await db
    .select({ viajeId: dispatchesTable.viajeId })
    .from(dispatchesTable)
    .where(eq(dispatchesTable.id, dispatchId));
  if (!snapshot) return null;
  const targetViajeId =
    requestedViajeId === PRESERVE_CURRENT_VIAJE
      ? snapshot.viajeId
      : requestedViajeId;

  return db.transaction(async (tx) => {
    const viajeIds = [...new Set(
      [snapshot.viajeId, targetViajeId].filter(
        (id): id is number => id !== null,
      ),
    )].sort((left, right) => left - right);
    const lockedViajes =
      viajeIds.length > 0
        ? await tx
            .select()
            .from(viajesTable)
            .where(inArray(viajesTable.id, viajeIds))
            .orderBy(asc(viajesTable.id))
            .for("update")
        : [];
    const targetViaje =
      targetViajeId === null
        ? null
        : lockedViajes.find((viaje) => viaje.id === targetViajeId) ?? null;
    if (targetViajeId !== null && !targetViaje) {
      throw new ViajeInputError(404, "viaje_not_found", "El viaje indicado no existe.");
    }

    const [dispatch] = await tx
      .select()
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, dispatchId))
      .for("update");
    if (!dispatch) return null;
    if (dispatch.viajeId !== snapshot.viajeId) {
      throw new ViajeInputError(
        409,
        "dispatch_membership_changed",
        "El despacho cambió de viaje durante la operación. Intenta nuevamente.",
      );
    }

    let membershipData: Record<string, unknown> =
      targetViajeId === dispatch.viajeId
        ? { viajeId: dispatch.viajeId, orden: dispatch.orden }
        : { viajeId: null, orden: null };
    if (targetViaje) {
      const [vehicle] = await tx
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, targetViaje.vehiculoId));
      if (!vehicle) {
        throw new ViajeInputError(
          400,
          "vehicle_not_found",
          "El vehículo del viaje no existe.",
        );
      }
      const targetMembers = await tx
        .select()
        .from(dispatchesTable)
        .where(eq(dispatchesTable.viajeId, targetViaje.id))
        .for("update");
      const candidate = {
        ...dispatch,
        ...updateData,
        vehiculoId: targetViaje.vehiculoId,
        choferId: targetViaje.choferId,
        ayudanteId: targetViaje.ayudanteId,
      };
      await validateCapacity(
        vehicle,
        [
          ...targetMembers.filter((member) => member.id !== dispatch.id),
          candidate,
        ],
        tx,
      );
      const sameViaje = targetViaje.id === dispatch.viajeId;
      const order = sameViaje
        ? dispatch.orden
        : ((await tx
            .select({ order: max(dispatchesTable.orden) })
            .from(dispatchesTable)
            .where(eq(dispatchesTable.viajeId, targetViaje.id)))[0]?.order ?? 0) + 1;
      membershipData = {
        viajeId: targetViaje.id,
        orden: order,
        vehiculoId: targetViaje.vehiculoId,
        choferId: targetViaje.choferId,
        ayudanteId: targetViaje.ayudanteId,
      };
    }
    const [updated] = await tx
      .update(dispatchesTable)
      .set({ ...updateData, ...membershipData })
      .where(eq(dispatchesTable.id, dispatch.id))
      .returning();
    for (const viajeId of viajeIds) {
      await tx.execute(viajeEstadoUpdateSql(viajeId));
    }
    return updated ?? null;
  });
}

export async function reassignDispatchViaje(
  dispatchId: number,
  targetViajeId: number | null,
  updateData: Record<string, unknown>,
) {
  return mutateDispatchViaje(dispatchId, targetViajeId, updateData);
}

export async function updateDispatchPreservingViaje(
  dispatchId: number,
  updateData: Record<string, unknown>,
) {
  return mutateDispatchViaje(dispatchId, PRESERVE_CURRENT_VIAJE, updateData);
}