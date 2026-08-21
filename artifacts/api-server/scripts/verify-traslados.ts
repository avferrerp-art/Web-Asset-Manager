/**
 * Populate and verify the real internal-transfer mirror.
 *
 * Run from artifacts/api-server:
 *   node scripts/run-verify-traslados.mjs
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { backfillInternalTransfers, syncDeliveries } from "../src/services/deliverySync";

type CountRow = {
  traslados: number;
  deliveriesTraslado: number;
};

type ControlRow = {
  referencia: string;
  origenCodigo: string | null;
  origenNombre: string | null;
  destinoCodigo: string | null;
  destinoNombre: string | null;
};

const countsBefore = await db.execute<CountRow>(sql`
  SELECT
    (SELECT count(*)::int FROM traslados) AS "traslados",
    (SELECT count(*)::int FROM deliveries WHERE tipo = 'traslado') AS "deliveriesTraslado"
`);
const before = countsBefore.rows[0]!;
console.log("Conteos iniciales:", before);

if (before.traslados === 0 && before.deliveriesTraslado === 0) {
  console.log("Ejecutando sync incremental de movimientos...");
  console.log(await syncDeliveries());
  console.log("Ejecutando backfill histórico de traslados...");
  console.log(await backfillInternalTransfers());
}

const controls = await db.execute<ControlRow>(sql`
  SELECT
    d.nombre AS referencia,
    origen.codigo AS "origenCodigo",
    origen.nombre AS "origenNombre",
    destino.codigo AS "destinoCodigo",
    destino.nombre AS "destinoNombre"
  FROM traslados t
  JOIN deliveries d ON d.id = t.delivery_id
  LEFT JOIN almacenes origen ON origen.id = t.almacen_origen_id
  LEFT JOIN almacenes destino ON destino.id = t.almacen_destino_id
  WHERE d.nombre IN ('Urbin/INT/00001', 'Urbin/INT/00003', 'Urbin/INT/00014')
  ORDER BY d.nombre
`);

const expected = new Map([
  ["Urbin/INT/00001", ["URB", "LEC"]],
  ["Urbin/INT/00003", ["CCS", "LEC"]],
  ["Urbin/INT/00014", ["URB", "URB"]],
]);

for (const [referencia, [origenEsperado, destinoEsperado]] of expected) {
  const actual = controls.rows.find((row) => row.referencia === referencia);
  if (!actual) {
    throw new Error(`Traslado de control no encontrado: ${referencia}`);
  }
  if (
    actual.origenCodigo !== origenEsperado ||
    actual.destinoCodigo !== destinoEsperado
  ) {
    throw new Error(
      `Traslado de control ${referencia} resolvió ${actual.origenCodigo ?? "null"} → ${actual.destinoCodigo ?? "null"}; se esperaba ${origenEsperado} → ${destinoEsperado}`,
    );
  }
}
console.log("Casos de control:", controls.rows);

const summary = await db.execute(sql`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE d.estado = 'cancel')::int AS cancelados,
    count(*) FILTER (
      WHERE origen.plaza IS DISTINCT FROM destino.plaza
        AND origen.id IS NOT NULL
        AND destino.id IS NOT NULL
    )::int AS interplaza,
    count(*) FILTER (
      WHERE origen.plaza = destino.plaza
        AND origen.id IS NOT NULL
        AND destino.id IS NOT NULL
    )::int AS intraplaza,
    count(t.peso_calculado_kg)::int AS "conPeso",
    count(*) FILTER (
      WHERE t.peso_calculado_kg IS NULL
        AND t.peso_estimado_kg IS NOT NULL
    )::int AS "conPesoEstimado",
    count(*) FILTER (
      WHERE t.peso_calculado_kg IS NULL
        AND t.peso_estimado_kg IS NULL
    )::int AS "sinPeso",
    count(t.volumen_calculado_m3)::int AS "conVolumen"
  FROM traslados t
  LEFT JOIN deliveries d ON d.id = t.delivery_id
  LEFT JOIN almacenes origen ON origen.id = t.almacen_origen_id
  LEFT JOIN almacenes destino ON destino.id = t.almacen_destino_id
`);
console.log("Resumen real:", summary.rows[0]);
console.log("VERIFICACIÓN DE TRASLADOS COMPLETADA");
process.exit(0);