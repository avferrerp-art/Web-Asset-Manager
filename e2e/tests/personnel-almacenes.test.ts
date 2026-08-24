import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  almacenesTable,
  db,
  personnelAlmacenesTable,
  personnelTable,
  pool,
  runMigrations,
} from "@workspace/db";
import { sql as personnelAlmacenesMigrationSql } from "../../lib/db/src/migrations/0012_personnel_almacenes";

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
import {
  listarAlmacenesAgrupadosPorPersonal,
  listarAlmacenesDePersonal,
  reemplazarAlmacenesDePersonal,
} from "../../artifacts/api-server/src/services/personnelAlmacenes";

const suffix = `${process.pid}-${Date.now()}`;
const testEmailPrefix = `personnel-almacenes-${suffix}`;
const missingAlmacenId = 2_000_000_000;
const personnelIds: number[] = [];
let almacenIds: number[] = [];
let tempAlmacenId = 0;
let almacenistaId = 0;
let oficinaId = 0;
let choferId = 0;
let ayudanteId = 0;
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

async function createPerson(nombre: string, rol: string): Promise<number> {
  const [person] = await db
    .insert(personnelTable)
    .values({
      nombre,
      rol,
      tarifaViaticos: 0,
      email: `${testEmailPrefix}-${rol}-${personnelIds.length}@example.test`,
    })
    .returning({ id: personnelTable.id });
  personnelIds.push(person.id);
  return person.id;
}

function authenticatedFetch(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-auth": "authenticated",
      ...init?.headers,
    },
  });
}

