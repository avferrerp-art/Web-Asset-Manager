import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  db,
  salesTable,
  productsTable,
  deliveriesTable,
  deliveryItemsTable,
  dispatchesTable,
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
import { recomputeDeliveryDerivedState } from "./deliveryEstado";

export interface DeliverySyncResult {
  created: number;
  updated: number;
  /** Pickings already in sync (same odooWriteDate) — read but not written. */
  unchanged: number;
  itemsUpserted: number;
  /** Local delivery lines removed because their stock.move disappeared from the picking. */
  itemsDeleted: number;
  /** Local deliveries removed because the picking no longer exists in Odoo. */
  deleted: number;
  alertsCreated: number;
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
const WRITE_BATCH_SIZE = 500;

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

/** Lightweight id-only listing of ALL outgoing pickings (no fields read).
 *  Used to detect pickings deleted in Odoo without downloading their data. */
async function fetchOutgoingPickingIds(
  config: OdooConfig,
  uid: number,
): Promise<number[]> {
  return (await executeKw(config, uid, "stock.picking", "search", [
    [["picking_type_id.code", "=", "outgoing"]],
  ])) as number[];
}

/** Fetch outgoing pickings incrementally: when a watermark is given, only
 *  pickings with write_date >= watermark are downloaded from Odoo (server-side
 *  filter). '>=' instead of '>' avoids missing same-second edits; the per-row
 *  odooWriteDate comparison downstream discards true no-ops. */
async function fetchOutgoingPickings(
  config: OdooConfig,
  uid: number,
  sinceWriteDate: string | null,
): Promise<OdooPicking[]> {
  const all: OdooPicking[] = [];
  let lastId = 0;
  for (;;) {
    const domain: unknown[] = [
      ["picking_type_id.code", "=", "outgoing"],
      ["id", ">", lastId],
    ];
    if (sinceWriteDate) domain.push(["write_date", ">=", sinceWriteDate]);
    const batch = (await executeKw(
      config,
      uid,
      "stock.picking",
      "search_read",
      [domain],
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Alerts: albarán cancelado con despacho activo ─────────────────────────

/** For pickings that turned to 'cancel' in Odoo, create a sync alert when the
 *  linked sale has an active (non-cancelled) dispatch in LogiFleet. The alert
 *  only informs — no dispatch or sale is modified automatically.
 *  Deduped by (ventaId, odooWriteDate), same criterion as odooSync.ts. */
async function createCancelAlerts(
  cancelled: Array<{ picking: OdooPicking; saleId: number }>,
): Promise<number> {
  if (cancelled.length === 0) return 0;
  const saleIds = [...new Set(cancelled.map((c) => c.saleId))];

  const activeDispatches = await db
    .select({
      id: dispatchesTable.id,
      ventaId: dispatchesTable.ventaId,
      estado: dispatchesTable.estado,
    })
    .from(dispatchesTable)
    .where(
      and(
        inArray(dispatchesTable.ventaId, saleIds),
        sql`${dispatchesTable.estado} <> 'cancelado'`,
      ),
    );
  if (activeDispatches.length === 0) return 0;
  const dispatchBySaleId = new Map<number, (typeof activeDispatches)[number]>();
  for (const d of activeDispatches) {
    if (!dispatchBySaleId.has(d.ventaId)) dispatchBySaleId.set(d.ventaId, d);
  }

  const sales = await db
    .select({
      id: salesTable.id,
      odooRef: salesTable.odooRef,
      cliente: salesTable.cliente,
      estado: salesTable.estado,
    })
    .from(salesTable)
    .where(inArray(salesTable.id, saleIds));
  const saleById = new Map(sales.map((s) => [s.id, s]));

  let alertsCreated = 0;
  for (const { picking, saleId } of cancelled) {
    const dispatch = dispatchBySaleId.get(saleId);
    if (!dispatch) continue;
    const sale = saleById.get(saleId);

    // Dedupe by (ventaId, odooWriteDate) regardless of resolution state.
    const [dup] = await db
      .select({ id: syncAlertsTable.id })
      .from(syncAlertsTable)
      .where(
        and(
          eq(syncAlertsTable.ventaId, saleId),
          eq(syncAlertsTable.odooWriteDate, picking.write_date),
        ),
      )
      .limit(1);
    if (dup) continue;

    const ventaLabel = sale?.odooRef ? `${sale.odooRef} (${sale.cliente})` : `#${saleId}`;
    await db.insert(syncAlertsTable).values({
      ventaId: saleId,
      odooId: picking.id,
      odooRef: sale?.odooRef ?? null,
      estado: sale?.estado ?? "desconocido",
      mensaje: `El albarán ${picking.name} fue cancelado en Odoo, pero la venta ${ventaLabel} tiene el despacho #${dispatch.id} activo (estado '${dispatch.estado}') — revisar manualmente.`,
      campos: "albaran_cancelado",
      odooWriteDate: picking.write_date,
    });
    alertsCreated++;
    logger.warn(
      { picking: picking.name, ventaId: saleId, dispatchId: dispatch.id },
      "Albarán cancelado en Odoo con despacho activo: alerta creada, sin modificar nada",
    );
  }
  return alertsCreated;
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

  const optionalPickingFields = ["scheduled_date", "date_done", "backorder_id"];
  for (const f of optionalPickingFields) {
    if (!(f in pickingFields)) {
      logger.warn({ field: f }, "Campo opcional de stock.picking no disponible en este Odoo");
    }
  }

  // ── Local state: existing deliveries by odooId ────────────────────────────
  const localDeliveries = await db
    .select({
      id: deliveriesTable.id,
      odooId: deliveriesTable.odooId,
      ventaId: deliveriesTable.ventaId,
      estado: deliveriesTable.estado,
      odooWriteDate: deliveriesTable.odooWriteDate,
    })
    .from(deliveriesTable);
  const localByOdooId = new Map(localDeliveries.map((d) => [d.odooId, d]));

  // Watermark for the server-side incremental fetch: the max write_date we
  // have locally (Odoo datetime strings sort lexicographically). Null on the
  // first run → full fetch.
  let watermark: string | null = null;
  for (const d of localDeliveries) {
    if (d.odooWriteDate && (!watermark || d.odooWriteDate > watermark)) {
      watermark = d.odooWriteDate;
    }
  }

  // ── Incremental fetch: only pickings changed since the watermark ─────────
  const pickings = await fetchOutgoingPickings(config, uid, watermark);
  logger.info(
    { fetched: pickings.length, watermark },
    "Albaranes cambiados desde la última corrida obtenidos de Odoo",
  );

  // ── Reconcile deletions via id-only search (no data downloaded) ──────────
  const remoteIdList = await fetchOutgoingPickingIds(config, uid);
  const remoteIds = new Set(remoteIdList);
  const deletedLocal = localDeliveries.filter((d) => !remoteIds.has(d.odooId));
  let deleted = 0;
  if (deletedLocal.length > 0) {
    const ids = deletedLocal.map((d) => d.id);
    // delivery_items cascade on delete
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, ids));
    deleted = ids.length;
    logger.info(
      { deleted, nombres: deletedLocal.map((d) => d.odooId) },
      "Albaranes eliminados en Odoo — borrados localmente",
    );
  }

  // ── Build sale lookup maps ───────────────────────────────────────────────
  const salesRows = await db
    .select({ id: salesTable.id, odooId: salesTable.odooId, odooRef: salesTable.odooRef })
    .from(salesTable);
  const saleByOdooId = new Map<number, number>();
  const saleByOdooRef = new Map<string, number>();
  for (const s of salesRows) {
    if (s.odooId !== null) saleByOdooId.set(s.odooId, s.id);
    if (s.odooRef !== null) saleByOdooRef.set(s.odooRef, s.id);
  }

  // ── Match pickings to sales ──────────────────────────────────────────────
  let unmatched = 0;
  const matched: Array<{ picking: OdooPicking; saleId: number }> = [];
  for (const p of pickings) {
    let saleId: number | undefined;
    if (p.sale_id !== false) {
      saleId = saleByOdooId.get(p.sale_id[0]);
    }
    if (saleId === undefined && p.origin && typeof p.origin === "string" && p.origin.trim()) {
      saleId = saleByOdooRef.get(p.origin.trim());
    }
    if (saleId === undefined) {
      unmatched++;
      continue;
    }
    matched.push({ picking: p, saleId });
  }

  // ── Incremental filter: only touch new pickings or changed write_date ────
  // (same odooWriteDate criterion as the orders sync in odooSync.ts)
  const changed = matched.filter(({ picking }) => {
    const local = localByOdooId.get(picking.id);
    return local === undefined || local.odooWriteDate !== picking.write_date;
  });
  const unchanged = matched.length - changed.length;

  logger.info(
    { total: pickings.length, matched: matched.length, changed: changed.length, unchanged, unmatched, deleted },
    "Match incremental de albaranes completado",
  );

  let created = 0;
  let updated = 0;
  let itemsUpserted = 0;
  let itemsDeleted = 0;
  let alertsCreated = 0;
  const now = new Date();
  const touchedSaleIds = new Set<number>(deletedLocal.map((d) => d.ventaId));

  if (changed.length > 0) {
    // ── Fetch moves ONLY for changed pickings ──────────────────────────────
    const uniqueMoveIds = [...new Set(changed.flatMap((m) => m.picking.move_ids))];
    const allMoves: OdooMove[] = [];
    for (const batch of chunk(uniqueMoveIds, FETCH_BATCH_SIZE)) {
      allMoves.push(...(await fetchMovesBatch(config, uid, batch)));
    }
    const movesByPickingId = new Map<number, OdooMove[]>();
    for (const m of allMoves) {
      const pickId = m.picking_id[0];
      if (!movesByPickingId.has(pickId)) movesByPickingId.set(pickId, []);
      movesByPickingId.get(pickId)!.push(m);
    }

    // ── Product catalog lookup by odooId ───────────────────────────────────
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

    // ── Batched UPSERT of deliveries ───────────────────────────────────────
    const deliveryIdByOdooId = new Map<number, number>();
    for (const batch of chunk(changed, WRITE_BATCH_SIZE)) {
      const values = batch.map(({ picking: p, saleId }) => {
        const locationName = p.location_id !== false ? p.location_id[1] : null;
        return {
          ventaId: saleId,
          odooId: p.id,
          nombre: p.name,
          estado: p.state,
          tipoOperacion: p.picking_type_id !== false ? p.picking_type_id[1] : null,
          almacenOrigen: locationName,
          almacenCodigo: locationToCode(locationName),
          fechaProgramada: parseOdooDatetime(p.scheduled_date),
          fechaEfectiva: parseOdooDatetime(p.date_done),
          documentoOrigen: p.origin !== false ? p.origin : null,
          backorderDeOdooId: p.backorder_id !== false ? p.backorder_id[0] : null,
          odooWriteDate: p.write_date,
          lastSyncAt: now,
          createdAt: now,
        };
      });
      const rows = await db
        .insert(deliveriesTable)
        .values(values)
        .onConflictDoUpdate({
          target: deliveriesTable.odooId,
          set: {
            ventaId: sql`excluded.venta_id`,
            nombre: sql`excluded.nombre`,
            estado: sql`excluded.estado`,
            tipoOperacion: sql`excluded.tipo_operacion`,
            almacenOrigen: sql`excluded.almacen_origen`,
            almacenCodigo: sql`excluded.almacen_codigo`,
            fechaProgramada: sql`excluded.fecha_programada`,
            fechaEfectiva: sql`excluded.fecha_efectiva`,
            documentoOrigen: sql`excluded.documento_origen`,
            backorderDeOdooId: sql`excluded.backorder_de_odoo_id`,
            odooWriteDate: sql`excluded.odoo_write_date`,
            lastSyncAt: sql`excluded.last_sync_at`,
          },
        })
        .returning({
          id: deliveriesTable.id,
          odooId: deliveriesTable.odooId,
          isNew: sql<boolean>`(xmax = 0)`,
        });
      for (const r of rows) {
        deliveryIdByOdooId.set(r.odooId, r.id);
        if (r.isNew) created++;
        else updated++;
      }
    }

    // ── Batched UPSERT of delivery items ───────────────────────────────────
    const itemValues = changed.flatMap(({ picking: p }) => {
      const deliveryId = deliveryIdByOdooId.get(p.id);
      if (deliveryId === undefined) return [];
      return (movesByPickingId.get(p.id) ?? []).map((move) => {
        const productOdooId = move.product_id !== false ? move.product_id[0] : null;
        return {
          deliveryId,
          productId:
            productOdooId !== null ? (catalogByOdooId.get(productOdooId) ?? null) : null,
          odooMoveId: move.id,
          descripcion: move.product_id !== false ? move.product_id[1] : "Producto desconocido",
          cantidadDemanda: move.product_uom_qty ?? 0,
          cantidadEntregada: move.quantity ?? 0,
          uom: move.product_uom !== false ? move.product_uom[1] : null,
          estado: move.state,
        };
      });
    });
    for (const batch of chunk(itemValues, WRITE_BATCH_SIZE)) {
      await db
        .insert(deliveryItemsTable)
        .values(batch)
        .onConflictDoUpdate({
          target: deliveryItemsTable.odooMoveId,
          set: {
            deliveryId: sql`excluded.delivery_id`,
            productId: sql`excluded.product_id`,
            descripcion: sql`excluded.descripcion`,
            cantidadDemanda: sql`excluded.cantidad_demanda`,
            cantidadEntregada: sql`excluded.cantidad_entregada`,
            uom: sql`excluded.uom`,
            estado: sql`excluded.estado`,
          },
        });
      itemsUpserted += batch.length;
    }

    // ── Delete local items whose stock.move no longer belongs to its picking ─
    const changedDeliveryIds = [...deliveryIdByOdooId.values()];
    const validMoveIds = changed.flatMap(({ picking }) => picking.move_ids);
    if (changedDeliveryIds.length > 0) {
      const removed = await db
        .delete(deliveryItemsTable)
        .where(
          and(
            inArray(deliveryItemsTable.deliveryId, changedDeliveryIds),
            validMoveIds.length > 0
              ? notInArray(deliveryItemsTable.odooMoveId, validMoveIds)
              : undefined,
          ),
        )
        .returning({ id: deliveryItemsTable.id });
      itemsDeleted = removed.length;
      if (itemsDeleted > 0) {
        logger.info({ itemsDeleted }, "Líneas de albarán eliminadas en Odoo — borradas localmente");
      }
    }

    // ── Alerts: albarán pasó a 'cancel' con despacho activo ────────────────
    const nowCancelled = changed.filter(
      ({ picking }) =>
        picking.state === "cancel" &&
        localByOdooId.get(picking.id)?.estado !== "cancel",
    );
    alertsCreated = await createCancelAlerts(nowCancelled);

    for (const { saleId } of changed) touchedSaleIds.add(saleId);
  }

  const syncResult: DeliverySyncResult = {
    created,
    updated,
    unchanged,
    itemsUpserted,
    itemsDeleted,
    deleted,
    alertsCreated,
    unmatched,
    total: remoteIdList.length,
  };

  // ── Derive estadoEntrega / almacenOrigen for all sales touched this run ──
  if (touchedSaleIds.size > 0) {
    await recomputeDeliveryDerivedState([...touchedSaleIds]);
  }

  await recordDeliverySyncResult(syncResult);
  logger.info({ syncResult }, "Sync de albaranes completado");
  return syncResult;
}
