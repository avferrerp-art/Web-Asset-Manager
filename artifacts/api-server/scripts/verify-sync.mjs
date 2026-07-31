// scripts/verify-products-sync.ts
import { db as db2, productsTable as productsTable2 } from "@workspace/db";
import { eq as eq2 } from "drizzle-orm";

// src/services/productSync.ts
import { eq, sql } from "drizzle-orm";
import { db, productsTable, odooSyncStateTable } from "@workspace/db";

// src/lib/odooClient.ts
var OdooError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OdooError";
  }
};
function getOdooConfig() {
  const url = process.env.ODOO_URL;
  const db3 = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const apiKey = process.env.ODOO_API_KEY;
  if (!url || !db3 || !username || !apiKey) return null;
  return { url: url.replace(/\/+$/, ""), db: db3, username, apiKey };
}
async function jsonRpc(config, service, method, args) {
  let response;
  try {
    response = await fetch(`${config.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: Date.now()
      }),
      signal: AbortSignal.timeout(2e4)
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new OdooError(
      `No se pudo conectar al servidor Odoo (${config.url}): ${cause}`
    );
  }
  if (!response.ok) {
    throw new OdooError(
      `El servidor Odoo respondi\xF3 HTTP ${response.status} en ${config.url}/jsonrpc`
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new OdooError(
      `El servidor Odoo devolvi\xF3 una respuesta no v\xE1lida (\xBFla URL apunta a un servidor Odoo?)`
    );
  }
  if (payload.error) {
    const detail = payload.error.data?.message ?? payload.error.message ?? "Error desconocido";
    throw new OdooError(`Error de Odoo: ${detail}`);
  }
  return payload.result;
}
async function authenticate(config) {
  const result = await jsonRpc(config, "common", "authenticate", [
    config.db,
    config.username,
    config.apiKey,
    {}
  ]);
  if (typeof result !== "number" || !result) {
    throw new OdooError(
      "Credenciales inv\xE1lidas: Odoo rechaz\xF3 el usuario o la API key (verifique tambi\xE9n el nombre de la base de datos)."
    );
  }
  return result;
}
async function executeKw(config, uid, model, method, args, kwargs = {}) {
  return jsonRpc(config, "object", "execute_kw", [
    config.db,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs
  ]);
}

// src/lib/logger.ts
import pino from "pino";
var isProduction = process.env.NODE_ENV === "production";
var logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']"
  ],
  ...isProduction ? {} : {
    transport: {
      target: "pino-pretty",
      options: { colorize: true }
    }
  }
});

// src/services/productSync.ts
var FETCH_BATCH_SIZE = 200;
async function fetchOdooProducts(config, uid) {
  const all = [];
  let lastId = 0;
  for (; ; ) {
    const batch = await executeKw(
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
          "type"
        ],
        limit: FETCH_BATCH_SIZE,
        order: "id asc"
      }
    );
    all.push(...batch);
    if (batch.length < FETCH_BATCH_SIZE) break;
    lastId = batch[batch.length - 1].id;
  }
  return all;
}
async function syncOdooProducts() {
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexi\xF3n Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY."
    );
  }
  const uid = await authenticate(config);
  const products = await fetchOdooProducts(config, uid);
  let created = 0;
  let updated = 0;
  const now = /* @__PURE__ */ new Date();
  for (const p of products) {
    const result = await db.insert(productsTable).values({
      odooId: p.id,
      odooRef: p.default_code ? String(p.default_code) : null,
      nombre: p.name,
      categoria: p.categ_id ? p.categ_id[1] : null,
      uom: p.uom_id ? p.uom_id[1] : null,
      pesoOdoo: p.weight ?? 0,
      volumenOdoo: p.volume ?? 0,
      activo: p.active !== false,
      lastSyncAt: now,
      dimensionesConfirmadas: false
    }).onConflictDoUpdate({
      target: productsTable.odooId,
      set: {
        odooRef: p.default_code ? String(p.default_code) : null,
        nombre: p.name,
        categoria: p.categ_id ? p.categ_id[1] : null,
        uom: p.uom_id ? p.uom_id[1] : null,
        pesoOdoo: p.weight ?? 0,
        volumenOdoo: p.volume ?? 0,
        activo: p.active !== false,
        lastSyncAt: now,
        updatedAt: now
      }
    }).returning({ createdAt: productsTable.createdAt });
    const row = result[0];
    if (row && row.createdAt.getTime() >= now.getTime() - 1e3) {
      created += 1;
    } else {
      updated += 1;
    }
  }
  const syncResult = {
    created,
    updated,
    total: products.length
  };
  await recordProductSyncResult(syncResult);
  logger.info({ syncResult }, "Odoo product sync completed");
  return syncResult;
}
async function getOrCreateStateRow() {
  const [row] = await db.select().from(odooSyncStateTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(odooSyncStateTable).values({}).returning();
  return created;
}
async function recordProductSyncResult(result) {
  const row = await getOrCreateStateRow();
  await db.update(odooSyncStateTable).set({
    lastProductsSyncAt: /* @__PURE__ */ new Date(),
    lastProductsResult: "ok",
    lastProductsError: null,
    productsCreatedCount: result.created,
    productsUpdatedCount: result.updated
  }).where(eq(odooSyncStateTable.id, row.id));
}

// scripts/verify-products-sync.ts
async function count() {
  const rows = await db2.select({ id: productsTable2.id }).from(productsTable2);
  return rows.length;
}
async function main() {
  console.log("--- Sync #1 ---");
  const r1 = await syncOdooProducts();
  console.log(r1);
  const c1 = await count();
  console.log("count after sync1:", c1);
  const [p] = await db2.select().from(productsTable2).limit(1);
  if (!p) throw new Error("No products synced");
  await db2.update(productsTable2).set({ pesoKg: 123.45, largoCm: 50, anchoCm: 40, altoCm: 30, dimensionesConfirmadas: true, notas: "medido a mano" }).where(eq2(productsTable2.id, p.id));
  console.log("Set manual fields on product id", p.id, "odooId", p.odooId);
  console.log("--- Sync #2 ---");
  const r2 = await syncOdooProducts();
  console.log(r2);
  const c2 = await count();
  console.log("count after sync2:", c2, c1 === c2 ? "(NO DUPLICATES \u2713)" : "(DUPLICATES! \u2717)");
  const [after] = await db2.select().from(productsTable2).where(eq2(productsTable2.id, p.id));
  console.log("After sync2 manual fields:", {
    pesoKg: after.pesoKg,
    largoCm: after.largoCm,
    anchoCm: after.anchoCm,
    altoCm: after.altoCm,
    dimensionesConfirmadas: after.dimensionesConfirmadas,
    notas: after.notas
  });
  const ok = after.pesoKg === 123.45 && after.largoCm === 50 && after.anchoCm === 40 && after.altoCm === 30 && after.dimensionesConfirmadas === true && after.notas === "medido a mano";
  console.log(ok ? "MANUAL FIELDS PRESERVED \u2713" : "MANUAL FIELDS LOST \u2717");
  const sinDim = await db2.select({ id: productsTable2.id, dc: productsTable2.dimensionesConfirmadas }).from(productsTable2).where(eq2(productsTable2.dimensionesConfirmadas, false));
  const allFalse = sinDim.every((r) => r.dc === false);
  console.log(`sin-dimensiones filter: ${sinDim.length} rows, all false: ${allFalse ? "\u2713" : "\u2717"}`);
  if (!ok || c1 !== c2) process.exit(1);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
