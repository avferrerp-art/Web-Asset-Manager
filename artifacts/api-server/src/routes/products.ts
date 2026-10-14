import { Router, type IRouter } from "express";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import {
  ListProductsQueryParams,
  GetProductParams,
  UpdateProductParams,
  UpdateProductBody,
} from "@workspace/api-zod";
import { OdooError } from "../lib/odooClient";
import {
  getProductStats,
  recordProductSyncError,
  syncOdooProducts,
} from "../services/productSync";

const router: IRouter = Router();

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { search, sinPesoOdoo } = parsed.data;

  const conditions = [];
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(
      or(ilike(productsTable.nombre, term), ilike(productsTable.odooRef, term)),
    );
  }
  if (sinPesoOdoo) {
    conditions.push(isNull(productsTable.pesoOdoo));
  }

  const products = await db
    .select()
    .from(productsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(productsTable.nombre);
  res.json(products);
});

router.get("/products/stats", async (_req, res): Promise<void> => {
  res.json(await getProductStats());
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, params.data.id));
  if (!product) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(product);
});

// Catálogo de solo lectura desde Odoo: el único campo editable es `notas`.
router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [product] = await db
    .update(productsTable)
    .set(parsed.data)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(product);
});

router.post("/odoo/sync-products", async (req, res): Promise<void> => {
  try {
    const result = await syncOdooProducts();
    res.json({
      ok: true,
      created: result.created,
      updated: result.updated,
      total: result.total,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Odoo product sync failed");
    await recordProductSyncError(message).catch(() => {});
    res.status(err instanceof OdooError ? 400 : 500).json({
      ok: false,
      created: 0,
      updated: 0,
      total: 0,
      error: message,
    });
  }
});

export default router;
