import type { Request } from "express";
import {
  resolveActorAccess,
} from "../middlewares/authorize";
import { listarAlmacenesDePersonal } from "./personnelAlmacenes";

export type AlmacenAccess =
  | { kind: "full" }
  | { kind: "limited"; almacenIds: number[] };

/**
 * Resolves warehouse scope fail-closed. Administrators and office personnel
 * have full scope; a warehouse operator has only explicitly assigned stores.
 */
export async function resolveAlmacenAccess(
  req: Request,
): Promise<AlmacenAccess> {
  const actor = await resolveActorAccess(req);
  if (actor.kind === "admin") {
    return { kind: "full" };
  }
  if (actor.kind !== "person") return { kind: "limited", almacenIds: [] };
  if (actor.person.rol === "oficina") return { kind: "full" };
  if (actor.person.rol !== "almacenista") {
    return { kind: "limited", almacenIds: [] };
  }

  const almacenes = await listarAlmacenesDePersonal(actor.person.id);
  return { kind: "limited", almacenIds: almacenes.map((almacen) => almacen.id) };
}

export function canOperateAlmacen(
  access: AlmacenAccess,
  almacenId: number | null,
): boolean {
  return access.kind === "full" || (almacenId !== null && access.almacenIds.includes(almacenId));
}

export function canAccessTraslado(
  access: AlmacenAccess,
  traslado: { almacenOrigenId: number | null; almacenDestinoId: number | null },
): boolean {
  return (
    canOperateAlmacen(access, traslado.almacenOrigenId) ||
    canOperateAlmacen(access, traslado.almacenDestinoId)
  );
}

export function canConfirmDispatchReception(
  access: AlmacenAccess,
  dispatch: {
    tipo: string;
    trasladoId: number | null;
    almacenDestinoId: number | null;
  },
): boolean {
  if (access.kind === "full") return true;
  return (
    dispatch.tipo === "traslado" &&
    dispatch.trasladoId !== null &&
    canOperateAlmacen(access, dispatch.almacenDestinoId)
  );
}