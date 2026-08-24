import { asc, eq, inArray } from "drizzle-orm";
import {
  almacenesTable,
  db,
  personnelAlmacenesTable,
} from "@workspace/db";

export type PersonnelAlmacenAsignado = {
  id: number;
  codigo: string;
  odooPrefix: string;
  nombre: string;
  plaza: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  activo: boolean;
  createdAt: string;
};

/**
 * Hydrates personnel records in one query, avoiding an assignment query per row.
 */
export async function listarAlmacenesAgrupadosPorPersonal(
  personnelIds: number[],
): Promise<Map<number, PersonnelAlmacenAsignado[]>> {
  const grouped = new Map<number, PersonnelAlmacenAsignado[]>(
    personnelIds.map((personnelId) => [personnelId, []]),
  );
  if (personnelIds.length === 0) return grouped;

  const rows = await db
    .select({
      personnelId: personnelAlmacenesTable.personnelId,
      id: almacenesTable.id,
      codigo: almacenesTable.codigo,
      odooPrefix: almacenesTable.odooPrefix,
      nombre: almacenesTable.nombre,
      plaza: almacenesTable.plaza,
      direccion: almacenesTable.direccion,
      latitud: almacenesTable.latitud,
      longitud: almacenesTable.longitud,
      activo: almacenesTable.activo,
      createdAt: almacenesTable.createdAt,
    })
    .from(personnelAlmacenesTable)
    .innerJoin(
      almacenesTable,
      eq(personnelAlmacenesTable.almacenId, almacenesTable.id),
    )
    .where(inArray(personnelAlmacenesTable.personnelId, personnelIds))
    .orderBy(asc(almacenesTable.nombre));

  for (const row of rows) {
    grouped.get(row.personnelId)?.push({
      id: row.id,
      codigo: row.codigo,
      odooPrefix: row.odooPrefix,
      nombre: row.nombre,
      plaza: row.plaza,
      direccion: row.direccion,
      latitud: row.latitud,
      longitud: row.longitud,
      activo: row.activo,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return grouped;
}

export async function listarAlmacenesDePersonal(
  personnelId: number,
): Promise<PersonnelAlmacenAsignado[]> {
  return (await listarAlmacenesAgrupadosPorPersonal([personnelId])).get(
    personnelId,
  ) ?? [];
}

/**
 * Replaces the complete assignment set atomically. The caller validates that
 * the referenced person and warehouses exist before invoking this operation.
 */
export async function reemplazarAlmacenesDePersonal(
  personnelId: number,
  almacenIds: number[],
): Promise<void> {
  const uniqueAlmacenIds = [...new Set(almacenIds)];

  await db.transaction(async (tx) => {
    await tx
      .delete(personnelAlmacenesTable)
      .where(eq(personnelAlmacenesTable.personnelId, personnelId));

    if (uniqueAlmacenIds.length > 0) {
      await tx.insert(personnelAlmacenesTable).values(
        uniqueAlmacenIds.map((almacenId) => ({ personnelId, almacenId })),
      );
    }
  });
}