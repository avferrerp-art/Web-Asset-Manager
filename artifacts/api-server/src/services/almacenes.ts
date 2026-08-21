import { eq } from "drizzle-orm";
import { almacenesTable, db, type Almacen } from "@workspace/db";

export type CatalogoAlmacenes = ReadonlyMap<string, Almacen>;
export type ResolverAlmacen = (
  location: string | null | undefined,
) => Almacen | null;

let catalogoActivoPromise: Promise<CatalogoAlmacenes> | null = null;

async function consultarCatalogoAlmacenesActivos(): Promise<CatalogoAlmacenes> {
  const almacenes = await db
    .select()
    .from(almacenesTable)
    .where(eq(almacenesTable.activo, true));
  return new Map(almacenes.map((almacen) => [almacen.odooPrefix, almacen]));
}

/**
 * Loads the small active catalog once and reuses it for location resolution.
 * A sync run can request a refresh at its start and keep using the returned Map.
 */
export function cargarCatalogoAlmacenesActivos(
  refrescar = false,
): Promise<CatalogoAlmacenes> {
  if (refrescar || !catalogoActivoPromise) {
    catalogoActivoPromise = consultarCatalogoAlmacenesActivos().catch(
      (error) => {
        catalogoActivoPromise = null;
        throw error;
      },
    );
  }
  return catalogoActivoPromise;
}

function resolverDesdeCatalogo(catalogo: CatalogoAlmacenes): ResolverAlmacen {
  return (location) => {
    if (!location) return null;

    const slashIndex = location.indexOf("/");
    if (slashIndex <= 0) return null;

    return catalogo.get(location.slice(0, slashIndex)) ?? null;
  };
}

/**
 * Creates one in-memory resolver per sync run. Origin and destination lookups
 * then require no additional database round-trips.
 */
export async function crearResolverAlmacenes(): Promise<ResolverAlmacen> {
  const catalogo = await cargarCatalogoAlmacenesActivos(true);
  return resolverDesdeCatalogo(catalogo);
}

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
  const catalogo = await cargarCatalogoAlmacenesActivos();
  return resolverDesdeCatalogo(catalogo)(location);
}