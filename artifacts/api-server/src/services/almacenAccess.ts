import type { Request } from "express";
import { logger } from "../lib/logger";
import { resolveCurrentPerson } from "./currentPerson";
import { listarAlmacenesDePersonal } from "./personnelAlmacenes";

export type AlmacenAccess =
  | { kind: "full" }
  | { kind: "limited"; almacenIds: number[] };

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resolves the authenticated user's operational warehouse scope. Only linked
 * warehouse operators with actual assignments are restricted; every ambiguous
 * or incomplete personnel record intentionally preserves current full access.
 */
export async function resolveAlmacenAccess(
  req: Request,
): Promise<AlmacenAccess> {
  const current = await resolveCurrentPerson(req);
  const email = current.ok ? current.person.email : current.email;

  if (email && adminEmails().has(email.toLowerCase())) {
    return { kind: "full" };
  }
  if (!current.ok || current.person.rol !== "almacenista") {
    return { kind: "full" };
  }

  const almacenes = await listarAlmacenesDePersonal(current.person.id);
  if (almacenes.length === 0) {
    logger.warn(
      { personnelId: current.person.id },
      "Almacenista sin almacenes asignados; se concede acceso total por resguardo operativo",
    );
    return { kind: "full" };
  }

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