// Adds derived delivery-state columns to sales:
// - estado_entrega: derived from albaranes (deliveries) — SEPARATE from the
//   internal sales.estado which is derived from dispatches (saleEstadoSync).
// - almacen_origen: warehouse of the most recent non-cancelled albarán.
// - almacenes_multiples: true when active albaranes span more than one warehouse.
// Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run.
export const name = "0004_sales_estado_entrega";

export const sql = `
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "estado_entrega" text NOT NULL DEFAULT 'sin_albaran';
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "almacen_origen" text;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "almacenes_multiples" boolean NOT NULL DEFAULT false;
`;
