import type { NextFunction, Request, Response } from "express";
import type { Personnel } from "@workspace/db";
import { resolveCurrentPerson } from "../services/currentPerson";

export type ActorAccess =
  | { kind: "admin"; person: Personnel | null }
  | { kind: "person"; person: Personnel }
  | { kind: "unlinked" };

const actorCache = new WeakMap<Request, Promise<ActorAccess>>();

function configuredAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function hasAdministratorBootstrap(
  value: string | undefined,
): boolean {
  return Boolean(
    value
      ?.split(",")
      .map((email) => email.trim())
      .some(Boolean),
  );
}

export function isAdministratorEmail(email: string | null | undefined): boolean {
  return Boolean(email && configuredAdminEmails().has(email.toLowerCase()));
}

export function resolveActorAccess(req: Request): Promise<ActorAccess> {
  const cached = actorCache.get(req);
  if (cached) return cached;

  const pending = resolveCurrentPerson(req).then((current): ActorAccess => {
    const email = current.ok ? current.person.email : current.email;
    if (isAdministratorEmail(email)) {
      return { kind: "admin", person: current.ok ? current.person : null };
    }
    return current.ok
      ? { kind: "person", person: current.person }
      : { kind: "unlinked" };
  });
  actorCache.set(req, pending);
  return pending;
}

export function isAuthorizedRequest(
  actor: ActorAccess,
  method: string,
  path: string,
): boolean {
  if (actor.kind === "admin") return true;
  if (actor.kind === "unlinked") return false;

  const role = actor.person.rol;
  const isDriverPath = path === "/driver" || path.startsWith("/driver/");
  if (isDriverPath) return role === "chofer";
  if (role === "chofer" || role === "ayudante") return false;

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    if (role === "oficina") return true;
    if (role !== "almacenista") return false;
    return (
      path === "/almacenes" ||
      path === "/traslados" ||
      /^\/traslados\/\d+$/.test(path)
    );
  }
  if (role === "oficina") return true;
  if (role !== "almacenista") return false;

  return (
    (method === "PATCH" && /^\/traslados\/\d+$/.test(path)) ||
    (method === "PATCH" && /^\/dispatches\/\d+\/acta$/.test(path))
  );
}

export async function requireAuthorization(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!hasAdministratorBootstrap(process.env.ADMIN_EMAILS)) {
    res.status(403).json({
      error: "access_setup_required",
      message:
        "El acceso por roles aún no está configurado. Define ADMIN_EMAILS con al menos una cuenta responsable.",
    });
    return;
  }
  const actor = await resolveActorAccess(req);
  if (!isAuthorizedRequest(actor, req.method, req.path)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}