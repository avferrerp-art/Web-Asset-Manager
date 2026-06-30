import React, { useState } from "react";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useListRoutes, getListRoutesQueryKey,
  useCreateDispatch, getListDispatchesQueryKey,
  useUpdateDispatch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, ChevronRight, Route as RouteIcon, Truck, Users, CalendarClock, PackageCheck,
} from "lucide-react";

interface WizardState {
  vehiculoId: number;
  choferId: number;
  ayudanteId: number;
  routeId: number;
  distanciaKm: number;
  fechaEstimadaSalida: string;
  fechaEstimadaLlegada: string;
}

const defaultToday = () => {
  const d = new Date();
  return d.toISOString().slice(0, 16);
};
const defaultTomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 16);
};

const STEPS = [
  { label: "Orden", icon: PackageCheck },
  { label: "Asignación", icon: Truck },
  { label: "Aprobar", icon: CheckCircle2 },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NuevoDespachoWizard({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [assignment, setAssignment] = useState<WizardState>({
    vehiculoId: 0,
    choferId: 0,
    ayudanteId: 0,
    routeId: 0,
    distanciaKm: 0,
    fechaEstimadaSalida: defaultToday(),
    fechaEstimadaLlegada: defaultTomorrow(),
  });
  const [marcarEnRuta, setMarcarEnRuta] = useState(false);

  const { data: sales, isLoading: isLoadingSales } = useListSales(
    { status: "pendiente" },
    { query: { queryKey: getListSalesQueryKey({ status: "pendiente" }) } }
  );
  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() },
  });
  const { data: personnel } = useListPersonnel({
    query: { queryKey: getListPersonnelQueryKey() },
  });
  const { data: routes } = useListRoutes({
    query: { queryKey: getListRoutesQueryKey() },
  });

  const createDispatch = useCreateDispatch();
  const updateDispatch = useUpdateDispatch();

  const pendingSales = sales?.filter((s) => s.estado === "pendiente") ?? [];

  const selectedVehicle = vehicles?.find((v) => v.id === assignment.vehiculoId);
  const selectedChofer = personnel?.find((p) => p.id === assignment.choferId);
  const selectedAyudante = personnel?.find((p) => p.id === assignment.ayudanteId);
  const selectedRoute = routes?.find((r) => r.id === assignment.routeId);

  const dias =
    assignment.fechaEstimadaSalida && assignment.fechaEstimadaLlegada
      ? Math.max(
          1,
          Math.ceil(
            (new Date(assignment.fechaEstimadaLlegada).getTime() -
              new Date(assignment.fechaEstimadaSalida).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : 1;

  const litros =
    selectedVehicle && assignment.distanciaKm
      ? assignment.distanciaKm / selectedVehicle.rendimientoKmLitro
      : 0;
  const costoCombustible = litros * 1.5;
  const costoViaticos =
    dias *
    ((selectedChofer?.tarifaViaticos ?? 0) +
      (selectedAyudante?.tarifaViaticos ?? 0));
  const costoPeajes =
    selectedRoute && selectedVehicle?.tarifaPeaje != null
      ? (selectedRoute.tolls?.length ?? 0) * selectedVehicle.tarifaPeaje
      : 0;
  const totalEstimado = costoCombustible + costoViaticos + costoPeajes;

  function handleSelectSale(sale: any) {
    setSelectedSale(sale);
    const bestVehicle = vehicles?.find(
      (v) =>
        v.capacidadPeso >= sale.pesoTotal &&
        v.capacidadVolumen >= sale.volumenTotal
    );
    const matchingRoute = routes?.find(
      (r) =>
        r.destino.toLowerCase().includes(sale.destino.toLowerCase()) ||
        sale.destino.toLowerCase().includes(r.destino.toLowerCase())
    );
    setAssignment((prev) => ({
      ...prev,
      vehiculoId: bestVehicle?.id ?? vehicles?.[0]?.id ?? 0,
      routeId: matchingRoute?.id ?? 0,
      distanciaKm: matchingRoute?.distanciaKm ?? 100,
    }));
  }

  function handleRouteChange(val: string) {
    const id = val === "0" ? 0 : parseInt(val);
    const route = routes?.find((r) => r.id === id);
    setAssignment((prev) => ({
      ...prev,
      routeId: id,
      distanciaKm: route?.distanciaKm ?? prev.distanciaKm,
    }));
  }

  function step2Valid() {
    return (
      assignment.vehiculoId > 0 &&
      assignment.choferId > 0 &&
      assignment.distanciaKm > 0 &&
      assignment.fechaEstimadaSalida &&
      assignment.fechaEstimadaLlegada
    );
  }

  function handleApprove() {
    if (!selectedSale) return;
    const payload: Record<string, unknown> = {
      ventaId: selectedSale.id,
      vehiculoId: assignment.vehiculoId,
      choferId: assignment.choferId,
      fechaEstimadaSalida: assignment.fechaEstimadaSalida,
      fechaEstimadaLlegada: assignment.fechaEstimadaLlegada,
      ruta: selectedSale.destino,
      distanciaKm: assignment.distanciaKm,
    };
    if (assignment.ayudanteId > 0) payload.ayudanteId = assignment.ayudanteId;
    if (assignment.routeId > 0) {
      payload.routeId = assignment.routeId;
      payload.totalPeajes = costoPeajes;
    }

    createDispatch.mutate(
      { data: payload as any },
      {
        onSuccess: (dispatch) => {
          if (marcarEnRuta) {
            updateDispatch.mutate(
              { id: dispatch.id, data: { estado: "en-ruta" } },
              {
                onSuccess: () => {
                  finalize("¡Despacho creado y marcado En Ruta!");
                },
                onError: () => {
                  finalize("Despacho aprobado (no se pudo marcar En Ruta).");
                },
              }
            );
          } else {
            finalize("¡Despacho creado y aprobado!");
          }
        },
        onError: () => {
          toast({ title: "Error al crear el despacho", variant: "destructive" });
        },
      }
    );
  }

  function finalize(msg: string) {
    queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDispatchesQueryKey() });
    toast({ title: msg });
    handleClose();
  }

  function handleClose() {
    onClose();
    setTimeout(() => {
      setStep(1);
      setSelectedSale(null);
      setMarcarEnRuta(false);
      setAssignment({
        vehiculoId: 0,
        choferId: 0,
        ayudanteId: 0,
        routeId: 0,
        distanciaKm: 0,
        fechaEstimadaSalida: defaultToday(),
        fechaEstimadaLlegada: defaultTomorrow(),
      });
    }, 300);
  }

  const isPending = createDispatch.isPending || updateDispatch.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Nuevo Despacho</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-4">
          {STEPS.map((s, i) => {
            const idx = i + 1;
            const done = step > idx;
            const active = step === idx;
            const Icon = s.icon;
            return (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                      done
                        ? "bg-primary border-primary text-primary-foreground"
                        : active
                        ? "bg-primary/20 border-primary text-primary"
                        : "bg-muted border-border text-muted-foreground"
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span
                    className={`text-[11px] font-medium ${
                      active ? "text-primary" : done ? "text-primary/70" : "text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`h-[2px] flex-1 mb-5 transition-colors ${
                      step > idx ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* STEP 1: Select sale */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecciona la orden de venta pendiente a despachar.
            </p>
            {isLoadingSales ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />
                ))}
              </div>
            ) : pendingSales.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No hay órdenes de venta pendientes.
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {pendingSales.map((sale) => (
                  <button
                    key={sale.id}
                    data-testid={`wizard-sale-${sale.id}`}
                    onClick={() => handleSelectSale(sale)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedSale?.id === sale.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-accent/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selectedSale?.id === sale.id
                              ? "border-primary bg-primary"
                              : "border-border"
                          }`}
                        >
                          {selectedSale?.id === sale.id && (
                            <div className="w-2 h-2 rounded-full bg-white" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">
                            #{sale.id} — {sale.cliente}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {sale.destino} · {sale.pesoTotal} kg · {sale.volumenTotal} m³
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {sale.tipoMaterial ?? "—"}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button
                data-testid="wizard-next-1"
                disabled={!selectedSale}
                onClick={() => setStep(2)}
                className="gap-1"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Assignment */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Sale summary */}
            <div className="bg-muted/60 rounded-md px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="font-semibold">Cliente:</span> {selectedSale?.cliente}</span>
              <span><span className="font-semibold">Destino:</span> {selectedSale?.destino}</span>
              <span><span className="font-semibold">Peso:</span> {selectedSale?.pesoTotal} kg</span>
              <span><span className="font-semibold">Volumen:</span> {selectedSale?.volumenTotal} m³</span>
            </div>

            {/* Route */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <RouteIcon className="w-3.5 h-3.5" /> Ruta predefinida{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Select
                value={assignment.routeId > 0 ? assignment.routeId.toString() : "0"}
                onValueChange={handleRouteChange}
              >
                <SelectTrigger data-testid="wizard-select-ruta">
                  <SelectValue placeholder="Sin ruta asignada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sin ruta asignada</SelectItem>
                  {routes?.map((r) => (
                    <SelectItem key={r.id} value={r.id.toString()}>
                      {r.nombre ? `${r.nombre} — ` : ""}
                      {r.origen} → {r.destino}
                      {r.tolls?.length
                        ? ` (${r.tolls.length} caseta${r.tolls.length !== 1 ? "s" : ""})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRoute && selectedVehicle?.tarifaPeaje != null && (
                <p className="text-xs text-muted-foreground pl-1">
                  {selectedRoute.tolls?.length ?? 0} caseta(s) ×{" "}
                  ${selectedVehicle.tarifaPeaje.toFixed(2)} ={" "}
                  <span className="font-semibold text-foreground">
                    ${costoPeajes.toFixed(2)}
                  </span>{" "}
                  en peajes
                </p>
              )}
            </div>

            {/* Vehicle + Distance */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Truck className="w-3.5 h-3.5" /> Vehículo
                </Label>
                <Select
                  value={assignment.vehiculoId > 0 ? assignment.vehiculoId.toString() : "0"}
                  onValueChange={(v) =>
                    setAssignment((p) => ({ ...p, vehiculoId: parseInt(v) }))
                  }
                >
                  <SelectTrigger data-testid="wizard-select-vehiculo">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles?.map((v) => (
                      <SelectItem key={v.id} value={v.id.toString()}>
                        {v.modelo} — {v.capacidadPeso}kg
                        {v.tipo === "tercero" ? " [Tercero]" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Distancia (km)</Label>
                <Input
                  data-testid="wizard-input-distancia"
                  type="number"
                  min={1}
                  value={assignment.distanciaKm || ""}
                  onChange={(e) =>
                    setAssignment((p) => ({
                      ...p,
                      distanciaKm: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            {/* Driver + Assistant */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Users className="w-3.5 h-3.5" /> Chofer
                </Label>
                <Select
                  value={assignment.choferId > 0 ? assignment.choferId.toString() : "0"}
                  onValueChange={(v) =>
                    setAssignment((p) => ({ ...p, choferId: parseInt(v) }))
                  }
                >
                  <SelectTrigger data-testid="wizard-select-chofer">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {personnel
                      ?.filter((p) => p.rol === "chofer")
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">
                  Ayudante (opcional)
                </Label>
                <Select
                  value={assignment.ayudanteId > 0 ? assignment.ayudanteId.toString() : "0"}
                  onValueChange={(v) =>
                    setAssignment((p) => ({ ...p, ayudanteId: parseInt(v) }))
                  }
                >
                  <SelectTrigger data-testid="wizard-select-ayudante">
                    <SelectValue placeholder="Ninguno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Ninguno</SelectItem>
                    {personnel
                      ?.filter((p) => p.rol === "ayudante")
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <CalendarClock className="w-3.5 h-3.5" /> Fecha de Salida
                </Label>
                <Input
                  data-testid="wizard-input-salida"
                  type="datetime-local"
                  value={assignment.fechaEstimadaSalida}
                  onChange={(e) =>
                    setAssignment((p) => ({
                      ...p,
                      fechaEstimadaSalida: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Fecha de Llegada</Label>
                <Input
                  data-testid="wizard-input-llegada"
                  type="datetime-local"
                  value={assignment.fechaEstimadaLlegada}
                  onChange={(e) =>
                    setAssignment((p) => ({
                      ...p,
                      fechaEstimadaLlegada: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                ← Atrás
              </Button>
              <Button
                data-testid="wizard-next-2"
                disabled={!step2Valid()}
                onClick={() => setStep(3)}
                className="gap-1"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Review + Approve */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Order + Resources summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/60 rounded-lg p-3 space-y-1 text-sm">
                <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Orden de Venta
                </div>
                <div><span className="text-muted-foreground">Cliente:</span> {selectedSale?.cliente}</div>
                <div><span className="text-muted-foreground">Destino:</span> {selectedSale?.destino}</div>
                <div><span className="text-muted-foreground">Peso:</span> {selectedSale?.pesoTotal} kg</div>
                <div><span className="text-muted-foreground">Volumen:</span> {selectedSale?.volumenTotal} m³</div>
              </div>
              <div className="bg-muted/60 rounded-lg p-3 space-y-1 text-sm">
                <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Recursos Asignados
                </div>
                <div><span className="text-muted-foreground">Vehículo:</span> {selectedVehicle?.modelo ?? "—"}</div>
                <div><span className="text-muted-foreground">Chofer:</span> {selectedChofer?.nombre ?? "—"}</div>
                <div><span className="text-muted-foreground">Ayudante:</span> {selectedAyudante?.nombre ?? "Ninguno"}</div>
                <div>
                  <span className="text-muted-foreground">Ruta:</span>{" "}
                  {selectedRoute
                    ? `${selectedRoute.nombre ?? ""} ${selectedRoute.origen} → ${selectedRoute.destino}`
                    : `${assignment.distanciaKm} km`}
                </div>
              </div>
            </div>

            {/* Cost breakdown */}
            <div className="bg-primary/10 border border-primary/20 p-4 rounded-md">
              <h4 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <Truck className="w-4 h-4" /> Estimación de Costos
              </h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center p-2 bg-background rounded border border-border">
                  <div className="text-xs text-muted-foreground">Combustible</div>
                  <div className="font-bold text-sm">${costoCombustible.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">{litros.toFixed(1)} L</div>
                </div>
                <div className="text-center p-2 bg-background rounded border border-border">
                  <div className="text-xs text-muted-foreground">Viáticos</div>
                  <div className="font-bold text-sm">${costoViaticos.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">{dias} día(s)</div>
                </div>
                <div className="text-center p-2 bg-background rounded border border-border">
                  <div className="text-xs text-muted-foreground">Peajes</div>
                  {assignment.routeId > 0 ? (
                    <>
                      <div className="font-bold text-sm">${costoPeajes.toFixed(2)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {selectedRoute?.tolls?.length ?? 0} caseta(s)
                      </div>
                    </>
                  ) : (
                    <div className="font-bold text-sm text-muted-foreground">—</div>
                  )}
                </div>
                <div className="text-center p-2 bg-primary/20 rounded border border-primary/30">
                  <div className="text-xs text-muted-foreground">Total Est.</div>
                  <div className="font-bold text-sm text-primary">${totalEstimado.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {/* Dates summary */}
            <div className="flex gap-4 text-sm text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <span>
                <span className="font-medium text-foreground">Salida:</span>{" "}
                {new Date(assignment.fechaEstimadaSalida).toLocaleString("es-MX", {
                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </span>
              <span>
                <span className="font-medium text-foreground">Llegada est.:</span>{" "}
                {new Date(assignment.fechaEstimadaLlegada).toLocaleString("es-MX", {
                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            </div>

            {/* En Ruta toggle */}
            <label className="flex items-center gap-3 cursor-pointer group select-none">
              <div
                role="checkbox"
                aria-checked={marcarEnRuta}
                data-testid="wizard-toggle-en-ruta"
                onClick={() => setMarcarEnRuta((v) => !v)}
                className={`w-10 h-6 rounded-full border-2 flex items-center transition-colors cursor-pointer ${
                  marcarEnRuta
                    ? "bg-indigo-500 border-indigo-500"
                    : "bg-muted border-border"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${
                    marcarEnRuta ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </div>
              <div>
                <span className="text-sm font-medium">Marcar inmediatamente como En Ruta</span>
                <p className="text-xs text-muted-foreground">
                  El vehículo ya salió — se omite el estado "Aprobado"
                </p>
              </div>
            </label>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                ← Atrás
              </Button>
              <Button
                data-testid="wizard-approve"
                onClick={handleApprove}
                disabled={isPending}
                className="gap-2"
                size="lg"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isPending
                  ? "Procesando..."
                  : marcarEnRuta
                  ? "Aprobar y marcar En Ruta"
                  : "Aprobar Despacho"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
