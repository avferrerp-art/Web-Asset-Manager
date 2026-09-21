import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  createAuditCriticalMutations,
  targetIdFromPath,
  type AuditCompletion,
  type AuditIntent,
  type AuditStore,
} from "../../artifacts/api-server/src/middlewares/auditCriticalMutations";

const actor = () => "user_test_123";

function response() {
  const headers = new Map<string, string>();
  let body: unknown;
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      this.end(JSON.stringify(value));
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end(value?: unknown) {
      body = value ?? body;
      return this;
    },
  } as unknown as Response;
  return { res, headers, body: () => body };
}

function request(path = "/dispatches/41"): Request {
  return {
    method: "PATCH",
    baseUrl: "/api",
    path,
  } as Request;
}

describe("critical mutation audit middleware", () => {
  it("persists target identity and successful completion", async () => {
    const intents: AuditIntent[] = [];
    const completions: AuditCompletion[] = [];
    const store: AuditStore = {
      async begin(intent) {
        intents.push(intent);
        return 7;
      },
      async complete(_id, completion) {
        completions.push(completion);
      },
    };
    const { res } = response();
    const next: NextFunction = () => {
      res.status(201).end();
    };

    await createAuditCriticalMutations(store, undefined, actor)(request(), res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(intents).toEqual([{
      actorId: "user_test_123",
      action: "PATCH",
      resource: "/api/dispatches/:id",
      targetId: 41,
    }]);
    expect(completions).toEqual([{ result: "success", statusCode: 201 }]);
  });

  it("records authorization denials", async () => {
    const completions: AuditCompletion[] = [];
    const store: AuditStore = {
      async begin() {
        return 8;
      },
      async complete(_id, completion) {
        completions.push(completion);
      },
    };
    const { res } = response();
    await createAuditCriticalMutations(store, undefined, actor)(request(), res, () => {
      res.status(403).json({ error: "Forbidden" });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completions).toEqual([{ result: "denied", statusCode: 403 }]);
  });

  it("blocks the mutation when durable intent storage is unavailable", async () => {
    const next = vi.fn();
    const store: AuditStore = {
      async begin() {
        throw new Error("database unavailable");
      },
      async complete() {},
    };
    const { res, body } = response();
    await createAuditCriticalMutations(store, undefined, actor)(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(String(body())).toContain("audit_unavailable");
  });

  it("surfaces uncertain completion without a retryable status", async () => {
    const alert = vi.fn();
    const store: AuditStore = {
      async begin() {
        return 9;
      },
      async complete() {
        throw new Error("completion failed");
      },
    };
    const { res, headers } = response();
    await createAuditCriticalMutations(store, alert, actor)(request(), res, () => {
      res.status(200).end();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(res.statusCode).toBe(200);
    expect(headers.get("x-audit-status")).toBe("completion-uncertain");
    expect(headers.get("x-audit-intent-id")).toBe("9");
    expect(alert).toHaveBeenCalledOnce();
  });

  it("accepts only positive safe integer target IDs", () => {
    expect(targetIdFromPath("/dispatches/42/approve")).toBe(42);
    expect(targetIdFromPath("/dispatches/not-an-id")).toBeNull();
    expect(targetIdFromPath("/dispatches/9007199254740992")).toBeNull();
  });

  it("captures a created resource ID from a POST response without storing its body", async () => {
    const intents: AuditIntent[] = [];
    const completions: AuditCompletion[] = [];
    const store: AuditStore = {
      async begin(intent) {
        intents.push(intent);
        return 10;
      },
      async complete(_id, completion) {
        completions.push(completion);
      },
    };
    const { res } = response();
    const req = request("/personnel");
    req.method = "POST";
    await createAuditCriticalMutations(store, undefined, actor)(req, res, () => {
      res.status(201).json({ id: 73, nombre: "not persisted by audit" });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(intents[0]).toMatchObject({ targetId: null });
    expect(completions).toEqual([
      { result: "success", statusCode: 201, targetId: 73 },
    ]);
    expect(JSON.stringify({ intents, completions })).not.toContain("not persisted");
  });
});