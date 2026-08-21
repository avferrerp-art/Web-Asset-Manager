import React from "react";
import {
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  Package,
  Truck,
  User,
  X,
} from "lucide-react";

const offsets = ["Ahora", "Hace 30 min", "Hace 1 h", "Hace 2 h"];

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[18px_108px_1fr] items-center gap-2 py-2 text-sm">
      <Icon className="h-4 w-4 text-slate-400" />
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-100">{value}</span>
    </div>
  );
}

export default function ChoferEntregaPreview() {
  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto w-[390px] overflow-hidden rounded-[32px] border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="relative h-[820px]">
          <header className="flex h-16 items-center border-b border-slate-800 px-5">
            <span className="text-lg font-semibold">Despacho #184</span>
          </header>

          <main className="space-y-4 p-4">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h1 className="text-lg font-bold">Despacho #184</h1>
                <span className="rounded-md bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
                  En ruta
                </span>
              </div>
              <InfoRow icon={User} label="Cliente" value="Distribuidora Oriente" />
              <InfoRow icon={MapPin} label="Destino" value="Almacén Urbina" />
              <InfoRow icon={Truck} label="Vehículo" value="Ford Cargo 1722" />
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 font-semibold">Carga</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-950 p-3 text-center">
                  <Package className="mx-auto mb-2 h-5 w-5 text-sky-400" />
                  <div className="font-bold">4.280 kg</div>
                  <div className="text-xs text-slate-400">Peso total</div>
                </div>
                <div className="rounded-lg bg-slate-950 p-3 text-center">
                  <Navigation className="mx-auto mb-2 h-5 w-5 text-sky-400" />
                  <div className="font-bold">238 km</div>
                  <div className="text-xs text-slate-400">Distancia</div>
                </div>
              </div>
            </section>
          </main>

          <div className="absolute inset-0 flex items-end bg-black/65">
            <section className="w-full rounded-t-[24px] border-t border-slate-700 bg-slate-950 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <h2 className="text-xl font-semibold">Confirmar entrega</h2>
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="rounded-full p-2 text-slate-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <label className="mb-2 block text-sm font-semibold">
                    Hora de llegada
                  </label>
                  <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
                    <Clock3 className="h-5 w-5 text-sky-400" />
                    <span className="font-medium">hoy, 4:45 p. m.</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {offsets.map((offset, index) => (
                    <button
                      key={offset}
                      type="button"
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${
                        index === 0
                          ? "border-sky-500 bg-sky-500/15 text-sky-300"
                          : "border-slate-700 bg-slate-900 text-slate-200"
                      }`}
                    >
                      {offset}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold">
                    Novedades del viaje <span className="font-normal text-slate-400">(opcional)</span>
                  </label>
                  <div className="min-h-24 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-500">
                    ¿Alguna novedad del viaje?
                  </div>
                </div>

                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 font-semibold text-white"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  Confirmar entrega
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}