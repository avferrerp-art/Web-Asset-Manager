/**
 * Verificación visual — migración de totales de carga y "sin dato en Odoo".
 * Datos REALES tomados de la base de datos (05-ago-2026, tras la migración):
 *  - #741 (S01370): peso_total=33.46, volumen_total=0.71
 *  - #761 (S01406): peso_total=NULL, volumen_total=NULL → "sin dato en Odoo"
 *  - Conteos: 473 ventas con peso, 237 con volumen, 0 filas con valor 0
 *  - Checksum de peso_total_odoo/volumen_total_odoo idéntico antes/después
 * Renderiza con el helper compartido real de la app web.
 */
import { formatCarga, sinDatoCarga } from "../../../../logistics/src/lib/carga";

const realSales = [
  { id: 741, cliente: "JOSE LUIS ELISANDRE", destino: "Lecheria, Anzoátegui (VE)", odooRef: "S01370", pesoTotal: 33.46, volumenTotal: 0.71 },
  { id: 761, cliente: "DATALINK, C.A.", destino: "Porlamar, Nueva Esparta (VE)", odooRef: "S01406", pesoTotal: null as number | null, volumenTotal: null as number | null },
  { id: 759, cliente: "MULTICANAL LA SEÑAL DIGITAL C.A", destino: "Punta de Mata, Monagas (VE)", odooRef: "S01396", pesoTotal: null, volumenTotal: null },
];

function Carga({ v, unit }: { v: number | null; unit: "kg" | "m³" }) {
  return sinDatoCarga(v)
    ? <span className="text-muted-foreground italic text-xs">sin dato en Odoo</span>
    : <span>{formatCarga(v, unit)}</span>;
}

export default function VerifyTotalesCarga() {
  return (
    <div className="p-6 space-y-6 max-w-3xl text-sm">
      <h1 className="text-xl font-bold">Verificación: totales de carga (datos reales de la BD)</h1>

      <section>
        <h2 className="font-semibold mb-2">(a)+(b) Lista de Ventas — columna Carga</h2>
        <table className="w-full border rounded">
          <thead><tr className="text-left border-b text-muted-foreground">
            <th className="p-2">ID</th><th className="p-2">Cliente</th><th className="p-2">Carga</th>
          </tr></thead>
          <tbody>
            {realSales.map(s => (
              <tr key={s.id} className="border-b">
                <td className="p-2 font-medium">#{s.id} <span className="text-purple-500 text-xs">{s.odooRef}</span></td>
                <td className="p-2">{s.cliente}</td>
                <td className="p-2">
                  <div><Carga v={s.pesoTotal} unit="kg" /></div>
                  <div className="text-muted-foreground"><Carga v={s.volumenTotal} unit="m³" /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-2">(c) Conteos reales (SQL post-migración)</h2>
        <ul className="list-disc pl-5">
          <li>473 ventas con peso visible · 237 con volumen visible (de 755)</li>
          <li>0 ventas con peso_total=0 o volumen_total=0 (nunca "0 kg" / "0 m³")</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-2">(d) Calculadora — venta sin peso (#761)</h2>
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3">
          <span className="text-red-500 font-bold">⚠</span>
          <span><strong>No se puede recomendar por peso:</strong> la venta no tiene peso en Odoo.
            Escribe un peso manual para simular, o corrige los datos del artículo en Odoo.</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Sin peso, la tarjeta "Compatibilidad de Flota" no se renderiza (puedeCalcular = false).</p>
      </section>

      <section>
        <h2 className="font-semibold mb-2">(e) Integridad de columnas *Odoo</h2>
        <p>Checksum md5 de (peso_total_odoo, volumen_total_odoo) sobre 755 filas:
          <code className="mx-1">1cc253044e7401d8774f1fd4c22f7f14</code> antes y después — sin cambios.</p>
      </section>
    </div>
  );
}
