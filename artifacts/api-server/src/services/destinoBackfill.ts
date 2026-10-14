import { eq, isNotNull, inArray } from "drizzle-orm";
import { db, salesTable } from "@workspace/db";
import { authenticate, executeKw, getOdooConfig, OdooError, type OdooConfig } from "../lib/odooClient";
import { buildDestino, readPartners, type OdooPartner } from "./odooSync";
import { logger } from "../lib/logger";

export interface DestinoBackfillResult {
  examined: number;
  updated: number;
  realAddress: number;
  porDefinir: number;
  unchanged: number;
  missingInOdoo: number;
}

interface OdooOrderShipping {
  id: number;
  partner_shipping_id: [number, string] | false;
}

/**
 * Re-reads shipping partners of already-imported Odoo orders and updates ONLY
 * their `destino`. Never touches items, pesoTotalOdoo or volumenTotalOdoo.
 * Idempotent: re-running produces the same result.
 */
export async function backfillDestinos(): Promise<DestinoBackfillResult> {
  const config = getOdooConfig();
  if (!config) {
    throw new OdooError(
      "Conexión Odoo no configurada: faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_API_KEY.",
    );
  }
  const uid = await authenticate(config);

  const sales = await db
    .select({ id: salesTable.id, odooId: salesTable.odooId, destino: salesTable.destino })
    .from(salesTable)
    .where(isNotNull(salesTable.odooId));

  const result: DestinoBackfillResult = {
    examined: sales.length,
    updated: 0,
    realAddress: 0,
    porDefinir: 0,
    unchanged: 0,
    missingInOdoo: 0,
  };
  if (sales.length === 0) return result;

  // Fetch partner_shipping_id for all orders in batches
  const odooIds = sales.map((s) => s.odooId as number);
  const orderById = new Map<number, OdooOrderShipping>();
  for (let i = 0; i < odooIds.length; i += 200) {
    const chunk = odooIds.slice(i, i + 200);
    const orders = (await executeKw(config, uid, "sale.order", "read", [chunk], {
      fields: ["partner_shipping_id"],
    })) as OdooOrderShipping[];
    for (const o of orders) orderById.set(o.id, o);
  }

  // Fetch all shipping partners
  const partnerIds = [
    ...new Set(
      [...orderById.values()]
        .filter((o) => o.partner_shipping_id)
        .map((o) => (o.partner_shipping_id as [number, string])[0]),
    ),
  ];
  const partnerById = new Map<number, OdooPartner>();
  for (let i = 0; i < partnerIds.length; i += 200) {
    const chunk = partnerIds.slice(i, i + 200);
    const partners = await readPartners(config, uid, chunk);
    for (const p of partners) partnerById.set(p.id, p);
  }

  for (const sale of sales) {
    const order = orderById.get(sale.odooId as number);
    if (!order) {
      result.missingInOdoo++;
      continue;
    }
    const partner = order.partner_shipping_id
      ? partnerById.get(order.partner_shipping_id[0])
      : undefined;
    const destino = buildDestino(partner) ?? "Por definir";
    if (destino === "Por definir") result.porDefinir++;
    else result.realAddress++;

    if (destino === sale.destino) {
      result.unchanged++;
      continue;
    }
    await db.update(salesTable).set({ destino }).where(eq(salesTable.id, sale.id));
    result.updated++;
  }

  logger.info({ result }, "Destino backfill completed");
  return result;
}
