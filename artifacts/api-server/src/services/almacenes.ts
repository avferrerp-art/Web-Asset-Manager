import { eq } from "drizzle-orm";
import { almacenesTable, db, type Almacen } from "@workspace/db";

/**
 * Resolves a complete Odoo location name to a canonical warehouse.
 *
 * Odoo's first segment is an exact catalog key: "Urbin/Existencias" resolves
 * to the row whose odooPrefix is literally "Urbin". Unknown locations are not
 * persisted so the catalog remains intentionally curated.
 */
export async function resolveAlmacenPorLocation(
  location: string | null | undefined,
): Promise<Almacen | null> {
  if (!location) return null;

  const slashIndex = location.indexOf("/");
  if (slashIndex <= 0) return null;

  const odooPrefix = location.slice(0, slashIndex);
  const [almacen] = await db
    .select()
    .from(almacenesTable)
    .where(eq(almacenesTable.odooPrefix, odooPrefix))
    .limit(1);

  return almacen ?? null;
}