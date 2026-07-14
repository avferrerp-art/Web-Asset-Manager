import { Router, type IRouter } from "express";
import { getOdooConfig, OdooError } from "../lib/odooClient";
import {
  getSyncState,
  recordSyncError,
  syncOdooOrders,
  testOdooConnection,
} from "../services/odooSync";

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
  try {
    const result = await syncOdooOrders();
    res.json({
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      orders: result.orders,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Odoo manual sync failed");
    await recordSyncError(message).catch(() => {});
    res.status(err instanceof OdooError ? 400 : 500).json({
      ok: false,
      imported: 0,
      skipped: 0,
      orders: [],
      error: message,
    });
  }
});

export default router;
