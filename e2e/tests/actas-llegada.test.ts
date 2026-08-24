import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  actasLlegadaTable,
  db,
  dispatchesTable,
  personnelTable,
  pool,
  runMigrations,
  salesTable,
  vehiclesTable,
} from "@workspace/db";
import { sql as actasMigrationSql } from "../../lib/db/src/migrations/0011_actas_llegada";
import { sql as dispatchesMigrationSql } from "../../lib/db/src/migrations/0010_dispatches_polimorficos";
import type { CurrentPersonResult } from "../../artifacts/api-server/src/services/currentPerson";

// ── hoisted mutable mock for currentPerson ─────────────────────────────────
const currentPersonMock = vi.hoisted(() => ({
  result: null as CurrentPersonResult | null,
}));

vi.mock("../../artifacts/api-server/src/services/currentPerson", () => ({
  resolveCurrentPerson: async () => currentPersonMock.result,
}));

// ── requireAuth mock ────────────────────────────────────────────────────────
vi.mock("../../artifacts/api-server/src/middlewares/requireAuth", () => ({
  requireAuth: (
    req: { headers?: Record<string, string | string[] | undefined> },
    res: {
      status: (code: number) => {
        json: (body: { error: string }) => void;
      };
    },
    next: () => void,
  ): void => {
    if (req.headers?.["x-test-auth"] === "authenticated") {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  },
}));

import app from "../../artifacts/api-server/src/app";

// ── test-unique suffix ──────────────────────────────────────────────────────
const suffix = `${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

// DB fixture IDs
let vehicleId: number;
let driverId: number;
let saleId: number;
let dispatchIds: number[] = [];

// ── helpers ─────────────────────────────────────────────────────────────────
function auth(headers?: Record<string, string>): Record<string, string> {
  return { "x-test-auth": "authenticated", "Content-Type": "application/json", ...headers };
}

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function createDispatch(estado: string = "aprobado"): Promise<number> {
  const [d] = await db
    .insert(dispatchesTable)
    .values({
      tipo: "venta",
      ventaId: saleId,
      vehiculoId: vehicleId,
      choferId: driverId,
      fechaEstimadaSalida: "2035-06-01T08:00:00.000Z",
      fechaEstimadaLlegada: "2035-06-01T18:00:00.000Z",
      estado,
    })
    .returning({ id: dispatchesTable.id });
  dispatchIds.push(d.id);
  return d.id;
}

// ── lifecycle ────────────────────────────────────────────────────────────────
beforeAll(async () => {
  await runMigrations();
  await pool.query(dispatchesMigrationSql);
  await pool.query(actasMigrationSql);

  [vehicleId] = (
    await db
      .insert(vehiclesTable)
      .values({
        tipo: "camion",
        modelo: `Vehículo acta ${suffix}`,
        capacidadPeso: 1_000,
        capacidadVolumen: 10,
        tipoCombustible: "diesel",
        rendimientoKmLitro: 8,
      })
      .returning({ id: vehiclesTable.id })
  ).map((r) => r.id);

  [driverId] = (
    await db
      .insert(personnelTable)
      .values({
        nombre: `Chofer acta ${suffix}`,
        rol: "chofer",
        tarifaPorKm: 0,
        email: `driver-acta-${suffix}@test.invalid`,
      })
      .returning({ id: personnelTable.id })
  ).map((r) => r.id);

  [saleId] = (
    await db
      .insert(salesTable)
      .values({
        cliente: `Cliente acta ${suffix}`,
        destino: "Destino acta QA",
        almacenOrigen: "Origen acta QA",
        odooRef: `SALE-ACTA-${suffix}`,
        pesoTotal: 100,
        volumenTotal: 1,
      })
      .returning({ id: salesTable.id })
  ).map((r) => r.id);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine test API port");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  // Clean up actas and dispatches created during each test
  if (dispatchIds.length > 0) {
    await db
      .delete(actasLlegadaTable)
      .where(inArray(actasLlegadaTable.despachoId, dispatchIds));
    await db
      .delete(dispatchesTable)
      .where(inArray(dispatchesTable.id, dispatchIds));
    dispatchIds = [];
  }
  // Reset mock
  currentPersonMock.result = null;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await db.delete(personnelTable).where(eq(personnelTable.id, driverId));
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  await db.delete(salesTable).where(eq(salesTable.id, saleId));
});

// ── Case 1: PATCH without prior acta → 409 acta_no_registrada ───────────────
describe("PATCH /api/dispatches/:id/acta without prior acta", () => {
  it("returns 409 acta_no_registrada", async () => {
    const id = await createDispatch();
    const res = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ recibidoPor: "Almacenista" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "acta_no_registrada" });
  });
});

// ── Case 2: Web user (no linked person) POST valid acta → 200 with nulls ────
describe("POST acta by unlinked authenticated web user", () => {
  it("returns 200 with registradaPorId null and novedadesViaje null", async () => {
    currentPersonMock.result = { ok: false, reason: "not_linked", email: "web@example.com" };
    const id = await createDispatch("en-ruta");
    const res = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ fechaLlegada: isoMinutesFromNow(-5), novedadesViaje: "" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registradaPorId).toBeNull();
    expect(body.novedadesViaje).toBeNull();
    expect(body.despachoId).toBe(id);

    // PATCH reception then returns confirmadaPorId null and a timestamp
    currentPersonMock.result = { ok: false, reason: "not_linked", email: "web@example.com" };
    const patchRes = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ recibidoPor: "Almacenista QA" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.confirmadaPorId).toBeNull();
    expect(typeof patchBody.confirmadaAt).toBe("string");
    expect(patchBody.confirmadaAt).not.toBeNull();
  });
});

// ── Case 3: Arrival integrity guards ─────────────────────────────────────────
describe("Arrival integrity guards", () => {
  it("rejects a web arrival over ten minutes in the future", async () => {
    const id = await createDispatch("en-ruta");
    const res = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ fechaLlegada: isoMinutesFromNow(60) }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "fecha_llegada_futura" });
    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(0);
  });

  it("allows a small two-minute clock skew", async () => {
    currentPersonMock.result = {
      ok: false,
      reason: "not_linked",
      email: "web@example.com",
    };
    const id = await createDispatch("en-ruta");
    const res = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ fechaLlegada: isoMinutesFromNow(2) }),
    });

    expect(res.status).toBe(200);
    const acta = await res.json();
    expect(acta.despachoId).toBe(id);
  });

  it("rejects an acta for a dispatch that has not left", async () => {
    const id = await createDispatch("pre-despacho");
    const res = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ fechaLlegada: isoMinutesFromNow(-5) }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "despacho_sin_salir" });
    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(0);
  });

  it("keeps the original confirmation signature when reception text is corrected", async () => {
    currentPersonMock.result = {
      ok: false,
      reason: "not_linked",
      email: "web@example.com",
    };
    const id = await createDispatch("entregado");
    const createRes = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ fechaLlegada: isoMinutesFromNow(-10) }),
    });
    expect(createRes.status).toBe(200);

    currentPersonMock.result = {
      ok: true,
      person: {
        id: driverId,
        nombre: `Chofer acta ${suffix}`,
        rol: "chofer",
        tarifaPorKm: 0,
        telefono: null,
        email: `driver-acta-${suffix}@test.invalid`,
        createdAt: new Date(),
      },
    };
    const firstRes = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({
        recibidoPor: "Primera persona",
        novedadesRecepcion: "Primera observación",
      }),
    });
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json();

    currentPersonMock.result = {
      ok: false,
      reason: "not_linked",
      email: "correction@example.com",
    };
    const correctionRes = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({
        recibidoPor: "Nombre corregido",
        novedadesRecepcion: "Texto corregido",
      }),
    });
    expect(correctionRes.status).toBe(200);
    const corrected = await correctionRes.json();

    expect(corrected.recibidoPor).toBe("Nombre corregido");
    expect(corrected.novedadesRecepcion).toBe("Texto corregido");
    expect(corrected.confirmadaAt).toBe(first.confirmadaAt);
    expect(corrected.confirmadaPorId).toBe(driverId);
  });
});

// ── Case 4: POST acta input validation (400, no acta created) ────────────────
describe("POST acta input validation", () => {
  const invalidCases: Array<{ label: string; body: Record<string, unknown> }> = [
    {
      label: "fechaLlegada null",
      body: { fechaLlegada: null, novedadesViaje: null },
    },
    {
      label: "fechaLlegada numeric",
      body: { fechaLlegada: 1234567890, novedadesViaje: null },
    },
    {
      label: "fechaLlegada invalid calendar date (Feb 30)",
      body: { fechaLlegada: "2035-02-30T10:00:00.000Z" },
    },
    {
      label: "fechaLlegada date-only (no time)",
      body: { fechaLlegada: "2035-06-01" },
    },
    {
      label: "extra property",
      body: { fechaLlegada: "2035-06-01T18:00:00.000Z", campoExtra: "forbidden" },
    },
  ];

  for (const { label, body } of invalidCases) {
    it(`rejects ${label} with 400 and creates no acta`, async () => {
      currentPersonMock.result = { ok: false, reason: "not_linked", email: "web@example.com" };
      const id = await createDispatch();
      const res = await fetch(`${baseUrl}/api/dispatches/${id}/acta`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);

      // Confirm no acta was created
      const actas = await db
        .select()
        .from(actasLlegadaTable)
        .where(eq(actasLlegadaTable.despachoId, id));
      expect(actas).toHaveLength(0);
    });
  }
});

// ── Case 5: Driver identity responses ────────────────────────────────────────
describe("Driver identity responses (no_email, not_linked)", () => {
  it("no_email: returns 404 with exact message", async () => {
    currentPersonMock.result = { ok: false, reason: "no_email" };
    const res = await fetch(`${baseUrl}/api/driver/me`, {
      headers: { "x-test-auth": "authenticated" },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe("Tu cuenta no tiene un email asociado.");
  });

  it("not_linked: returns 404 with exact message including email", async () => {
    const email = `nada-${suffix}@test.invalid`;
    currentPersonMock.result = { ok: false, reason: "not_linked", email };
    const res = await fetch(`${baseUrl}/api/driver/me`, {
      headers: { "x-test-auth": "authenticated" },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe(
      `No hay un chofer registrado con el email ${email}. Pide al administrador que agregue tu email en Personal.`,
    );
  });
});

// ── Case 6: Linked driver status transitions with acta fields ────────────────
describe("Linked driver dispatch status transitions", () => {
  function setLinkedDriver() {
    currentPersonMock.result = {
      ok: true,
      person: {
        id: driverId,
        nombre: `Chofer acta ${suffix}`,
        rol: "chofer",
        tarifaPorKm: 0,
        telefono: null,
        email: `driver-acta-${suffix}@test.invalid`,
        createdAt: new Date(),
      },
    };
  }

  it("en-ruta with acta fields returns 400 acta_fuera_de_contexto and does not alter state", async () => {
    setLinkedDriver();
    const id = await createDispatch("aprobado");
    const res = await fetch(`${baseUrl}/api/driver/dispatches/${id}/status`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        estado: "en-ruta",
        fechaLlegada: "2035-06-01T18:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("acta_fuera_de_contexto");

    // State must not have changed
    const [dispatch] = await db
      .select({ estado: dispatchesTable.estado })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, id));
    expect(dispatch.estado).toBe("aprobado");

    // No acta must have been created
    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(0);
  });

  it("failed delivered transition (from wrong state) does not create acta", async () => {
    setLinkedDriver();
    // Dispatch in pre-despacho cannot transition to entregado
    const id = await createDispatch("pre-despacho");
    const res = await fetch(`${baseUrl}/api/driver/dispatches/${id}/status`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        estado: "entregado",
        fechaLlegada: isoMinutesFromNow(-5),
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_transition");

    // No acta must have been created
    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(0);
  });

  it("delivered with valid ISO date creates acta attributed to linked person", async () => {
    setLinkedDriver();
    const id = await createDispatch("en-ruta");
    const fechaLlegada = isoMinutesFromNow(-60);
    const res = await fetch(`${baseUrl}/api/driver/dispatches/${id}/status`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ estado: "entregado", fechaLlegada }),
    });
    expect(res.status).toBe(200);

    const [dispatch] = await db
      .select({ estado: dispatchesTable.estado })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, id));
    expect(dispatch.estado).toBe("entregado");

    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(1);
    expect(actas[0].registradaPorId).toBe(driverId);
    expect(actas[0].fechaLlegada.toISOString()).toBe(new Date(fechaLlegada).toISOString());
  });

  it("rejects a future arrival before changing the dispatch state", async () => {
    setLinkedDriver();
    const id = await createDispatch("en-ruta");
    const res = await fetch(`${baseUrl}/api/driver/dispatches/${id}/status`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        estado: "entregado",
        fechaLlegada: isoMinutesFromNow(60),
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "fecha_llegada_futura" });
    const [dispatch] = await db
      .select({ estado: dispatchesTable.estado })
      .from(dispatchesTable)
      .where(eq(dispatchesTable.id, id));
    expect(dispatch.estado).toBe("en-ruta");
    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(0);
  });

  it("delivered without acta fields creates no acta", async () => {
    setLinkedDriver();
    const id = await createDispatch("en-ruta");
    const res = await fetch(`${baseUrl}/api/driver/dispatches/${id}/status`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ estado: "entregado" }),
    });
    expect(res.status).toBe(200);

    const actas = await db
      .select()
      .from(actasLlegadaTable)
      .where(eq(actasLlegadaTable.despachoId, id));
    expect(actas).toHaveLength(0);
  });

  const invalidActaCases: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: "null date", body: { estado: "entregado", fechaLlegada: null } },
    { label: "numeric date", body: { estado: "entregado", fechaLlegada: 1234567890 } },
    { label: "invalid calendar date (Feb 30)", body: { estado: "entregado", fechaLlegada: "2035-02-30T10:00:00.000Z" } },
    { label: "extra property", body: { estado: "entregado", fechaLlegada: "2035-06-01T18:00:00.000Z", campoExtra: "bad" } },
  ];

  for (const { label, body } of invalidActaCases) {
    it(`delivered with ${label} returns 400 without changing state`, async () => {
      setLinkedDriver();
      const id = await createDispatch("en-ruta");
      const res = await fetch(`${baseUrl}/api/driver/dispatches/${id}/status`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);

      const [dispatch] = await db
        .select({ estado: dispatchesTable.estado })
        .from(dispatchesTable)
        .where(eq(dispatchesTable.id, id));
      expect(dispatch.estado).toBe("en-ruta");

      const actas = await db
        .select()
        .from(actasLlegadaTable)
        .where(eq(actasLlegadaTable.despachoId, id));
      expect(actas).toHaveLength(0);
    });
  }
});
