import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  almacenesTable,
  db,
  pool,
  runMigrations,
} from "@workspace/db";
import { sql as almacenesMigrationSql } from "../../lib/db/src/migrations/0006_almacenes";

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
import { resolveAlmacenPorLocation } from "../../artifacts/api-server/src/services/almacenes";

const TEST_CODE = "TEST-INACTIVO";
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  await runMigrations();

  // Exercise the migration body itself twice, not only the migration tracker:
  // DDL and seed must remain safe and must not duplicate canonical rows.
  await pool.query(almacenesMigrationSql);
  await pool.query(almacenesMigrationSql);

  await db.delete(almacenesTable).where(eq(almacenesTable.codigo, TEST_CODE));
  await db.insert(almacenesTable).values({
    codigo: TEST_CODE,
    odooPrefix: TEST_CODE,
    nombre: "Almacén inactivo de prueba",
    plaza: "Caracas",
    activo: false,
  });

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

afterAll(async () => {
  await db.delete(almacenesTable).where(eq(almacenesTable.codigo, TEST_CODE));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Catálogo de almacenes", () => {
  it("keeps exactly the four canonical active rows after repeated seeds", async () => {
    const active = await db
      .select({
        codigo: almacenesTable.codigo,
        odooPrefix: almacenesTable.odooPrefix,
        nombre: almacenesTable.nombre,
      })
      .from(almacenesTable)
      .where(eq(almacenesTable.activo, true));

    expect(active).toHaveLength(4);
    expect(active).toEqual(
      expect.arrayContaining([
        { codigo: "URB", odooPrefix: "Urbin", nombre: "Urbina" },
        { codigo: "CCS", odooPrefix: "CCS", nombre: "Caracas" },
        { codigo: "LEC", odooPrefix: "LEC", nombre: "Lecheria" },
        { codigo: "NVBLA", odooPrefix: "NVBLA", nombre: "Nueva Barcelona" },
      ]),
    );
  });

  it("resolves the exact Odoo prefix and never creates unknown warehouses", async () => {
    const before = await db.select({ id: almacenesTable.id }).from(almacenesTable);

    const urbina = await resolveAlmacenPorLocation("Urbin/Existencias");
    const unknown = await resolveAlmacenPorLocation("DESCONOCIDO/Existencias");

    const after = await db.select({ id: almacenesTable.id }).from(almacenesTable);
    expect(urbina).toMatchObject({
      codigo: "URB",
      odooPrefix: "Urbin",
      nombre: "Urbina",
    });
    expect(unknown).toBeNull();
    expect(after).toHaveLength(before.length);
  });

  it("protects GET /api/almacenes and returns only active rows", async () => {
    const unauthorized = await fetch(`${baseUrl}/api/almacenes`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/api/almacenes`, {
      headers: { "x-test-auth": "authenticated" },
    });
    expect(authorized.status).toBe(200);

    const rows = (await authorized.json()) as Array<{
      codigo: string;
      activo: boolean;
    }>;
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.activo)).toBe(true);
    expect(rows.some((row) => row.codigo === TEST_CODE)).toBe(false);
  });
});