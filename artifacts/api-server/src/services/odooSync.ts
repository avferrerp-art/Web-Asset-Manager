import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  salesTable,
  saleItemsTable,
  productsTable,
  odooSyncStateTable,
  syncAlertsTable,
} from "@workspace/db";
import {
  authenticate,
  executeKw,
  getOdooConfig,
  OdooError,
  type OdooConfig,
} from "../lib/odooClient";
import { logger } from "../lib/logger";
import { recalcSales } from "./productBackfill";

export interface OrderChange {
  odooRef: string;
  estado: string;
  fields: string[];
}

export interface SyncResult {
  imported: number;
  skipped: number;
  orders: string[];
  updated: string[];
  changes: OrderChange[];
  alertsCreated: number;
  dryRun: boolean;
}

interface OdooSaleOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  partner_shipping_id: [number, string] | false;
  user_id: [number, string] | false;
  note: string | false;
  order_line: number[];
  write_date: string;
}

interface OdooOrderLine {
  id: number;
  order_id: [number, string];
  product_id: [number, string] | false;
  product_uom_qty: number;
}

interface OdooProduct {
  id: number;
  weight: number;
  volume: number;
}

export interface OdooPartner {
  id: number;
  name: string;
  street: string | false;
  street2: string | false;
  city: string | false;
  zip: string | false;
  state_id: [number, string] | false;
  country_id: [number, string] | false;
  contact_address: string | false;
  phone: string | false;
  mobile: string | false;
}

// Fields we want from res.partner. Address fields must never be silently dropped.
const PARTNER_FIELDS = [
  "name",
  "street",
  "street2",
  "city",
  "zip",
  "state_id",
  "country_id",
  "contact_address",
  "phone",
  "mobile",
] as const;
const PARTNER_ADDRESS_FIELDS = new Set([
  "street",
  "street2",
  "city",
  "zip",
  "state_id",
  "country_id",
  "contact_address",
]);

/**
 * Read partners robustly:
 * 1. Detect which fields actually exist via fields_get and request only those.
 * 2. If a read still fails, degrade optional (non-address) fields one by one,
 *    always keeping name + address fields. Never fall back to name+phone only.
 * Any degradation is logged at warn level with the fields lost.
 */
export async function readPartners(
  config: OdooConfig,
  uid: number,
  partnerIds: number[],
): Promise<OdooPartner[]> {
  if (partnerIds.length === 0) return [];

  let fields: string[] = [...PARTNER_FIELDS];
  try {
    const available = (await executeKw(config, uid, "res.partner", "fields_get", [], {
      attributes: ["type"],
    })) as Record<string, unknown>;
    const missing = fields.filter((f) => !(f in available));
    if (missing.length > 0) {
      logger.warn(
        { missingFields: missing },
        "Odoo res.partner no expone algunos campos; se omiten de la lectura",
      );
      fields = fields.filter((f) => f in available);
    }
  } catch (err) {
    logger.warn({ err }, "fields_get de res.partner falló; se intentará con la lista completa");
  }

  try {
    return (await executeKw(config, uid, "res.partner", "read", [partnerIds], {
      fields,
    })) as OdooPartner[];
  } catch (err) {
    logger.warn(
      { err, fields },
      "Lectura de res.partner falló; degradando campos opcionales uno por uno (los campos de dirección se conservan)",
    );
  }

  // Degrade optional (non-address, non-name) fields one at a time.
  const optional = fields.filter((f) => f !== "name" && !PARTNER_ADDRESS_FIELDS.has(f));
  const dropped: string[] = [];
  let current = [...fields];
  for (const field of optional) {
    current = current.filter((f) => f !== field);
    dropped.push(field);
    try {
      const partners = (await executeKw(config, uid, "res.partner", "read", [partnerIds], {
        fields: current,
      })) as OdooPartner[];
      logger.warn(
        { droppedFields: dropped },
        "Lectura de res.partner degradada: se perdieron campos opcionales",
      );
      return partners;
    } catch {
      // keep dropping
    }
  }

  // Last attempt: name + address fields only (address is never sacrificed).
  const addressOnly = fields.filter((f) => f === "name" || PARTNER_ADDRESS_FIELDS.has(f));
  logger.error(
    { attemptedFields: addressOnly },
    "Lectura de res.partner degradada al mínimo (solo name + dirección)",
  );
  return (await executeKw(config, uid, "res.partner", "read", [partnerIds], {
    fields: addressOnly,
  })) as OdooPartner[];
}