beforeAll(async () => {
  await runMigrations();
  await pool.query(personnelAlmacenesMigrationSql);
  await pool.query(personnelAlmacenesMigrationSql);

  almacenIds = (
    await db
      .select({ id: almacenesTable.id })
      .from(almacenesTable)
      .where(eq(almacenesTable.activo, true))
      .orderBy(almacenesTable.id)
      .limit(2)
  ).map(({ id }) => id);
  if (almacenIds.length < 2) {
    throw new Error("Personnel warehouse tests require two active warehouses");
  }

  const [tempAlmacen] = await db
    .insert(almacenesTable)
    .values({
      codigo: `PA-${suffix}`,
      odooPrefix: `PA-${suffix}`,
      nombre: `Almacén temporal ${suffix}`,
      plaza: "Prueba",
      activo: false,
    })
    .returning({ id: almacenesTable.id });
  tempAlmacenId = tempAlmacen.id;

  almacenistaId = await createPerson(`Almacenista ${suffix}`, "almacenista");
  oficinaId = await createPerson(`Oficina ${suffix}`, "oficina");
  choferId = await createPerson(`Chofer ${suffix}`, "chofer");
  ayudanteId = await createPerson(`Ayudante ${suffix}`, "ayudante");

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
  if (personnelIds.length > 0) {
    await db
      .delete(personnelTable)
      .where(inArray(personnelTable.id, personnelIds));
  }
  if (tempAlmacenId) {
    await db
      .delete(almacenesTable)
      .where(eq(almacenesTable.id, tempAlmacenId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe.sequential("Asignaciones de almacenes al personal", () => {
  it("keeps the migration repeatable with a composite key and cascading references", async () => {
    // Simulate a manually/partially created table whose named constraints have
    // the wrong shape. The migration must repair, not merely skip, them.
    await pool.query(`
      ALTER TABLE "personnel_almacenes"
        DROP CONSTRAINT "personnel_almacenes_pkey",
        ADD CONSTRAINT "personnel_almacenes_pkey"
          PRIMARY KEY ("personnel_id"),
        DROP CONSTRAINT "personnel_almacenes_personnel_id_personnel_id_fk",
        ADD CONSTRAINT "personnel_almacenes_personnel_id_personnel_id_fk"
          FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id"),
        DROP CONSTRAINT "personnel_almacenes_almacen_id_almacenes_id_fk",
        ADD CONSTRAINT "personnel_almacenes_almacen_id_almacenes_id_fk"
          FOREIGN KEY ("almacen_id") REFERENCES "almacenes"("id");
    `);
    await pool.query(personnelAlmacenesMigrationSql);
    await pool.query(personnelAlmacenesMigrationSql);

    const constraints = await pool.query<{
      conname: string;
      contype: string;
      confdeltype: string;
      definition: string;
    }>(`
      SELECT
        conname,
        contype,
        confdeltype,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'personnel_almacenes'::regclass
      ORDER BY conname
    `);

    expect(constraints.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conname: "personnel_almacenes_pkey",
          contype: "p",
          definition: "PRIMARY KEY (personnel_id, almacen_id)",
        }),
        expect.objectContaining({
          conname: "personnel_almacenes_personnel_id_personnel_id_fk",
          contype: "f",
          confdeltype: "c",
        }),
        expect.objectContaining({
          conname: "personnel_almacenes_almacen_id_almacenes_id_fk",
          contype: "f",
          confdeltype: "c",
        }),
      ]),
    );
  });

  it("replaces assignments atomically, accepts empty lists, and hydrates people in one grouped read", async () => {
    await reemplazarAlmacenesDePersonal(almacenistaId, [
      almacenIds[0],
      almacenIds[1],
      almacenIds[0],
    ]);
    expect(await listarAlmacenesDePersonal(almacenistaId)).toHaveLength(2);

    const grouped = await listarAlmacenesAgrupadosPorPersonal([
      almacenistaId,
      oficinaId,
    ]);
    expect(grouped.get(almacenistaId)?.map(({ id }) => id).sort()).toEqual(
      [...almacenIds].sort(),
    );
    expect(grouped.get(oficinaId)).toEqual([]);

    await reemplazarAlmacenesDePersonal(almacenistaId, [almacenIds[0]]);
    await expect(
      reemplazarAlmacenesDePersonal(almacenistaId, [
        almacenIds[1],
        missingAlmacenId,
      ]),
    ).rejects.toThrow();
    expect(await listarAlmacenesDePersonal(almacenistaId)).toEqual([
      expect.objectContaining({ id: almacenIds[0] }),
    ]);

    await reemplazarAlmacenesDePersonal(almacenistaId, []);
    expect(await listarAlmacenesDePersonal(almacenistaId)).toEqual([]);
  });

  it("removes assignments when either side of the relationship is deleted", async () => {
    const disposablePersonId = await createPerson(
      `Temporal persona ${suffix}`,
      "oficina",
    );
    await reemplazarAlmacenesDePersonal(disposablePersonId, [almacenIds[0]]);
    await db
      .delete(personnelTable)
      .where(eq(personnelTable.id, disposablePersonId));
    expect(
      await db
        .select()
        .from(personnelAlmacenesTable)
        .where(eq(personnelAlmacenesTable.personnelId, disposablePersonId)),
    ).toEqual([]);

    await reemplazarAlmacenesDePersonal(almacenistaId, [tempAlmacenId]);
    await db
      .delete(almacenesTable)
      .where(eq(almacenesTable.id, tempAlmacenId));
    tempAlmacenId = 0;
    expect(await listarAlmacenesDePersonal(almacenistaId)).toEqual([]);
  });

  it("protects the endpoints and returns hydrated assignments from list, detail, and PUT", async () => {
    const unauthorized = await fetch(
      `${baseUrl}/api/personnel/reporte-almacenes`,
    );
    expect(unauthorized.status).toBe(401);

    const replacement = await authenticatedFetch(
      `/api/personnel/${almacenistaId}/almacenes`,
      {
        method: "PUT",
        body: JSON.stringify({ almacenIds }),
      },
    );
    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({
      id: almacenistaId,
      almacenes: expect.arrayContaining(
        almacenIds.map((id) => expect.objectContaining({ id })),
      ),
    });

    const list = await authenticatedFetch("/api/personnel");
    const listedPersonnel = (await list.json()) as Array<{
      id: number;
      almacenes: Array<{ id: number }>;
    }>;
    expect(
      listedPersonnel.find(({ id }) => id === almacenistaId)?.almacenes,
    ).toHaveLength(2);

    const detail = await authenticatedFetch(
      `/api/personnel/${almacenistaId}`,
    );
    expect(await detail.json()).toMatchObject({
      id: almacenistaId,
      almacenes: expect.arrayContaining(
        almacenIds.map((id) => expect.objectContaining({ id })),
      ),
    });
  });

  it("rejects duplicate or missing warehouse IDs without changing the previous set, and accepts an empty set", async () => {
    const duplicate = await authenticatedFetch(
      `/api/personnel/${almacenistaId}/almacenes`,
      {
        method: "PUT",
        body: JSON.stringify({ almacenIds: [almacenIds[0], almacenIds[0]] }),
      },
    );
    expect(duplicate.status).toBe(400);

    const missing = await authenticatedFetch(
      `/api/personnel/${almacenistaId}/almacenes`,
      {
        method: "PUT",
        body: JSON.stringify({ almacenIds: [missingAlmacenId] }),
      },
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: "Almacenes no encontrados.",
      missingAlmacenIds: [missingAlmacenId],
    });
    expect(await listarAlmacenesDePersonal(almacenistaId)).toHaveLength(2);

    const empty = await authenticatedFetch(
      `/api/personnel/${almacenistaId}/almacenes`,
      {
        method: "PUT",
        body: JSON.stringify({ almacenIds: [] }),
      },
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ almacenes: [] });
  });

  it("reports non-operational personnel with unassigned almacenistas first", async () => {
    await reemplazarAlmacenesDePersonal(oficinaId, [almacenIds[0]]);
    const response = await authenticatedFetch(
      "/api/personnel/reporte-almacenes",
    );
    expect(response.status).toBe(200);
    const report = (await response.json()) as Array<{
      id: number;
      rol: string;
      sinAsignar: boolean;
      almacenes: Array<{ id: number }>;
    }>;

    const almacenistaIndex = report.findIndex(({ id }) => id === almacenistaId);
    const oficinaIndex = report.findIndex(({ id }) => id === oficinaId);
    expect(almacenistaIndex).toBeGreaterThanOrEqual(0);
    expect(oficinaIndex).toBeGreaterThan(almacenistaIndex);
    expect(report[almacenistaIndex]).toMatchObject({
      rol: "almacenista",
      sinAsignar: true,
      almacenes: [],
    });
    expect(report[oficinaIndex]).toMatchObject({
      rol: "oficina",
      sinAsignar: false,
      almacenes: [expect.objectContaining({ id: almacenIds[0] })],
    });
    expect(report.some(({ id }) => id === choferId)).toBe(false);
    expect(report.some(({ id }) => id === ayudanteId)).toBe(false);
  });
});