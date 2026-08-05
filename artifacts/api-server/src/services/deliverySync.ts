import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  salesTable,
  productsTable,
  deliveriesTable,
  deliveryItemsTable,
  odooSyncStateTable,
} from "@workspace/db";
import {
  authenticate,
  executeKw,
  getOdooConfig,
  OdooError,
  type OdooConfig,
} from "../lib/odooClient";
import { logger } from "../lib/logger";
import { recomputeDeliveryDerivedState } from "./deliveryEstado";

export interface DeliverySyncResult {
  created: number;
  updated: number;
  itemsUpserted: number;
  unmatched: number;
  total: number;
}

interface OdooPicking {
  id: number;
  name: string;
  state: string;
  scheduled_date: string | false;
  date_done: string | false;
  origin: string | false;
  picking_type_id: [number, string] | false;
  location_id: [number, string] | false;
  backorder_id: [number, string] | false;
  sale_id: [number, string] | false;
  write_date: string;
  move_ids: number[];
}

interface OdooMove {
  id: number;
  product_id: [number, string] | false;
  product_uom_qty: number;
  quantity: number;
  product_uom: [number, string] | false;
  state: string;
  picking_id: [number, string];
}

const FETCH_BATCH_SIZE = 200;

/** Parse an Odoo UTC datetime string ("2026-08-03 13:42:05") into a JS Date.
 *  Odoo returns times in UTC without a timezone suffix, so we append 'Z'. */
function parseOdooDatetime(value: string | false): Date | null {
  if (!value) return null;
  try {
    return new Date(value.replace(" ", "T") + "Z");
  } catch {
    return null;
  }
}

/** Derive warehouse code from a location name like "CCS/Existencias" → "CCS". */
function locationToCode(locationName: string | null): string | null {
  if (!locationName) return null;
  const slash = String(locationName).indexOf("/");
  if (slash > 0) return String(locationName).substring(0, slash);
  return null;
}

async function fetchOutgoingPickings(
  config: OdooConfig,
  uid: number,
): Promise<OdooPicking[]> {
  const all: OdooPicking[] = [];
  let lastId = 0;
  for (;;) {
    const batch = (await executeKw(
      config,
      uid,
      "stock.picking",
      "search_read",
      [
        [
          ["picking_type_id.code", "=", "outgoing"],
          ["id", ">", lastId],
        ],
      ],
      {
        fields: [
          "name",
          "state",
          "scheduled_date",
          "date_done",
          "origin",
          "picking_type_id",
          "location_id",
          "backorder_id",
          "sale_id",
          "write_date",
          "move_ids",
        ],
        limit: FETCH_BATCH_SIZE,
        order: "id asc",
      },
    )) as OdooPicking[];
    all.push(...batch);
    if (batch.length < FETCH_BATCH_SIZE) break;
    lastId = batch[batch.length - 1]!.id;
  }
  return all;
}

async function fetchMovesBatch(
  config: OdooConfig,
  uid: number,
  moveIds: number[],
): Promise<OdooMove[]> {
  if (moveIds.length === 0) return [];
  return (await executeKw(config, uid, "stock.move", "read", [moveIds], {
    fields: ["product_id", "product_uom_qty", "quantity", "product_uom", "state", "picking_id"],
  })) as OdooMove[];
}

// ─── DB helpers ────────────────────────────────────────────────────────────