/**
 * Compose a real destination address from partner data.
 * Returns null when the partner has no usable address (caller decides fallback).
 * Never returns the partner name.
 */
export function buildDestino(partner: OdooPartner | undefined): string | null {
  if (!partner) return null;
  const state = partner.state_id ? partner.state_id[1] : null;
  const country = partner.country_id ? partner.country_id[1] : null;
  const parts = [
    partner.street && String(partner.street).trim(),
    partner.street2 && String(partner.street2).trim(),
    partner.city && String(partner.city).trim(),
    state,
    country,
  ].filter((p): p is string => Boolean(p));
  if (parts.length > 0) return parts.join(", ");
  if (partner.contact_address) {
    const addr = stripHtml(String(partner.contact_address));
    // contact_address in Odoo often equals/embeds the partner name; strip it
    const name = String(partner.name ?? "").trim();
    const cleaned = name
      ? addr.replace(name, "").replace(/^[,\s]+|[,\s]+$/g, "").trim()
      : addr;
    if (cleaned && cleaned !== name) return cleaned;
  }
  return null;
}

export async function testOdooConnection(): Promise<{ uid: number; url: string }> {
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexión Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY.",
    );
  }
  const uid = await authenticate(config);
  return { uid, url: config.url };
}

const FETCH_BATCH_SIZE = 200;

