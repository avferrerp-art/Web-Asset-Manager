/**
 * Verificación visual — eliminación del módulo de dimensiones manuales.
 * Datos REALES de la DB (05-ago-2026) y resultados reales de classifyFleet
 * (misma lógica de artifacts/logistics/src/lib/fleet.ts, sin modificar).
 */
import { classifyFleet } from "../../lib/fleet-copy";

const VEHICLES = [
  { id: 15, modelo: "Silverado Chevrolet", capacidadPeso: 950, capacidadVolumen: 2 },
  { id: 14, modelo: "Mitshubishi Panel L300", capacidadPeso: 1000, capacidadVolumen: 5.7 },
  { id: 13, modelo: "Foton TM2", capacidadPeso: 2000, capacidadVolumen: 7 },
  { id: 1, modelo: "Iveco Daily", capacidadPeso: 3500, capacidadVolumen: 12.5 },
  { id: 11, modelo: "Mitsubishi FM 657 2", capacidadPeso: 11000, capacidadVolumen: 28 },
];

const SALES = [
  { id: 758, cliente: "PLATINIUM SYSTEM CABLE, C.A.", peso: 167.4 as number | null, vol: 0.67 as number | null },
  { id: 760, cliente: "DATALINK, C.A.", peso: 1440 as number | null, vol: null as number | null },
  { id: 761, cliente: "DATALINK, C.A.", peso: null as number | null, vol: null as number | null },
];

function SinDato() {
  return <span className="italic text-xs text-muted-foreground">sin dato en Odoo</span>;
}

function Calc({ title, peso, vol }: { title: string; peso: number | null; vol: number | null }) {
  const { fit } = classifyFleet(VEHICLES, peso ?? 0, vol ?? 0);
  const sugerido = fit[0];
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground">
        Peso: {peso != null ? `${peso} kg` : "sin dato en Odoo"} · Volumen: {vol != null ? `${vol} m³` : "sin dato en Odoo"}
      </p>
      {vol == null && peso != null && (
        <div className="text-xs bg-yellow-500/10 border border-yellow-500/40 rounded px-3 py-2">
          ⚠ <strong>Recomendación incompleta:</strong> la venta no tiene volumen en Odoo, así que la
          recomendación considera <strong>solo el peso</strong>.
        </div>
      )}
      {sugerido ? (
        <div className="border border-primary bg-primary/5 rounded px-3 py-2 text-sm">
          <strong>SUGERIDO:</strong> {sugerido.vehicle.modelo} — peso {sugerido.weightPct.toFixed(0)}%
          {vol != null ? `, volumen ${sugerido.volPct.toFixed(0)}%` : ", volumen no considerado"}
        </div>
      ) : (
        <div className="text-sm text-red-500">Ningún vehículo compatible.</div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Descartados: {VEHICLES.filter(v => !fit.some(f => f.vehicle.id === v.id)).map(v => v.modelo).join(", ") || "ninguno"}
      </p>
    </div>
  );
}

export default function DimensionesVerificacion() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold">Verificación — peso/volumen SIEMPRE desde Odoo</h1>

      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/50 text-sm font-semibold">Lista de Ventas (celda de carga real)</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-2">Orden</th><th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Peso</th><th className="px-4 py-2">Volumen</th>
            </tr>
          </thead>
          <tbody>
            {SALES.map(s => (
              <tr key={s.id} className="border-b">
                <td className="px-4 py-2">#{s.id}</td>
                <td className="px-4 py-2">{s.cliente}</td>
                <td className="px-4 py-2">{s.peso != null ? `${s.peso} kg` : <SinDato />}</td>
                <td className="px-4 py-2">{s.vol != null ? `${s.vol} m³` : <SinDato />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Calc title="Calculadora — venta #758 con peso y volumen de Odoo" peso={167.4} vol={0.67} />
      <Calc title="Calculadora — venta #760 con peso pero SIN volumen (recomendación incompleta)" peso={1440} vol={null} />
    </div>
  );
}
