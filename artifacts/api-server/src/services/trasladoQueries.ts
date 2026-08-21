import {
  almacenesTable,
  db,
  deliveriesTable,
  deliveryItemsTable,
  productsTable,
  trasladosTable,
} from "@workspace/db";
import { and, count, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export type TrasladoFilters = {
  almacenOrigenId?: number;
  almacenDestinoId?: number;
  estadoLogistico?: string;
  estadoOdoo?: string;
  search?: string;
};

const origenTable = alias(almacenesTable, "traslado_origen");
const destinoTable = alias(almacenesTable, "traslado_destino");

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function searchable(column: SQL | AnyColumn): SQL<string> {
  return sql<string>`translate(
    lower(coalesce(${column}, '')),
    'áàäâãåéèëêíìïîóòöôõúùüûñç',
    'aaaaaaeeeeiiiiooooouuuunc'
  )`;
}

function warehouse(
  id: number | null,
  codigo: string | null,
  nombre: string | null,
  plaza: string | null,
) {
  return id !== null && codigo !== null && nombre !== null && plaza !== null
    ? { id, codigo, nombre, plaza }
    : null;
}

async function selectTraslados(filters: TrasladoFilters, id?: number) {
  const conditions: SQL[] = [];
  if (id !== undefined) conditions.push(eq(trasladosTable.id, id));
  if (filters.almacenOrigenId !== undefined) {
    conditions.push(eq(trasladosTable.almacenOrigenId, filters.almacenOrigenId));
  }
  if (filters.almacenDestinoId !== undefined) {
    conditions.push(eq(trasladosTable.almacenDestinoId, filters.almacenDestinoId));
  }
  if (filters.estadoLogistico) {
    conditions.push(eq(trasladosTable.estadoLogistico, filters.estadoLogistico));
  }
  if (filters.estadoOdoo) {
    conditions.push(eq(deliveriesTable.estado, filters.estadoOdoo));
  }
  const normalizedSearch = filters.search ? normalizeSearch(filters.search) : "";
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`;
    conditions.push(sql`(
      ${searchable(deliveriesTable.nombre)} LIKE ${pattern}
      OR ${searchable(origenTable.nombre)} LIKE ${pattern}
      OR ${searchable(destinoTable.nombre)} LIKE ${pattern}
      OR ${searchable(origenTable.codigo)} LIKE ${pattern}
      OR ${searchable(destinoTable.codigo)} LIKE ${pattern}
    )`);
  }

  return db
    .select({
      id: trasladosTable.id,
      deliveryId: trasladosTable.deliveryId,
      referencia: deliveriesTable.nombre,
      origenId: origenTable.id,
      origenCodigo: origenTable.codigo,
      origenNombre: origenTable.nombre,
      origenPlaza: origenTable.plaza,
      destinoId: destinoTable.id,
      destinoCodigo: destinoTable.codigo,
      destinoNombre: destinoTable.nombre,
      destinoPlaza: destinoTable.plaza,
      fechaProgramada: deliveriesTable.fechaProgramada,
      fechaEfectiva: deliveriesTable.fechaEfectiva,
      estadoOdoo: deliveriesTable.estado,
      estadoLogistico: trasladosTable.estadoLogistico,
      cantidadLineas: count(deliveryItemsTable.id),
      pesoCalculadoKg: trasladosTable.pesoCalculadoKg,
      volumenCalculadoM3: trasladosTable.volumenCalculadoM3,
    })
    .from(trasladosTable)
    .leftJoin(deliveriesTable, eq(deliveriesTable.id, trasladosTable.deliveryId))
    .leftJoin(origenTable, eq(origenTable.id, trasladosTable.almacenOrigenId))
    .leftJoin(destinoTable, eq(destinoTable.id, trasladosTable.almacenDestinoId))
    .leftJoin(deliveryItemsTable, eq(deliveryItemsTable.deliveryId, deliveriesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(
      trasladosTable.id,
      deliveriesTable.id,
      origenTable.id,
      destinoTable.id,
    )
    .orderBy(sql`${deliveriesTable.fechaProgramada} DESC NULLS LAST`, desc(trasladosTable.id));
}

function toSummary(row: Awaited<ReturnType<typeof selectTraslados>>[number]) {
  const almacenOrigen = warehouse(
    row.origenId,
    row.origenCodigo,
    row.origenNombre,
    row.origenPlaza,
  );
  const almacenDestino = warehouse(
    row.destinoId,
    row.destinoCodigo,
    row.destinoNombre,
    row.destinoPlaza,
  );

  return {
    id: row.id,
    referencia: row.referencia,
    almacenOrigen,
    almacenDestino,
    cruzaPlaza:
      almacenOrigen !== null &&
      almacenDestino !== null &&
      almacenOrigen.plaza !== almacenDestino.plaza,
    mismoAlmacen:
      almacenOrigen !== null &&
      almacenDestino !== null &&
      almacenOrigen.id === almacenDestino.id,
    fechaProgramada: row.fechaProgramada?.toISOString() ?? null,
    fechaEfectiva: row.fechaEfectiva?.toISOString() ?? null,
    estadoOdoo: row.estadoOdoo,
    estadoLogistico: row.estadoLogistico,
    cantidadLineas: Number(row.cantidadLineas),
    pesoCalculadoKg: row.pesoCalculadoKg,
    volumenCalculadoM3: row.volumenCalculadoM3,
  };
}

export async function listTraslados(filters: TrasladoFilters = {}) {
  return (await selectTraslados(filters)).map(toSummary);
}

export async function getTraslado(id: number) {
  const [row] = await selectTraslados({}, id);
  if (!row) return null;

  const lineas =
    row.deliveryId === null
      ? []
      : await db
          .select({
            productoId: deliveryItemsTable.productId,
            codigo: productsTable.odooRef,
            descripcion: deliveryItemsTable.descripcion,
            demanda: deliveryItemsTable.cantidadDemanda,
            cantidad: deliveryItemsTable.cantidadEntregada,
            unidad: deliveryItemsTable.uom,
          })
          .from(deliveryItemsTable)
          .leftJoin(productsTable, eq(productsTable.id, deliveryItemsTable.productId))
          .where(eq(deliveryItemsTable.deliveryId, row.deliveryId))
          .orderBy(deliveryItemsTable.id);

  return {
    ...toSummary(row),
    lineas: lineas.map((linea) => ({
      ...linea,
      diferencia: linea.demanda - linea.cantidad,
    })),
  };
}