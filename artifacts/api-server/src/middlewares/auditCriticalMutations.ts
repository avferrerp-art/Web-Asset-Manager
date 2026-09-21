import { getAuth } from "@clerk/express";
import { auditEventsTable, db } from "@workspace/db";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface AuditIntent {
  actorId: string | null;
  action: string;
  resource: string;
  targetId: number | null;
}

export interface AuditCompletion {
  result: "success" | "denied" | "failure";
  statusCode: number;
  targetId?: number;
}

export interface AuditStore {
  begin(intent: AuditIntent): Promise<number>;
  complete(id: number, completion: AuditCompletion): Promise<void>;
}

function normalizedResource(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/\d+(?=\/|$)/g, "/:id");
}

export function targetIdFromPath(path: string): number | null {
  for (const segment of path.split("/")) {
    if (!/^[1-9]\d*$/.test(segment)) continue;
    const id = Number(segment);
    if (Number.isSafeInteger(id)) return id;
  }
  return null;
}

function resultForStatus(status: number): AuditCompletion["result"] {
  if (status === 401 || status === 403) return "denied";
  if (status >= 400) return "failure";
  return "success";
}

const databaseAuditStore: AuditStore = {
  async begin(intent) {
    const [created] = await db
      .insert(auditEventsTable)
      .values({ ...intent, result: "intent", statusCode: null })
      .returning({ id: auditEventsTable.id });
    if (!created) throw new Error("Audit intent was not persisted");
    return created.id;
  },
  async complete(id, completion) {
    const [updated] = await db
      .update(auditEventsTable)
      .set(completion)
      .where(eq(auditEventsTable.id, id))
      .returning({ id: auditEventsTable.id });
    if (!updated) throw new Error("Audit intent no longer exists");
  },
};

export function createAuditCriticalMutations(
  store: AuditStore,
  alert: (error: unknown, intentId: number, completion: AuditCompletion) => void =
    (error, intentId, completion) => {
      logger.error(
        { err: error, auditIntentId: intentId, ...completion },
        "ALERTA: resultado de auditoría incierto; el intento durable permanece pendiente",
      );
    },
  resolveActorId: (req: Request) => string | null = (req) => {
    const auth = getAuth(req);
    return (
      (auth?.sessionClaims?.["userId"] as string | undefined) ??
      auth?.userId ??
      null
    );
  },
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const actorId = resolveActorId(req);
    const path = `${req.baseUrl}${req.path}`.replace(/\/+/g, "/");
    let intentId: number;
    try {
      intentId = await store.begin({
        actorId,
        action: req.method,
        resource: normalizedResource(path),
        targetId: targetIdFromPath(path),
      });
    } catch (error) {
      logger.error(
        { err: error, action: req.method, resource: normalizedResource(path) },
        "No se pudo persistir la intención de auditoría; operación bloqueada",
      );
      res.status(503).json({
        error: "audit_unavailable",
        message: "La operación no se inició porque la auditoría no está disponible.",
      });
      return;
    }

    const originalEnd = res.end.bind(res);
    const originalJson = res.json.bind(res);
    let ending = false;
    let createdTargetId: number | undefined;
    res.json = ((body: unknown) => {
      if (
        req.method === "POST" &&
        body !== null &&
        typeof body === "object" &&
        !Array.isArray(body)
      ) {
        const id = (body as { id?: unknown }).id;
        if (
          typeof id === "number" &&
          Number.isSafeInteger(id) &&
          id > 0
        ) {
          createdTargetId = id;
        }
      }
      return originalJson(body);
    }) as Response["json"];
    res.end = ((...args: Parameters<Response["end"]>) => {
      if (ending) return res;
      ending = true;
      res.end = originalEnd;

      const completion: AuditCompletion = {
        result: resultForStatus(res.statusCode),
        statusCode: res.statusCode,
        ...(createdTargetId !== undefined ? { targetId: createdTargetId } : {}),
      };
      void store
        .complete(intentId, completion)
        .then(() => originalEnd(...args))
        .catch((error: unknown) => {
          // The business mutation may already be committed. Keep the durable
          // intent pending, alert operators, and do not return a retryable 5xx
          // that could cause the client to duplicate the mutation.
          alert(error, intentId, completion);
          if (!res.headersSent) {
            res.setHeader("x-audit-status", "completion-uncertain");
            res.setHeader("x-audit-intent-id", String(intentId));
          }
          originalEnd(...args);
        });
      return res;
    }) as Response["end"];

    next();
  };
}

export const auditCriticalMutations =
  createAuditCriticalMutations(databaseAuditStore);