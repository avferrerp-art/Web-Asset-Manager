import React, { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetActiveDispatches,
  getGetActiveDispatchesQueryKey,
  useGetVehicleSchedule,
  getGetVehicleScheduleQueryKey,
} from "@workspace/api-client-react";
import { Truck, AlertCircle, CheckCircle2, MapPin, ChevronLeft, ChevronRight, RefreshCw, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NuevoDespachoWizard } from "@/components/nuevo-despacho-wizard";

function getWeekStart(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

const ESTADO_COLOR: Record<string, string> = {
  "pre-despacho": "bg-yellow-500/80",
  "aprobado":     "bg-blue-500/80",
  "en-ruta":      "bg-indigo-500/80",
  "entregado":    "bg-green-500/80",
  "cancelado":    "bg-red-500/80",
};

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [gpsDispatch, setGpsDispatch] = useState<any>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const weekStart = getWeekStart(weekOffset);

  const { data: summary, isLoading: isLoadingSummary, dataUpdatedAt } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const { data: activeDispatches, isLoading: isLoadingDispatches } = useGetActiveDispatches({
    query: {
      queryKey: getGetActiveDispatchesQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const { data: schedule, isLoading: isLoadingSchedule } = useGetVehicleSchedule(
    { weekStart },
    {
      query: {
        queryKey: getGetVehicleScheduleQueryKey({ weekStart }),
        refetchInterval: 60_000,
      },
    },
  );

  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + i);
    weekDays.push(d.toISOString().split("T")[0]);
  }

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Torre de Control</h1>
          <div className="flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Actualizado: {lastUpdate}
              </span>
            )}
            <Button
              data-testid="button-nuevo-despacho"
              onClick={() => setWizardOpen(true)}
              className="gap-2"
            >
              <Plus className="w-4 h-4" /> Nuevo Despacho
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground">Resumen de flota y operaciones activas.</p>
      </div>

      {isLoadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse bg-muted h-[120px]" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <button
            data-testid="card-flota-activa"
            onClick={() => setLocation("/vehiculos")}
            className="text-left w-full rounded-xl border border-border bg-card border-l-4 border-l-primary shadow-sm hover:bg-accent/30 transition-colors cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <span className="text-sm font-medium text-muted-foreground">Flota Activa</span>
              <Truck className="h-4 w-4 text-primary" />
            </div>
            <div className="p-6 pt-0">
              <div className="text-2xl font-bold">{summary.vehiculosDisponibles} / {summary.totalVehiculos}</div>
              <p className="text-xs text-muted-foreground">Vehículos disponibles</p>
            </div>
          </button>

          <button
            data-testid="card-en-transito"
            onClick={() => setLocation("/despachos")}
            className="text-left w-full rounded-xl border border-border bg-card border-l-4 border-l-blue-500 shadow-sm hover:bg-accent/30 transition-colors cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <span className="text-sm font-medium text-muted-foreground">En Tránsito</span>
              <MapPin className="h-4 w-4 text-blue-500" />
            </div>
            <div className="p-6 pt-0">
              <div className="text-2xl font-bold">{summary.despachosEnRuta}</div>
              <p className="text-xs text-muted-foreground">Despachos activos</p>
            </div>
          </button>

          <button
            data-testid="card-pendientes"
            onClick={() => setLocation("/pre-despacho")}
            className="text-left w-full rounded-xl border border-border bg-card border-l-4 border-l-orange-500 shadow-sm hover:bg-accent/30 transition-colors cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <span className="text-sm font-medium text-muted-foreground">Acción Pendiente</span>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </div>
            <div className="p-6 pt-0">
              <div className="text-2xl font-bold">{summary.despachosPendientes}</div>
              <p className="text-xs text-muted-foreground">Esperando aprobación</p>
            </div>
          </button>

          <button
            data-testid="card-completados"
            onClick={() => setLocation("/despachos")}
            className="text-left w-full rounded-xl border border-border bg-card border-l-4 border-l-green-500 shadow-sm hover:bg-accent/30 transition-colors cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <span className="text-sm font-medium text-muted-foreground">Completados</span>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </div>
            <div className="p-6 pt-0">
              <div className="text-2xl font-bold">{summary.despachosEntregados}</div>
              <p className="text-xs text-muted-foreground">Entregas exitosas</p>
            </div>
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Active Dispatches */}
        <Card className="lg:col-span-5 bg-card border-border">
          <CardHeader>
            <CardTitle>Despachos Activos</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingDispatches ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
                ))}
              </div>
            ) : activeDispatches && activeDispatches.length > 0 ? (
              <div className="space-y-3">
                {activeDispatches.map((dispatch) => (
                  <div
                    key={dispatch.id}
                    className="flex items-center justify-between p-3 border border-border rounded-lg bg-background"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold truncate">{dispatch.vehiculoModelo}</h4>
                      <p className="text-xs text-muted-foreground truncate">
                        {dispatch.choferNombre} — {dispatch.destino}
                      </p>
                      {dispatch.ultimaUbicacion && (
                        <p className="text-xs text-primary truncate">{dispatch.ultimaUbicacion}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs font-medium text-muted-foreground">ETA</p>
                        <p className="text-xs">{new Date(dispatch.fechaEstimadaLlegada).toLocaleDateString("es-MX")}</p>
                      </div>
                      <Button
                        data-testid={`button-gps-${dispatch.id}`}
                        variant="outline"
                        size="sm"
                        className="gap-1 border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground"
                        onClick={() => setGpsDispatch(dispatch)}
                      >
                        <MapPin className="w-3 h-3" />
                        GPS
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No hay despachos activos en este momento.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gantt Schedule */}
        <Card className="lg:col-span-7 bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Disponibilidad de Flota</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  data-testid="button-week-prev"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setWeekOffset((w) => w - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-1">
                  {new Date(weekStart + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                  {" – "}
                  {new Date(weekDays[6] + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                </span>
                <Button
                  data-testid="button-week-next"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setWeekOffset((w) => w + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoadingSchedule ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-3 text-muted-foreground font-medium w-28">Vehículo</th>
                    {weekDays.map((d) => {
                      const dt = new Date(d + "T00:00:00");
                      const isToday = d === new Date().toISOString().split("T")[0];
                      return (
                        <th
                          key={d}
                          className={`text-center py-1 px-1 font-medium w-12 ${isToday ? "text-primary" : "text-muted-foreground"}`}
                        >
                          <div>{DAYS_ES[dt.getDay()]}</div>
                          <div className={`text-[10px] ${isToday ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center mx-auto" : ""}`}>
                            {dt.getDate()}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {schedule && schedule.length > 0 ? (
                    schedule.map((entry) => (
                      <tr key={entry.vehiculoId} className="border-t border-border/40">
                        <td className="py-2 pr-3 text-muted-foreground truncate max-w-[112px]" title={entry.modelo}>
                          <div className="truncate font-medium text-foreground">{entry.modelo}</div>
                          <div className="text-[10px] capitalize">{entry.tipo}</div>
                        </td>
                        {weekDays.map((d) => {
                          const occupied = entry.diasOcupados?.find((o: any) => o.fecha === d);
                          return (
                            <td key={d} className="py-2 px-0.5">
                              {occupied ? (
                                <div
                                  className={`${ESTADO_COLOR[occupied.estado] ?? "bg-gray-500/80"} rounded text-[9px] text-white text-center px-1 py-1 truncate cursor-default`}
                                  title={`${occupied.destino} (${occupied.estado})`}
                                >
                                  {occupied.destino?.split(",")[0] ?? "—"}
                                </div>
                              ) : (
                                <div className="h-6 rounded bg-muted/30 flex items-center justify-center">
                                  <span className="text-[9px] text-muted-foreground/40">—</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        Sin vehículos registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <div className="flex gap-3 mt-3 flex-wrap">
              {Object.entries(ESTADO_COLOR).map(([estado, color]) => (
                <div key={estado} className="flex items-center gap-1">
                  <div className={`w-3 h-3 rounded ${color}`} />
                  <span className="text-[10px] text-muted-foreground capitalize">{estado}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <NuevoDespachoWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* GPS Modal */}
      <Dialog open={!!gpsDispatch} onOpenChange={(open) => !open && setGpsDispatch(null)}>
        <DialogContent className="sm:max-w-[620px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>
              Rastreo en Vivo — {gpsDispatch?.vehiculoModelo}
            </DialogTitle>
          </DialogHeader>
          {gpsDispatch && (
            <>
              <div className="flex gap-4 text-sm text-muted-foreground mb-2">
                <span><strong className="text-foreground">Chofer:</strong> {gpsDispatch.choferNombre}</span>
                <span><strong className="text-foreground">Destino:</strong> {gpsDispatch.destino}</span>
              </div>
              <div className="aspect-video w-full bg-muted rounded-md border border-border overflow-hidden flex items-center justify-center">
                {gpsDispatch.latitud && gpsDispatch.longitud ? (
                  <iframe
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    title="GPS"
                    src={`https://maps.google.com/maps?q=${gpsDispatch.latitud},${gpsDispatch.longitud}&z=12&output=embed`}
                  />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground gap-2">
                    <MapPin className="w-12 h-12 opacity-30" />
                    <p className="font-medium">Señal GPS no disponible</p>
                    {gpsDispatch.ultimaUbicacion && (
                      <p className="text-xs">Última ubicación conocida: {gpsDispatch.ultimaUbicacion}</p>
                    )}
                    <p className="text-xs opacity-60">Se mostrará en tiempo real cuando el vehículo reporte coordenadas.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
