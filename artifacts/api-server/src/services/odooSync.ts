import { eq, inArray } from "drizzle-orm";
import { db, salesTable, saleItemsTable, productsTable, odooSyncStateTable } from "@workspace/db";
import {
  authenticate,
  executeKw,
  getOdooConfig,
  OdooError,
  type OdooConfig,
} from "../lib/odooClient";
import { logger } from "../lib/logger";

export interface SyncResult {
  imported: number;
  skipped: number;
  orders: string[];
}

interface OdooSaleOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  partner_shipping_id: [number, string] | false;
  user_id: [number, string] | false;
  note: string | false;
  order_line: number[];
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

export async function syncOdooOrders(): Promise<SyncResult> {
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexión Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY.",
    );
  }

  const uid = await authenticate(config);
  const orders = await fetchConfirmedOrders(config, uid);

  if (orders.length === 0) {
    await recordSyncResult({ imported: 0, skipped: 0, orders: [] });
    return { imported: 0, skipped: 0, orders: [] };
  }

  // Idempotency: skip orders already imported (by Odoo id)
  const existing = await db
    .select({ odooId: salesTable.odooId })
    .from(salesTable)
    .where(
      inArray(
        salesTable.odooId,
        orders.map((o) => o.id),
      ),
    );
  const existingIds = new Set(existing.map((r) => r.odooId));
  const newOrders = orders.filter((o) => !existingIds.has(o.id));
  const skipped = orders.length - newOrders.length;

  if (newOrders.length === 0) {
    await recordSyncResult({ imported: 0, skipped, orders: [] });
    return { imported: 0, skipped, orders: [] };
  }

  // Fetch order lines and products to compute weight/volume
  const lineIds = newOrders.flatMap((o) => o.order_line);
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
      newOrders
        .filter((o) => o.partner_shipping_id)
        .map((o) => (o.partner_shipping_id as [number, string])[0]),
    ),
  ];
  const partners = await readPartners(config, uid, partnerIds);
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const importedRefs: string[] = [];

  for (const order of newOrders) {
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
    const destino = buildDestino(shippingPartner) ?? "Por definir";

    const notas = order.note ? stripHtml(String(order.note)) : null;

    // Build sale items from order lines using LogiFleet catalog dimensions
    let dimensionesIncompletas = false;
    const itemsToCreate: {
      productId: number | null;
      descripcion: string;
      cantidad: number;
      pesoUnitario: number;
      largo: number;
      ancho: number;
      alto: number;
    }[] = [];
    for (const line of orderLines) {
      if (!line.product_id) continue;
      const catalog = catalogByOdooId.get(line.product_id[0]);
      const qty = Math.max(1, Math.round(line.product_uom_qty ?? 1));
      if (catalog && catalog.dimensionesConfirmadas) {
        itemsToCreate.push({
          productId: catalog.id,
          descripcion: catalog.nombre,
          cantidad: qty,
          pesoUnitario: catalog.pesoKg ?? 0,
          largo: catalog.largoCm ?? 0,
          ancho: catalog.anchoCm ?? 0,
          alto: catalog.altoCm ?? 0,
        });
      } else {
        // Producto sin dimensiones confirmadas o ausente del catálogo → partida pendiente
        dimensionesIncompletas = true;
        itemsToCreate.push({
          productId: catalog?.id ?? null,
          descripcion: catalog?.nombre ?? line.product_id[1],
          cantidad: qty,
          pesoUnitario: catalog?.pesoKg ?? 0,
          largo: catalog?.largoCm ?? 0,
          ancho: catalog?.anchoCm ?? 0,
          alto: catalog?.altoCm ?? 0,
        });
      }
    }

    const pesoTotalOdoo = Math.round(peso * 100) / 100;
    const volumenTotalOdoo = Math.round(volumen * 10000) / 10000;
    const pesoLocal = itemsToCreate.reduce((s, it) => s + it.cantidad * it.pesoUnitario, 0);
    const volumenLocal = itemsToCreate.reduce(
      (s, it) => s + (it.cantidad * it.largo * it.ancho * it.alto) / 1_000_000,
      0,
    );
    const hasLocalData = itemsToCreate.length > 0 && (pesoLocal > 0 || volumenLocal > 0);

    const inserted = await db
      .insert(salesTable)
      .values({
        cliente: order.partner_id ? order.partner_id[1] : "Cliente Odoo",
        vendedor: order.user_id ? order.user_id[1] : null,
        personaContacto: shippingPartner?.name ?? null,
        numeroCel:
          (shippingPartner?.mobile && String(shippingPartner.mobile)) ||
          (shippingPartner?.phone && String(shippingPartner.phone)) ||
          null,
        tipoMaterial: materials.size > 0 ? [...materials].slice(0, 3).join(", ") : null,
        pesoTotal: hasLocalData ? Math.round(pesoLocal * 100) / 100 : pesoTotalOdoo,
        volumenTotal: hasLocalData ? Math.round(volumenLocal * 10000) / 10000 : volumenTotalOdoo,
        pesoTotalOdoo,
        volumenTotalOdoo,
        dimensionesIncompletas,
        destino,
        estado: "pendiente",
        notas,
        odooRef: order.name,
        odooId: order.id,
      })
      .onConflictDoNothing({ target: salesTable.odooId })
      .returning({ id: salesTable.id });
    if (inserted.length > 0) {
      const ventaId = inserted[0]!.id;
      if (itemsToCreate.length > 0) {
        await db
          .insert(saleItemsTable)
          .values(itemsToCreate.map((it) => ({ ...it, ventaId })));
      }
      importedRefs.push(order.name);
    }
  }

  const result: SyncResult = {
    imported: importedRefs.length,
    skipped,
    orders: importedRefs,
  };
  await recordSyncResult(result);
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
    try {
      const result = await syncOdooOrders();
      if (result.imported > 0) {
        logger.info({ result }, "Odoo sync imported new orders");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Odoo periodic sync failed");
      await recordSyncError(message).catch(() => {});
    }
  };
  pollTimer = setInterval(() => void run(), POLL_INTERVAL_MS);
  // First run shortly after boot
  setTimeout(() => void run(), 10_000);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Odoo polling scheduled");
}
