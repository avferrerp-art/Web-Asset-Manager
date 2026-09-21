import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import type { Personnel } from "@workspace/db";
import {
  hasAdministratorBootstrap,
  isAuthorizedRequest,
  requireAuthorization,
  type ActorAccess,
} from "../../artifacts/api-server/src/middlewares/authorize";
import {
  canAccessTraslado,
  canConfirmDispatchReception,
  canOperateAlmacen,
} from "../../artifacts/api-server/src/services/almacenAccess";

function actor(rol: string, id = 1): ActorAccess {
  return {
    kind: "person",
    person: {
      id,
      nombre: rol,
      rol,
      tarifaPorKm: 0,
      telefono: null,
      email: `${rol}@test.invalid`,
      createdAt: new Date(0),
    } satisfies Personnel,
  };
}

describe("authorization policy", () => {
  it("requires an explicit administrator bootstrap", () => {
    expect(hasAdministratorBootstrap(undefined)).toBe(false);
    expect(hasAdministratorBootstrap(" , ")).toBe(false);
    expect(hasAdministratorBootstrap("responsable@test.invalid")).toBe(true);
  });

  it("returns a distinct setup-required denial when bootstrap is absent", async () => {
    const previous = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    } as unknown as Response;
    try {
      await requireAuthorization({} as Request, res, () => {
        throw new Error("authorization unexpectedly continued");
      });
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
    }
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: "access_setup_required" });
  });

  it("keeps management mutations with office or explicit administrators", () => {
    expect(isAuthorizedRequest(actor("oficina"), "DELETE", "/vehicles/2")).toBe(true);
    expect(
      isAuthorizedRequest({ kind: "admin", person: null }, "DELETE", "/vehicles/2"),
    ).toBe(true);
    expect(isAuthorizedRequest(actor("almacenista"), "DELETE", "/vehicles/2")).toBe(false);
  });

  it("isolates driver APIs from other roles and management APIs from drivers", () => {
    expect(isAuthorizedRequest(actor("chofer"), "GET", "/driver/dispatches")).toBe(true);
    expect(isAuthorizedRequest(actor("chofer"), "POST", "/driver/dispatches/8/status")).toBe(true);
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/driver/dispatches")).toBe(false);
    expect(isAuthorizedRequest(actor("chofer"), "GET", "/personnel")).toBe(false);
    expect(isAuthorizedRequest(actor("ayudante"), "GET", "/driver/dispatches")).toBe(false);
  });

  it("allows only warehouse-scoped mutations for warehouse personnel", () => {
    expect(isAuthorizedRequest(actor("almacenista"), "PATCH", "/traslados/9")).toBe(true);
    expect(
      isAuthorizedRequest(actor("almacenista"), "PATCH", "/dispatches/9/acta"),
    ).toBe(true);
    expect(isAuthorizedRequest(actor("almacenista"), "POST", "/dispatches")).toBe(false);
  });

  it("does not grant warehouse personnel broad read access", () => {
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/almacenes")).toBe(true);
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/traslados/9")).toBe(true);
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/sales")).toBe(false);
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/personnel")).toBe(false);
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/dispatches")).toBe(false);
    expect(isAuthorizedRequest(actor("almacenista"), "GET", "/viajes")).toBe(false);
  });

  it("fails closed for missing and unrelated warehouse assignments", () => {
    const none = { kind: "limited" as const, almacenIds: [] };
    const assigned = { kind: "limited" as const, almacenIds: [2] };
    expect(canOperateAlmacen(none, 2)).toBe(false);
    expect(canOperateAlmacen(assigned, 3)).toBe(false);
    expect(canAccessTraslado(assigned, { almacenOrigenId: 2, almacenDestinoId: 3 })).toBe(true);
    expect(canAccessTraslado(assigned, { almacenOrigenId: 4, almacenDestinoId: 3 })).toBe(false);
  });

  it("allows warehouse reception only for an assigned concrete transfer destination", () => {
    const warehouse = { kind: "limited" as const, almacenIds: [2] };
    expect(
      canConfirmDispatchReception(warehouse, {
        tipo: "traslado",
        trasladoId: 11,
        almacenDestinoId: 2,
      }),
    ).toBe(true);
    expect(
      canConfirmDispatchReception(warehouse, {
        tipo: "traslado",
        trasladoId: 11,
        almacenDestinoId: null,
      }),
    ).toBe(false);
    expect(
      canConfirmDispatchReception(warehouse, {
        tipo: "venta",
        trasladoId: null,
        almacenDestinoId: null,
      }),
    ).toBe(false);
    expect(
      canConfirmDispatchReception({ kind: "full" }, {
        tipo: "venta",
        trasladoId: null,
        almacenDestinoId: null,
      }),
    ).toBe(true);
  });
});