import { Check, Plus, Trash2, Truck } from "lucide-react";

const rows = [
  {
    vehicle: "Mitsubishi FM 657 2 · A12BC3D",
    driver: "Carlos Méndez",
    weight: "2.800",
    volume: "18",
    window: "01 sep, 05:42 p. m. → 02 sep, 05:42 p. m.",
  },
  {
    vehicle: "Iveco Daily · B45DE6F",
    driver: "María González",
    weight: "1.670",
    volume: "12,5",
    window: "01 sep, 05:42 p. m. → 02 sep, 05:42 p. m.",
  },
];

export function PlanRepartoEditable() {
  return (
    <main className="min-h-screen bg-muted/40 p-8 text-foreground">
      <section className="mx-auto max-w-5xl rounded-xl border bg-background shadow-xl">
        <header className="border-b px-6 py-5">
          <h1 className="text-xl font-semibold">Planificar Carga</h1>
          <div className="mt-4 flex items-center gap-3 text-xs font-medium">
            <span className="rounded-full bg-primary px-3 py-1 text-primary-foreground">1 Orden</span>
            <span className="h-px flex-1 bg-primary" />
            <span className="rounded-full bg-primary px-3 py-1 text-primary-foreground">2 Partidas</span>
            <span className="h-px flex-1 bg-primary" />
            <span className="rounded-full bg-primary/15 px-3 py-1 text-primary">3 Flota</span>
          </div>
        </header>

        <div className="space-y-4 p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">Sugerir flota simultánea</button>
            <button className="rounded-md border bg-background px-4 py-2.5 text-sm font-medium">Sugerir viajes sucesivos</button>
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Plan de reparto editable</h2>
                <p className="text-xs text-muted-foreground">Los camiones salen en la misma ventana.</p>
              </div>
              <span className="rounded-md border px-2.5 py-1 text-xs font-medium">Flota simultánea</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Peso asignado</p>
                <p className="font-semibold">4.470 / 4.470 kg</p>
                <p className="text-xs text-green-600">Cobertura completa</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Volumen asignado</p>
                <p className="font-semibold">30,5 / 30,5 m³</p>
                <p className="text-xs text-green-600">Cobertura completa</p>
              </div>
            </div>

            <div className="space-y-3">
              {rows.map((row, index) => (
                <article key={row.vehicle} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-medium"><Truck className="h-4 w-4 text-primary" /> Camión {index + 1}</p>
                    <button aria-label="Eliminar camión" className="rounded-md p-2 text-muted-foreground"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border bg-background px-3 py-2 text-sm">{row.vehicle}</div>
                    <div className="rounded-md border bg-background px-3 py-2 text-sm">{row.driver}</div>
                    <div className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"><span className="text-foreground">{row.weight}</span> kg</div>
                    <div className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"><span className="text-foreground">{row.volume}</span> m³</div>
                  </div>
                  <p className="text-xs text-muted-foreground">{row.window}</p>
                </article>
              ))}
            </div>

            <button className="flex w-full items-center justify-center rounded-md border py-2 text-sm font-medium"><Plus className="mr-2 h-4 w-4" /> Agregar camión</button>
            <button className="flex w-full items-center justify-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground"><Check className="mr-2 h-4 w-4" /> Crear 2 despachos</button>
          </div>
        </div>
      </section>
    </main>
  );
}