async function getOrCreateStateRow() {
  const [row] = await db.select().from(odooSyncStateTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(odooSyncStateTable).values({}).returning();
  return created!;
}

async function recordDeliverySyncResult(result: DeliverySyncResult): Promise<void> {
  const row = await getOrCreateStateRow();
  await db
    .update(odooSyncStateTable)
    .set({
      lastDeliveriesSyncAt: new Date(),
      lastDeliveriesResult: "ok",
      lastDeliveriesError: null,
      deliveriesCreatedCount: result.created,
      deliveriesUpdatedCount: result.updated,
    })
    .where(eq(odooSyncStateTable.id, row.id));
}

export async function recordDeliverySyncError(message: string): Promise<void> {
  const row = await getOrCreateStateRow();
  await db
    .update(odooSyncStateTable)
    .set({
      lastDeliveriesSyncAt: new Date(),
      lastDeliveriesResult: "error",
      lastDeliveriesError: message,
    })
    .where(eq(odooSyncStateTable.id, row.id));
}

// ─── Main sync ─────────────────────────────────────────────────────────────

export async function syncDeliveries(): Promise<DeliverySyncResult> {
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexión Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY.",
    );
  }

  const uid = await authenticate(config);

  // ── Guard: verify critical fields exist before proceeding ────────────────
  logger.info("Verificando campos críticos en Odoo antes del sync de albaranes");

  const pickingFields = (await executeKw(
    config,
    uid,
    "stock.picking",
    "fields_get",
    [],
    { attributes: ["type"] },
  )) as Record<string, unknown>;

  if (!("location_id" in pickingFields)) {
    throw new OdooError(
      'Campo crítico "location_id" no existe en stock.picking — abortar sync de albaranes',
    );
  }

  const moveFields = (await executeKw(
    config,
    uid,
    "stock.move",
    "fields_get",
    [],
    { attributes: ["type"] },
  )) as Record<string, unknown>;

  if (!("quantity" in moveFields)) {
    throw new OdooError(
      'Campo crítico "quantity" no existe en stock.move (Odoo ≤16 usa quantity_done) — abortar sync de albaranes',
    );
  }

  // Log optional field availability
  const optionalPickingFields = ["scheduled_date", "date_done", "backorder_id"];
  for (const f of optionalPickingFields) {
    if (!(f in pickingFields)) {
      logger.warn({ field: f }, "Campo opcional de stock.picking no disponible en este Odoo");
    }
  }

  // ── Fetch all outgoing pickings ──────────────────────────────────────────
  logger.info("Descargando albaranes de salida de Odoo...");
  const pickings = await fetchOutgoingPickings(config, uid);
  logger.info({ total: pickings.length }, "Albaranes de salida obtenidos de Odoo");

  // ── Build sale lookup maps ───────────────────────────────────────────────
  // We need both odooId → sale.id and odooRef → sale.id for fallback matching
  const salesRows = await db
    .select({ id: salesTable.id, odooId: salesTable.odooId, odooRef: salesTable.odooRef })
    .from(salesTable);
  const saleByOdooId = new Map<number, number>(); // odooId → sale PK id
  const saleByOdooRef = new Map<string, number>(); // odooRef → sale PK id
  for (const s of salesRows) {
    if (s.odooId !== null) saleByOdooId.set(s.odooId, s.id);
    if (s.odooRef !== null) saleByOdooRef.set(s.odooRef, s.id);
  }

  // ── Match pickings to sales ──────────────────────────────────────────────
  let unmatched = 0;
  const matched: Array<{ picking: OdooPicking; saleId: number }> = [];
  for (const p of pickings) {
    let saleId: number | undefined;

    // Primary: sale_id[0] → sales.odooId
    if (p.sale_id !== false) {
      saleId = saleByOdooId.get(p.sale_id[0]);
    }

    // Fallback: origin → sales.odooRef
    if (saleId === undefined && p.origin && typeof p.origin === "string" && p.origin.trim()) {
      saleId = saleByOdooRef.get(p.origin.trim());
    }

    if (saleId === undefined) {
      unmatched++;
      logger.debug(
        { pickingId: p.id, name: p.name, saleId: p.sale_id, origin: p.origin },
        "Albarán sin match en ventas locales — se omite",
      );
      continue;
    }

    matched.push({ picking: p, saleId });
  }

  logger.info(
    { total: pickings.length, matched: matched.length, unmatched },
    "Match de albaranes completado",
  );

  // ── Collect all move IDs from matched pickings ───────────────────────────
  const allMoveIds = matched.flatMap((m) => m.picking.move_ids);
  const uniqueMoveIds = [...new Set(allMoveIds)];

  // Fetch stock.moves in batches of 200
  const allMoves: OdooMove[] = [];
  for (let i = 0; i < uniqueMoveIds.length; i += FETCH_BATCH_SIZE) {
    const batch = uniqueMoveIds.slice(i, i + FETCH_BATCH_SIZE);
    const moves = await fetchMovesBatch(config, uid, batch);
    allMoves.push(...moves);
  }
  const movesByPickingId = new Map<number, OdooMove[]>();
  for (const m of allMoves) {
    const pickId = m.picking_id[0];
    if (!movesByPickingId.has(pickId)) movesByPickingId.set(pickId, []);
    movesByPickingId.get(pickId)!.push(m);
  }

  // ── Build product catalog lookup by odooId ───────────────────────────────
  const uniqueProductOdooIds = [
    ...new Set(
      allMoves
        .filter((m) => m.product_id !== false)
        .map((m) => (m.product_id as [number, string])[0]),
    ),
  ];
  const catalogProducts =
    uniqueProductOdooIds.length > 0
      ? await db
          .select({ id: productsTable.id, odooId: productsTable.odooId })
          .from(productsTable)
          .where(inArray(productsTable.odooId, uniqueProductOdooIds))
      : [];
  const catalogByOdooId = new Map(catalogProducts.map((p) => [p.odooId!, p.id]));

  // ── UPSERT deliveries and items ──────────────────────────────────────────
  let created = 0;
  let updated = 0;
  let itemsUpserted = 0;
  const now = new Date();

  for (const { picking: p, saleId } of matched) {
    const locationName = p.location_id !== false ? p.location_id[1] : null;
    const almacenCodigo = locationToCode(locationName);
    const backorderOdooId = p.backorder_id !== false ? p.backorder_id[0] : null;

    const deliveryValues = {
      ventaId: saleId,
      odooId: p.id,
      nombre: p.name,
      estado: p.state,
      tipoOperacion: p.picking_type_id !== false ? p.picking_type_id[1] : null,
      almacenOrigen: locationName,
      almacenCodigo,
      fechaProgramada: parseOdooDatetime(p.scheduled_date),
      fechaEfectiva: parseOdooDatetime(p.date_done),
      documentoOrigen: p.origin !== false ? p.origin : null,
      backorderDeOdooId: backorderOdooId,
      odooWriteDate: p.write_date,
      lastSyncAt: now,
    };

    // UPSERT by odooId — idempotent, second run updates without duplicating
    const result = await db
      .insert(deliveriesTable)
      .values({ ...deliveryValues, createdAt: now })
      .onConflictDoUpdate({
        target: deliveriesTable.odooId,
        set: {
          nombre: deliveryValues.nombre,
          estado: deliveryValues.estado,
          tipoOperacion: deliveryValues.tipoOperacion,
          almacenOrigen: deliveryValues.almacenOrigen,
          almacenCodigo: deliveryValues.almacenCodigo,
          fechaProgramada: deliveryValues.fechaProgramada,
          fechaEfectiva: deliveryValues.fechaEfectiva,
          documentoOrigen: deliveryValues.documentoOrigen,
          backorderDeOdooId: deliveryValues.backorderDeOdooId,
          odooWriteDate: deliveryValues.odooWriteDate,
          lastSyncAt: deliveryValues.lastSyncAt,
        },
      })
      .returning({ id: deliveriesTable.id, isNew: sql<boolean>`(xmax = 0)` });

    const row = result[0]!;
    if (row.isNew) {
      created++;
    } else {
      updated++;
    }
    const deliveryId = row.id;

    // UPSERT delivery items
    const moves = movesByPickingId.get(p.id) ?? [];
    for (const move of moves) {
      const productOdooId = move.product_id !== false ? move.product_id[0] : null;
      const productoDesc = move.product_id !== false ? move.product_id[1] : "Producto desconocido";
      const productId = productOdooId !== null ? (catalogByOdooId.get(productOdooId) ?? null) : null;

      await db
        .insert(deliveryItemsTable)
        .values({
          deliveryId,
          productId,
          odooMoveId: move.id,
          descripcion: productoDesc,
          cantidadDemanda: move.product_uom_qty ?? 0,
          cantidadEntregada: move.quantity ?? 0,
          uom: move.product_uom !== false ? move.product_uom[1] : null,
          estado: move.state,
        })
        .onConflictDoUpdate({
          target: deliveryItemsTable.odooMoveId,
          set: {
            deliveryId,
            productId,
            descripcion: productoDesc,
            cantidadDemanda: move.product_uom_qty ?? 0,
            cantidadEntregada: move.quantity ?? 0,
            uom: move.product_uom !== false ? move.product_uom[1] : null,
            estado: move.state,
          },
        });
      itemsUpserted++;
    }
  }

  const syncResult: DeliverySyncResult = {
    created,
    updated,
    itemsUpserted,
    unmatched,
    total: pickings.length,
  };

  // ── Derive estadoEntrega / almacenOrigen for all sales touched this run ──
  const touchedSaleIds = [...new Set(matched.map((m) => m.saleId))];
  await recomputeDeliveryDerivedState(touchedSaleIds);

  await recordDeliverySyncResult(syncResult);
  logger.info({ syncResult }, "Sync de albaranes completado");
  return syncResult;
}
