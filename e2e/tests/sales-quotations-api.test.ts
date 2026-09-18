import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db, runMigrations, salesTable } from "@workspace/db";

vi.mock("../../artifacts/api-server/src/middlewares/requireAuth", () => ({
  requireAuth: (
    req: { headers?: Record<string, string | string[] | undefined> },
    res: { status: (code: number) => { json: (body: unknown) => void } },
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

const suffix = `${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;
const fixtureRefs = ["draft", "sent", "sale", "done", "legacy", "unknown"].map(
  (kind) => `QUOTE-LIST-${kind}-${suffix}`,
);
let fixtureIds: number[] = [];
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

async function list(
  query = "",
): Promise<Array<{ id: number; odooEstado: string | null; estado: string }>> {
  const response = await fetch(`${baseUrl}/api/sales${query}`, {
    headers: { "x-test-auth": "authenticated" },
  });
  expect(response.status).toBe(200);
  const rows = (await response.json()) as Array<{
    id: number;
    odooEstado: string | null;
    estado: string;
  }>;
  return rows.filter((row) => fixtureIds.includes(row.id));
}

function sortedIds(rows: Array<{ id: number }>): number[] {
  return rows.map((row) => row.id).sort((a, b) => a - b);
}

beforeAll(async () => {
  await runMigrations();
  fixtureIds = (
    await db
      .insert(salesTable)
      .values([
        {
          cliente: `Draft ${suffix}`,
          destino: "QA",
          estado: "pendiente",
          odooEstado: "draft",
          odooRef: fixtureRefs[0],
        },
        {
          cliente: `Sent ${suffix}`,
          destino: "QA",
          estado: "entregado",
          odooEstado: "sent",
          odooRef: fixtureRefs[1],
        },
        {
          cliente: `Sale ${suffix}`,
          destino: "QA",
          estado: "pendiente",
          odooEstado: "sale",
          odooRef: fixtureRefs[2],
        },
        {
          cliente: `Done ${suffix}`,
          destino: "QA",
          estado: "entregado",
          odooEstado: "done",
          odooRef: fixtureRefs[3],
        },
        {
          cliente: `Legacy ${suffix}`,
          destino: "QA",
          estado: "pendiente",
          odooEstado: null,
          odooRef: fixtureRefs[4],
        },
        {
          cliente: `Unknown ${suffix}`,
          destino: "QA",
          estado: "pendiente",
          odooEstado: "cancel",
          odooRef: fixtureRefs[5],
        },
      ])
      .returning({ id: salesTable.id })
  ).map((row) => row.id);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server has no port");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (fixtureIds.length > 0) {
    await db.delete(salesTable).where(inArray(salesTable.id, fixtureIds));
  }
});

describe("GET /sales quotation visibility", () => {
  it("defaults to the sale/done allowlist while retaining legacy NULL rows", async () => {
    const expected = [fixtureIds[2]!, fixtureIds[3]!, fixtureIds[4]!].sort((a, b) => a - b);
    expect(sortedIds(await list())).toEqual(expected);
    expect(sortedIds(await list("?includeQuotations=false"))).toEqual(expected);
  });

  it("explicitly includes draft and sent, but never unknown commercial states", async () => {
    const expected = fixtureIds.slice(0, 5).sort((a, b) => a - b);
    const rows = await list("?includeQuotations=true");
    expect(sortedIds(rows)).toEqual(expected);
    expect(rows.some((row) => row.odooEstado === "cancel")).toBe(false);
  });

  it("combines status with the commercial-state allowlist in both modes", async () => {
    expect(sortedIds(await list("?status=pendiente"))).toEqual(
      [fixtureIds[2]!, fixtureIds[4]!].sort((a, b) => a - b),
    );
    expect(sortedIds(await list("?status=entregado"))).toEqual([fixtureIds[3]!]);
    expect(sortedIds(await list("?status=pendiente&includeQuotations=true"))).toEqual(
      [fixtureIds[0]!, fixtureIds[2]!, fixtureIds[4]!].sort((a, b) => a - b),
    );
    expect(sortedIds(await list("?status=entregado&includeQuotations=true"))).toEqual(
      [fixtureIds[1]!, fixtureIds[3]!].sort((a, b) => a - b),
    );
  });
});