async function fetchConfirmedOrders(
  config: OdooConfig,
  uid: number,
): Promise<OdooSaleOrder[]> {
  const all: OdooSaleOrder[] = [];
  let lastId = 0;
  for (;;) {
    const batch = (await executeKw(
      config,
      uid,
      "sale.order",
      "search_read",
      [[["state", "in", ["sale", "done"]], ["id", ">", lastId]]],
      {
        fields: [
          "name",
          "partner_id",
          "partner_shipping_id",
          "user_id",
          "note",
          "order_line",
          "write_date",
        ],
        limit: FETCH_BATCH_SIZE,
        order: "id asc",
      },
    )) as OdooSaleOrder[];
    all.push(...batch);
    if (batch.length < FETCH_BATCH_SIZE) break;
    lastId = batch[batch.length - 1]!.id;
  }
  return all;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Shared computation: given an Odoo order + its lines/products/partners,
// compute what the LogiFleet sale (and its items) should look like.
// ---------------------------------------------------------------------------
interface DesiredItem {
  key: string; // odoo product id or descripcion-based key
  productId: number | null;
  descripcion: string;
  cantidad: number;
}

interface DesiredSale {
  cliente: string;
  vendedor: string | null;
  personaContacto: string | null;
  numeroCel: string | null;
  tipoMaterial: string | null;
  destino: string | null; // null = no usable address from Odoo
  notas: string | null;
  pesoTotalOdoo: number;
  volumenTotalOdoo: number;
  items: DesiredItem[];
}

function itemKey(odooProductId: number | null, descripcion: string): string {
  return odooProductId !== null ? `p:${odooProductId}` : `d:${descripcion.trim().toLowerCase()}`;
}

function computeDesiredSale(
  order: OdooSaleOrder,
  lines: OdooOrderLine[],
  productById: Map<number, OdooProduct>,
  catalogByOdooId: Map<number | null, typeof productsTable.$inferSelect>,
  partnerById: Map<number, OdooPartner>,
): DesiredSale {
  const orderLines = lines.filter((l) => l.order_id[0] === order.id);
  let peso = 0;
  let volumen = 0;
  const materials = new Set<string>();
  for (const line of orderLines) {
    if (!line.product_id) continue;
    const product = productById.get(line.product_id[0]);
    const qty = line.product_uom_qty ?? 0;
    if (product) {
      peso += (product.weight ?? 0) * qty;
      volumen += (product.volume ?? 0) * qty;
    }
    materials.add(line.product_id[1]);
  }

  const shippingPartner = order.partner_shipping_id
    ? partnerById.get(order.partner_shipping_id[0])
    : undefined;

  // Aggregate items by product (multiple Odoo lines for the same product merge)
  const byKey = new Map<string, DesiredItem>();
  for (const line of orderLines) {
    if (!line.product_id) continue;
    const odooProductId = line.product_id[0];
    const catalog = catalogByOdooId.get(odooProductId);
    const qty = Math.max(1, Math.round(line.product_uom_qty ?? 1));
    const key = itemKey(odooProductId, catalog?.nombre ?? line.product_id[1]);
    const existing = byKey.get(key);
    if (existing) {
      existing.cantidad += qty;
      continue;
    }
    byKey.set(key, {
      key,
      productId: catalog?.id ?? null,
      descripcion: catalog?.nombre ?? line.product_id[1],
      cantidad: qty,
    });
  }

  return {
    cliente: order.partner_id ? order.partner_id[1] : "Cliente Odoo",
    vendedor: order.user_id ? order.user_id[1] : null,
    personaContacto: shippingPartner?.name ?? null,
    numeroCel:
      (shippingPartner?.mobile && String(shippingPartner.mobile)) ||
      (shippingPartner?.phone && String(shippingPartner.phone)) ||
      null,
    tipoMaterial: materials.size > 0 ? [...materials].slice(0, 3).join(", ") : null,
    destino: buildDestino(shippingPartner),
    notas: order.note ? stripHtml(String(order.note)) : null,
    pesoTotalOdoo: Math.round(peso * 100) / 100,
    volumenTotalOdoo: Math.round(volumen * 10000) / 10000,
    items: [...byKey.values()],
  };
}

export interface SyncOptions {
  dryRun?: boolean;
}

export async function syncOdooOrders(options: SyncOptions = {}): Promise<SyncResult> {
  const dryRun = options.dryRun ?? false;
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexión Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY.",
    );
  }

  const uid = await authenticate(config);
  const orders = await fetchConfirmedOrders(config, uid);

  const emptyResult: SyncResult = {
    imported: 0,
    skipped: 0,
    orders: [],
    updated: [],
    changes: [],
    alertsCreated: 0,
    dryRun,
  };

  if (orders.length === 0) {
    if (!dryRun) await recordSyncResult(emptyResult);
    return emptyResult;
  }

  // Split into new orders vs. already-imported orders (by Odoo id)
  const existing = await db
    .select({
      id: salesTable.id,
      odooId: salesTable.odooId,
      estado: salesTable.estado,
      odooWriteDate: salesTable.odooWriteDate,
    })
    .from(salesTable)
    .where(
      inArray(
        salesTable.odooId,
        orders.map((o) => o.id),
      ),
    );
  const existingByOdooId = new Map(existing.map((r) => [r.odooId, r]));
  const newOrders = orders.filter((o) => !existingByOdooId.has(o.id));

  // Change detection: existing orders whose Odoo write_date differs from the
  // one recorded at last sync (a never-recorded write_date counts as changed —
  // the field diff below decides whether anything is actually different).
  const changedOrders = orders.filter((o) => {
    const row = existingByOdooId.get(o.id);
    return row !== undefined && row.odooWriteDate !== o.write_date;
  });
  const skipped = orders.length - newOrders.length - changedOrders.length;

  if (newOrders.length === 0 && changedOrders.length === 0) {
    const result = { ...emptyResult, skipped };
    if (!dryRun) await recordSyncResult(result);
    return result;
  }

  // Fetch order lines, products, catalog and partners for all orders we touch
  const touchedOrders = [...newOrders, ...changedOrders];
  const lineIds = touchedOrders.flatMap((o) => o.order_line);
  const lines =
    lineIds.length > 0
      ? ((await executeKw(config, uid, "sale.order.line", "read", [lineIds], {
          fields: ["order_id", "product_id", "product_uom_qty"],
        })) as OdooOrderLine[])
      : [];

  const productIds = [
    ...new Set(lines.filter((l) => l.product_id).map((l) => (l.product_id as [number, string])[0])),
  ];
  const products =
    productIds.length > 0
      ? ((await executeKw(config, uid, "product.product", "read", [productIds], {
          fields: ["weight", "volume"],
        })) as OdooProduct[])
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  // Resolve LogiFleet catalog products by Odoo id (source of truth for peso/dimensiones)
  const catalogProducts =
    productIds.length > 0
      ? await db.select().from(productsTable).where(inArray(productsTable.odooId, productIds))
      : [];
  const catalogByOdooId = new Map(catalogProducts.map((p) => [p.odooId, p]));

  // Fetch shipping partners for destination info
  const partnerIds = [
    ...new Set(
      touchedOrders
        .filter((o) => o.partner_shipping_id)
        .map((o) => (o.partner_shipping_id as [number, string])[0]),
    ),
  ];
  const partners = await readPartners(config, uid, partnerIds);
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // ── Import new orders (unchanged behavior + write_date recorded) ─────────
  const importedRefs: string[] = [];
  for (const order of newOrders) {
    const desired = computeDesiredSale(order, lines, productById, catalogByOdooId, partnerById);
    const destino = desired.destino ?? "Por definir";

    if (dryRun) {
      importedRefs.push(order.name);
      continue;
    }

    const inserted = await db
      .insert(salesTable)
      .values({
        cliente: desired.cliente,
        vendedor: desired.vendedor,
        personaContacto: desired.personaContacto,
        numeroCel: desired.numeroCel,
        tipoMaterial: desired.tipoMaterial,
        // Totales SIEMPRE desde Odoo; 0 en Odoo significa "sin dato" → null
        pesoTotal: desired.pesoTotalOdoo > 0 ? desired.pesoTotalOdoo : null,
        volumenTotal: desired.volumenTotalOdoo > 0 ? desired.volumenTotalOdoo : null,
        pesoTotalOdoo: desired.pesoTotalOdoo,
        volumenTotalOdoo: desired.volumenTotalOdoo,
        destino,
        estado: "pendiente",
        notas: desired.notas,
        odooRef: order.name,
        odooId: order.id,
        odooWriteDate: order.write_date,
      })
      .onConflictDoNothing({ target: salesTable.odooId })
      .returning({ id: salesTable.id });
    if (inserted.length > 0) {
      const ventaId = inserted[0]!.id;
      if (desired.items.length > 0) {
        await db.insert(saleItemsTable).values(
          desired.items.map((it) => ({
            productId: it.productId,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            ventaId,
          })),
        );
      }
      importedRefs.push(order.name);
    }
  }

  // ── Update changed, already-imported orders (conservative) ───────────────
  const updatedRefs: string[] = [];
  const changes: OrderChange[] = [];
  let alertsCreated = 0;
  let unchangedStamped = 0;

  for (const order of changedOrders) {
    const row = existingByOdooId.get(order.id)!;
    const desired = computeDesiredSale(order, lines, productById, catalogByOdooId, partnerById);

    const [currentSale] = await db
      .select()
      .from(salesTable)
      .where(eq(salesTable.id, row.id));
    if (!currentSale) continue;

    const currentItems = await db
      .select()
      .from(saleItemsTable)
      .where(eq(saleItemsTable.ventaId, row.id));

    // Field diff on the sale header. destino only changes when Odoo provides
    // a real address (never downgrade an existing destino to "Por definir").
    const saleUpdate: Record<string, unknown> = {};
    const changedFields: string[] = [];
    const compare: [string, unknown, unknown][] = [
      ["cliente", currentSale.cliente, desired.cliente],
      ["vendedor", currentSale.vendedor, desired.vendedor],
      ["personaContacto", currentSale.personaContacto, desired.personaContacto],
      ["numeroCel", currentSale.numeroCel, desired.numeroCel],
      ["tipoMaterial", currentSale.tipoMaterial, desired.tipoMaterial],
      ["notas", currentSale.notas, desired.notas],
      // Regla crítica: pesoTotalOdoo/volumenTotalOdoo SOLO con valores de Odoo
      ["pesoTotalOdoo", currentSale.pesoTotalOdoo, desired.pesoTotalOdoo],
      ["volumenTotalOdoo", currentSale.volumenTotalOdoo, desired.volumenTotalOdoo],
    ];
    for (const [field, cur, next] of compare) {
      if (cur !== next) {
        saleUpdate[field] = next;
        changedFields.push(field);
      }
    }
    if (desired.destino !== null && desired.destino !== currentSale.destino) {
      saleUpdate["destino"] = desired.destino;
      changedFields.push("destino");
    }

    // Item reconciliation plan (match by catalog product, fallback descripcion).
    const catalogIdToOdooId = new Map(catalogProducts.map((p) => [p.id, p.odooId]));
    const currentByKey = new Map<string, (typeof currentItems)[number][]>();
    for (const it of currentItems) {
      const odooPid = it.productId !== null ? (catalogIdToOdooId.get(it.productId) ?? null) : null;
      const key = itemKey(odooPid, it.descripcion);
      const list = currentByKey.get(key) ?? [];
      list.push(it);
      currentByKey.set(key, list);
    }

    const itemOps: {
      kind: "insert" | "updateQty" | "delete";
      detail: string;
      run: () => Promise<void>;
    }[] = [];
    const matchedKeys = new Set<string>();
    for (const want of desired.items) {
      const have = currentByKey.get(want.key);
      if (have && have.length > 0) {
        matchedKeys.add(want.key);
        const totalQty = have.reduce((s, it) => s + it.cantidad, 0);
        const primary = have[0]!;
        if (totalQty !== want.cantidad) {
          itemOps.push({
            kind: "updateQty",
            detail: `${primary.descripcion}: cantidad ${totalQty} → ${want.cantidad}`,
            run: async () => {
              // Preserve productId and inherited dimensions; only fix quantity.
              await db
                .update(saleItemsTable)
                .set({ cantidad: want.cantidad })
                .where(eq(saleItemsTable.id, primary.id));
              const extras = have.slice(1).map((it) => it.id);
              if (extras.length > 0) {
                await db.delete(saleItemsTable).where(inArray(saleItemsTable.id, extras));
              }
            },
          });
        }
      } else {
        itemOps.push({
          kind: "insert",
          detail: `+ ${want.descripcion} x${want.cantidad}`,
          run: async () => {
            await db.insert(saleItemsTable).values({
              ventaId: row.id,
              productId: want.productId,
              descripcion: want.descripcion,
              cantidad: want.cantidad,
            });
          },
        });
      }
    }
    for (const [key, have] of currentByKey) {
      if (matchedKeys.has(key)) continue;
      const ids = have.map((it) => it.id);
      itemOps.push({
        kind: "delete",
        detail: `- ${have[0]!.descripcion}`,
        run: async () => {
          await db.delete(saleItemsTable).where(inArray(saleItemsTable.id, ids));
        },
      });
    }
    if (itemOps.length > 0) changedFields.push("partidas");

    if (changedFields.length === 0) {
      // Nothing actually differs (e.g. write_date never recorded, or a change
      // in an Odoo field we don't import). Just stamp write_date so the order
      // is not re-examined every run.
      if (!dryRun) {
        await db
          .update(salesTable)
          .set({ odooWriteDate: order.write_date })
          .where(eq(salesTable.id, row.id));
        unchangedStamped++;
      }
      continue;
    }

    changes.push({ odooRef: order.name, estado: currentSale.estado, fields: changedFields });

    // Non-pending orders: never touched — persistent alert for a human.
    if (currentSale.estado !== "pendiente") {
      if (!dryRun) {
        // Dedupe by (ventaId, odooWriteDate) regardless of resolution state:
        // a resolved alert for this same Odoo change must not be recreated.
        const [dup] = await db
          .select({ id: syncAlertsTable.id })
          .from(syncAlertsTable)
          .where(
            and(
              eq(syncAlertsTable.ventaId, row.id),
              eq(syncAlertsTable.odooWriteDate, order.write_date),
            ),
          )
          .limit(1);
        if (!dup) {
          await db.insert(syncAlertsTable).values({
            ventaId: row.id,
            odooId: order.id,
            odooRef: order.name,
            estado: currentSale.estado,
            mensaje: `La orden ${order.name} cambió en Odoo pero está en estado '${currentSale.estado}' — revisar manualmente. Campos: ${changedFields.join(", ")}`,
            campos: changedFields.join(","),
            odooWriteDate: order.write_date,
          });
          alertsCreated++;
          logger.warn(
            { odooRef: order.name, estado: currentSale.estado, fields: changedFields },
            "Orden no-pendiente cambió en Odoo: alerta creada, sin modificar",
          );
        }
      }
      continue;
    }

    if (dryRun) continue;

    // Apply header updates + write_date stamp
    await db
      .update(salesTable)
      .set({ ...saleUpdate, odooWriteDate: order.write_date })
      .where(eq(salesTable.id, row.id));

    // Apply item reconciliation
    for (const op of itemOps) await op.run();

    // Mirror pesoTotal/volumenTotal desde los totales de Odoo (recalcSales
    // never touches pesoTotalOdoo/volumenTotalOdoo).
    await recalcSales([row.id]);

    updatedRefs.push(order.name);
    logger.info(
      {
        odooRef: order.name,
        fields: changedFields,
        items: itemOps.map((op) => op.detail),
      },
      "Orden actualizada desde Odoo",
    );
  }

  const result: SyncResult = {
    imported: importedRefs.length,
    skipped: skipped + unchangedStamped,
    orders: importedRefs,
    updated: updatedRefs,
    changes,
    alertsCreated,
    dryRun,
  };
  if (!dryRun) await recordSyncResult(result);
  return result;
}

