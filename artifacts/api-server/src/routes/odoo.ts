import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, syncAlertsTable } from "@workspace/db";
import { getOdooConfig, OdooError } from "../lib/odooClient";
import {
  getSyncState,
  recordSyncError,
  syncOdooOrders,
  testOdooConnection,
} from "../services/odooSync";
import {
  syncDeliveries,
  recordDeliverySyncError,
} from "../services/deliverySync";
import { backfillSaleItemProducts } from "../services/productBackfill";
import { backfillDestinos } from "../services/destinoBackfill";
import { recomputeDeliveryDerivedState } from "../services/deliveryEstado";

const router: IRouter = Router();

router.get("/odoo/status", async (_req, res): Promise<void> => {
  const config = getOdooConfig();
  const state = await getSyncState();
  res.json({
    configured: config !== null,
    serverUrl: config?.url ?? null,
    lastSyncAt: state?.lastSyncAt ? state.lastSyncAt.toISOString() : null,
    lastResult: state?.lastResult ?? null,
    lastError: state?.lastError ?? null,
    importedCount: state?.importedCount ?? 0,
    skippedCount: state?.skippedCount ?? 0,
    lastDeliveriesSyncAt: state?.lastDeliveriesSyncAt
      ? state.lastDeliveriesSyncAt.toISOString()
      : null,
    lastDeliveriesResult: state?.lastDeliveriesResult ?? null,
    lastDeliveriesError: state?.lastDeliveriesError ?? null,
    deliveriesCreatedCount: state?.deliveriesCreatedCount ?? 0,
    deliveriesUpdatedCount: state?.deliveriesUpdatedCount ?? 0,
  });
});

router.post("/odoo/test-connection", async (req, res): Promise<void> => {
  try {
    const { uid, url } = await testOdooConnection();
    res.json({ ok: true, uid, url, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.warn({ err }, "Odoo test connection failed");
    res.status(err instanceof OdooError ? 400 : 500).json({
      ok: false,
      uid: null,
      url: getOdooConfig()?.url ?? null,
      error: message,
    });
  }
});

router.post("/odoo/sync", async (req, res): Promise<void> => {
  const dryRun = String(req.query["dryRun"] ?? "") === "true";
  try {
    const result = await syncOdooOrders({ dryRun });
    res.json({
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      orders: result.orders,
      updated: result.updated,
      changes: result.changes,
      alertsCreated: result.alertsCreated,
      dryRun: result.dryRun,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Odoo manual sync failed");
    if (!dryRun) await recordSyncError(message).catch(() => {});
    res.status(err instanceof OdooError ? 400 : 500).json({
      ok: false,
      imported: 0,
      skipped: 0,
      orders: [],
      updated: [],
      changes: [],
      alertsCreated: 0,
      dryRun,
      error: message,
    });
  }
});

router.get("/odoo/alerts", async (req, res): Promise<void> => {
  const includeResolved = String(req.query["includeResolved"] ?? "") === "true";
  const rows = await db
    .select()
    .from(syncAlertsTable)
    .where(includeResolved ? undefined : eq(syncAlertsTable.resuelta, false))
    .orderBy(desc(syncAlertsTable.createdAt));
  res.json(
    rows.map((a) => ({
      id: a.id,
      ventaId: a.ventaId,
      odooId: a.odooId,
      odooRef: a.odooRef,
      estado: a.estado,
      mensaje: a.mensaje,
      campos: a.campos,
      resuelta: a.resuelta,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    })),
  );
});

router.post("/odoo/alerts/:id/resolve", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const [updated] = await db
    .update(syncAlertsTable)
    .set({ resuelta: true, resolvedAt: new Date() })
    .where(eq(syncAlertsTable.id, id))
    .returning({ id: syncAlertsTable.id });
  if (!updated) {
    res.status(404).json({ error: "Alerta no encontrada" });
    return;
  }
  res.json({ ok: true, id: updated.id });
});

router.post("/odoo/sync-deliveries", async (req, res): Promise<void> => {
  try {
    const result = await syncDeliveries();
    res.json({
      ok: true,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      itemsUpserted: result.itemsUpserted,
      itemsDeleted: result.itemsDeleted,
      deleted: result.deleted,
      alertsCreated: result.alertsCreated,
      unmatched: result.unmatched,
      total: result.total,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Delivery sync failed");
    await recordDeliverySyncError(message).catch(() => {});
    res.status(err instanceof OdooError ? 400 : 500).json({
      ok: false,
      created: 0,
      updated: 0,
      unchanged: 0,
      itemsUpserted: 0,
      itemsDeleted: 0,
      deleted: 0,
      alertsCreated: 0,
      unmatched: 0,
      total: 0,
      error: message,
    });
  }
});

router.post("/odoo/backfill-products", async (req, res): Promise<void> => {
  try {
    const result = await backfillSaleItemProducts();
    res.json({
      ok: true,
      examined: result.examined,
      linked: result.linked,
      dimensionsUpdated: result.dimensionsUpdated,
      unmatched: result.unmatched,
      salesRecalculated: result.salesRecalculated,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Product backfill failed");
    res.status(500).json({
      ok: false,
      examined: 0,
      linked: 0,
      unmatched: 0,
      salesFlagUpdated: 0,
      error: message,
    });
  }
});

router.post("/odoo/backfill-deliveries", async (req, res): Promise<void> => {
  try {
    const result = await recomputeDeliveryDerivedState();
    res.json({ ok: true, ...result, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Delivery backfill failed");
    res.status(500).json({
      ok: false,
      examined: 0,
      updated: 0,
      distribution: {},
      error: message,
    });
  }
});

router.post("/odoo/backfill-destinos", async (req, res): Promise<void> => {
  try {
    const result = await backfillDestinos();
    res.json({ ok: true, ...result, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Destino backfill failed");
    res.status(err instanceof OdooError ? 400 : 500).json({
      ok: false,
      examined: 0,
      updated: 0,
      realAddress: 0,
      porDefinir: 0,
      unchanged: 0,
      missingInOdoo: 0,
      error: message,
    });
  }
});

export default router;
