/**
 * Verificación visual — vehículo sugerido via fleet.ts (única fuente de verdad).
 * Flota REAL de la BD (05-ago-2026):
 *  - Silverado Chevrolet   950 kg / 2 m³
 *  - Mitshubishi Panel L300 1000 kg / 5.7 m³
 *  - Foton TM2             2000 kg / 7 m³
 *  - Iveco Daily           3500 kg / 12.5 m³
 *  - Mitsubishi FM 657 2   11000 kg / 28 m³
 * Venta real #762 (GRUPO CONNEXT): peso 0.96 kg, volumen sin dato.
 * Este componente ejecuta la MISMA lógica que los wizards (classifyFleet /
 * suggestedVehicle de fleet.ts + guarda sinDatoCarga) sobre esos datos reales.
 */
import { classifyFleet, suggestedVehicle } from "../../../../logistics/src/lib/fleet";
import { sinDatoCarga } from "../../../../logistics/src/lib/carga";

const fleet = [
  { id: 15, modelo: "Silverado Chevrolet", capacidadPeso: 950, capacidadVolumen: 2 },
  { id: 14, modelo: "Mitshubishi Panel L300", capacidadPeso: 1000, capacidadVolumen: 5.7 },
  { id: 13, modelo: "Foton TM2", capacidadPeso: 2000, capacidadVolumen: 7 },
  { id: 1, modelo: "Iveco Daily", capacidadPeso: 3500, capacidadVolumen: 12.5 },
  { id: 11, modelo: "Mitsubishi FM 657 2", capacidadPeso: 11000, capacidadVolumen: 28 },
];

function WizardSelect({ title, peso, volumen }: { title: string; peso: number | null; volumen: number | null }) {
  // Misma lógica que nuevo-despacho-wizard.tsx
  const best = sinDatoCarga(peso) ? null : suggestedVehicle(fleet, peso ?? 0, volumen ?? 0);
  const cls = sinDatoCarga(peso) ? null : classifyFleet(fleet, peso ?? 0, volumen ?? 0);
  const fit0 = cls?.fit[0] ?? null;
  const ninguno = cls != null && cls.fit.length === 0;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="border rounded-md px-3 py-2 bg-card">
        <span className="text-xs text-muted-foreground">Vehículo (select del wizard):</span>{" "}
        {best ? (
          <span className="font-medium">
            {best.modelo} — {best.capacidadPeso}kg — ⭐ SUGERIDO ({fit0!.maxPct.toFixed(0)}% uso)
          </span>
        ) : (
          <span className="italic text-muted-foreground">Seleccionar (sin preselección)</span>
        )}
      </div>
      {best && (
        <span className="inline-flex items-center rounded-full bg-primary text-primary-foreground text-[10px] px-2 py-0.5">
          ⭐ SUGERIDO · {fit0!.maxPct.toFixed(0)}% uso
        </span>
      )}
      {ninguno && (
        <div className="text-xs text-red-600 border border-red-500/40 bg-red-500/10 rounded-md px-3 py-2">
          ⚠ Ningún vehículo de la flota soporta esta carga. Considera dividir el envío.
        </div>
      )}
    </section>
  );
}

export default function VerifyVehiculoSugerido() {
  // (e) cargo-wizard: classifyFleet, fit primero (más ajustado → más holgado)
  const cw = classifyFleet(fleet, 900, 1.5);
  const ranked = [...cw.fit, ...cw.unfit];
  return (
    <div className="p-6 space-y-6 max-w-3xl text-sm">
      <h1 className="text-xl font-bold">Verificación: vehículo sugerido usa fleet.ts (flota real)</h1>

      <WizardSelect title="(a) Venta #762 — 0.96 kg (volumen sin dato)" peso={0.96} volumen={null} />
      <WizardSelect title="(b) Venta pesada — 1500 kg / 4 m³ (Silverado y L300 no la soportan)" peso={1500} volumen={4} />
      <WizardSelect title="(c) Venta que supera toda la flota — 20000 kg / 100 m³" peso={20000} volumen={100} />
      <WizardSelect title='(d) Venta con peso "sin dato en Odoo"' peso={null} volumen={null} />

      <section className="space-y-2">
        <h2 className="font-semibold">(e) Cargo wizard — 900 kg / 1.5 m³, el más ajustado primero</h2>
        {ranked.map((c, idx) => (
          <div key={c.vehicle.id} className={`border rounded-md px-3 py-2 flex justify-between ${idx === 0 ? "border-primary bg-primary/5" : ""}`}>
            <span>
              {c.vehicle.modelo} ({c.vehicle.capacidadPeso} kg / {c.vehicle.capacidadVolumen} m³)
              {c.isFit && idx === 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-primary text-primary-foreground text-[10px] px-2 py-0.5">
                  ⭐ SUGERIDO · {c.maxPct.toFixed(0)}% uso
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {c.isFit ? `${c.maxPct.toFixed(0)}% uso` : "no compatible"}
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Volumen sin dato en la venta → "sin dato en Odoo — no considerado" (texto conservado en el wizard real).
        </p>
      </section>
    </div>
  );
}
