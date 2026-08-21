import { eq, sql } from "drizzle-orm";
import { db, productsTable, odooSyncStateTable } from "@workspace/db";
import {
  authenticate,
  executeKw,
  getOdooConfig,
  OdooError,
  type OdooConfig,
} from "../lib/odooClient";
import { logger } from "../lib/logger";

export interface ProductSyncResult {
  created: number;
  updated: number;
  total: number;
}

interface OdooProductRecord {
  id: number;
  default_code: string | false;
  name: string;
  categ_id: [number, string] | false;
  uom_id: [number, string] | false;
  weight: number;
  volume: number;
  active: boolean;
  type: string;
}

const FETCH_BATCH_SIZE = 200;

function positiveOdooValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function fetchOdooProducts(
  config: OdooConfig,
  uid: number,
): Promise<OdooProductRecord[]> {
  const all: OdooProductRecord[] = [];
  let lastId = 0;
  for (;;) {
    const batch = (await executeKw(
      config,
      uid,
      "product.product",
      "search_read",
      [[["type", "in", ["product", "consu"]], ["id", ">", lastId]]],
      {
        fields: [
          "default_code",
          "name",
          "categ_id",
          "uom_id",
          "weight",
          "volume",
          "active",
          "type",
        ],
        limit: FETCH_BATCH_SIZE,
        order: "id asc",
      },
    )) as OdooProductRecord[];
    all.push(...batch);
    if (batch.length < FETCH_BATCH_SIZE) break;
    lastId = batch[batch.length - 1]!.id;
  }
  return all;
}

export async function syncOdooProducts(): Promise<ProductSyncResult> {
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexión Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY.",
    );
  }

  const uid = await authenticate(config);
  const products = await fetchOdooProducts(config, uid);

  let created = 0;
  let updated = 0;
  const now = new Date();

  for (const p of products) {
    // UPSERT by odooId. On conflict, update ONLY the Odoo-owned fields.
    // Manual fields (pesoKg, largoCm, anchoCm, altoCm, apilable, fragil,
    // notas, dimensionesConfirmadas) are NEVER touched by the sync.
    const result = await db
      .insert(productsTable)
      .values({
        odooId: p.id,
        odooRef: p.default_code ? String(p.default_code) : null,
        nombre: p.name,
        categoria: p.categ_id ? p.categ_id[1] : null,
        uom: p.uom_id ? p.uom_id[1] : null,
        pesoOdoo: positiveOdooValue(p.weight),
        volumenOdoo: positiveOdooValue(p.volume),
        activo: p.active !== false,
        lastSyncAt: now,
        dimensionesConfirmadas: false,
      })
      .onConflictDoUpdate({
        target: productsTable.odooId,
        set: {
          odooRef: p.default_code ? String(p.default_code) : null,
          nombre: p.name,
          categoria: p.categ_id ? p.categ_id[1] : null,
          uom: p.uom_id ? p.uom_id[1] : null,
          pesoOdoo: positiveOdooValue(p.weight),
          volumenOdoo: positiveOdooValue(p.volume),
          activo: p.active !== false,
          lastSyncAt: now,
          updatedAt: now,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (result[0]?.inserted) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  const syncResult: ProductSyncResult = {
    created,
    updated,
    total: products.length,
  };
  await recordProductSyncResult(syncResult);
  logger.info({ syncResult }, "Odoo product sync completed");
  return syncResult;
}

async function getOrCreateStateRow() {
  const [row] = await db.select().from(odooSyncStateTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(odooSyncStateTable).values({}).returning();
  return created!;
}

async function recordProductSyncResult(result: ProductSyncResult): Promise<void> {
  const row = await getOrCreateStateRow();
  await db
    .update(odooSyncStateTable)
    .set({
      lastProductsSyncAt: new Date(),
      lastProductsResult: "ok",
      lastProductsError: null,
      productsCreatedCount: result.created,
      productsUpdatedCount: result.updated,
    })
    .where(eq(odooSyncStateTable.id, row.id));
}

export async function recordProductSyncError(message: string): Promise<void> {
  const row = await getOrCreateStateRow();
  await db
    .update(odooSyncStateTable)
    .set({
      lastProductsSyncAt: new Date(),
      lastProductsResult: "error",
      lastProductsError: message,
    })
    .where(eq(odooSyncStateTable.id, row.id));
}

export async function getProductStats(): Promise<{
  total: number;
  conPesoOdoo: number;
  sinPesoOdoo: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      conPesoOdoo: sql<number>`count(${productsTable.pesoOdoo})::int`,
    })
    .from(productsTable);
  const total = row?.total ?? 0;
  const conPesoOdoo = row?.conPesoOdoo ?? 0;
  return { total, conPesoOdoo, sinPesoOdoo: total - conPesoOdoo };
}