async function getOrCreateStateRow() {
  const [row] = await db.select().from(odooSyncStateTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(odooSyncStateTable).values({}).returning();
  return created!;
}

async function recordSyncResult(result: SyncResult): Promise<void> {
  const row = await getOrCreateStateRow();
  await db
    .update(odooSyncStateTable)
    .set({
      lastSyncAt: new Date(),
      lastResult: "ok",
      lastError: null,
      importedCount: result.imported,
      skippedCount: result.skipped,
    })
    .where(eq(odooSyncStateTable.id, row.id));
}

export async function recordSyncError(message: string): Promise<void> {
  const row = await getOrCreateStateRow();
  await db
    .update(odooSyncStateTable)
    .set({ lastSyncAt: new Date(), lastResult: "error", lastError: message })
    .where(eq(odooSyncStateTable.id, row.id));
}

export async function getSyncState() {
  const [row] = await db.select().from(odooSyncStateTable).limit(1);
  return row ?? null;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;
let pollTimer: NodeJS.Timeout | null = null;

export function startOdooPolling(): void {
  if (pollTimer) return;
  const run = async () => {
    if (!getOdooConfig()) return; // not configured yet — skip silently

    // 1) Orders sync (unchanged behavior)
    try {
      const result = await syncOdooOrders();
      if (result.imported > 0 || result.updated.length > 0 || result.alertsCreated > 0) {
        logger.info({ result }, "Odoo sync applied changes");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Odoo periodic sync failed");
      await recordSyncError(message).catch(() => {});
    }

    // 2) Deliveries sync — always AFTER orders in the same cycle (an albarán of
    // a not-yet-imported order can't be linked). Errors are recorded in
    // odoo_sync_state (lastDeliveriesError) and never crash the server.
    try {
      const { syncDeliveries } = await import("./deliverySync");
      const result = await syncDeliveries();
      if (
        result.created > 0 ||
        result.updated > 0 ||
        result.deleted > 0 ||
        result.itemsDeleted > 0 ||
        result.alertsCreated > 0
      ) {
        logger.info({ result }, "Odoo delivery sync applied changes");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Odoo periodic delivery sync failed");
      const { recordDeliverySyncError } = await import("./deliverySync");
      await recordDeliverySyncError(message).catch(() => {});
    }
  };
  pollTimer = setInterval(() => void run(), POLL_INTERVAL_MS);
  // First run shortly after boot
  setTimeout(() => void run(), 10_000);
  logger.info(
    { intervalMs: POLL_INTERVAL_MS, order: ["órdenes", "albaranes"] },
    "Odoo polling scheduled (cada ciclo: sync de órdenes → sync de albaranes)",
  );
}
