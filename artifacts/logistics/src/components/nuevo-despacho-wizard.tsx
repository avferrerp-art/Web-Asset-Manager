import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useListRoutes, getListRoutesQueryKey,
  useListDispatches, getListDispatchesQueryKey,
  useCreateDispatch,
  useUpdateDispatch,
  useEstimateDispatchCostsPreview,
} from "@workspace/api-client-react";
import type { DispatchInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, ChevronRight, Route as RouteIcon, Truck, Users, CalendarClock, PackageCheck,
  AlertTriangle, MapPin, RefreshCw, ExternalLink, Warehouse, Info,
} from "lucide-react";
import { almacenCiudad, ciudadCoincide } from "@/lib/almacenes";
import { formatCarga, sinDatoCarga } from "@/lib/carga";
import { classifyFleet, suggestedVehicle } from "@/lib/fleet";
import { toDatetimeLocal } from "@/lib/datetime-local";

function fmtDateShort(s: string) {
  return new Date(s).toLocaleDateString("es-VE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

interface WizardState {
  vehiculoId: number;
  choferId: number;
  ayudanteId: number;
  routeId: number;
  distanciaKm: number;
  distanciaManual: boolean;
  fechaEstimadaSalida: string;
  fechaEstimadaLlegada: string;
}

const defaultToday = () => {
  return toDatetimeLocal(new Date());
};
const defaultTomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDatetimeLocal(d);
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
  const [, navigate] = useLocation();

  const [step, setStep] = useState(1);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [assignment, setAssignment] = useState<WizardState>({
    vehiculoId: 0,
    choferId: 0,
    ayudanteId: 0,
    routeId: 0,
    distanciaKm: 0,
    distanciaManual: false,
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

  const { data: allDispatches } = useListDispatches(undefined, {
    query: { queryKey: getListDispatchesQueryKey() },
  });

  const createDispatch = useCreateDispatch();
  const updateDispatch = useUpdateDispatch();

  const pendingSales = sales?.filter((s) => s.estado === "pendiente") ?? [];

  const BUSY_STATES = ["pre-despacho", "aprobado", "en-ruta"];
  const vehicleConflict = (() => {
    if (!assignment.vehiculoId || !assignment.fechaEstimadaSalida || !assignment.fechaEstimadaLlegada || !allDispatches) return null;
    const newStart = new Date(assignment.fechaEstimadaSalida).getTime();
    const newEnd = new Date(assignment.fechaEstimadaLlegada).getTime();
    return allDispatches.find(d =>
      d.vehiculoId === assignment.vehiculoId &&
      BUSY_STATES.includes(d.estado) &&
      newStart < new Date(d.fechaEstimadaLlegada).getTime() &&
      newEnd > new Date(d.fechaEstimadaSalida).getTime()
    ) ?? null;
  })();

  // Clasificación de flota (fleet.ts = única fuente de verdad). Solo aplica
  // cuando la venta tiene peso en Odoo; sin dato no se sugiere nada.
  const fleetClass =
    selectedSale && !sinDatoCarga(selectedSale.pesoTotal)
      ? classifyFleet(vehicles ?? [], selectedSale.pesoTotal ?? 0, selectedSale.volumenTotal ?? 0)
      : null;
  const suggestedFit = fleetClass?.fit[0] ?? null;
  const ningunVehiculoCompatible =
    fleetClass != null && fleetClass.fit.length === 0 && (vehicles?.length ?? 0) > 0;

  const selectedVehicle = vehicles?.find((v) => v.id === assignment.vehiculoId);
  const selectedChofer = personnel?.find((p) => p.id === assignment.choferId);
  const selectedAyudante = personnel?.find((p) => p.id === assignment.ayudanteId);
  const selectedRoute = routes?.find((r) => r.id === assignment.routeId);

  const estimateCosts = useEstimateDispatchCostsPreview();
  const [costPreview, setCostPreview] = useState<{
    costoCombustible: number;
    costoViaticos: number;
    costoPeajes: number;
    total: number;
    litrosEstimados: number;
    distanciaKm: number;
    tramos?: { label: string; distanciaKm: number }[];
  } | null>(null);

  useEffect(() => {
    if (
      !assignment.vehiculoId ||
      !assignment.choferId ||
      !assignment.distanciaKm ||
      !assignment.fechaEstimadaSalida ||
      !assignment.fechaEstimadaLlegada
    ) {
      setCostPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      estimateCosts.mutate(
        {
          data: {
            vehiculoId: assignment.vehiculoId,
            choferId: assignment.choferId,
            ayudanteId: assignment.ayudanteId > 0 ? assignment.ayudanteId : undefined,
            fechaEstimadaSalida: assignment.fechaEstimadaSalida,
            fechaEstimadaLlegada: assignment.fechaEstimadaLlegada,
            distanciaKm: assignment.distanciaKm,
            routeId: assignment.routeId > 0 ? assignment.routeId : undefined,
          },
        },
        { onSuccess: (data) => setCostPreview(data) }
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [
    assignment.vehiculoId,
    assignment.choferId,
    assignment.ayudanteId,
    assignment.distanciaKm,
    assignment.routeId,
    assignment.fechaEstimadaSalida,
    assignment.fechaEstimadaLlegada,
  ]);

  const litros = costPreview?.litrosEstimados ?? 0;
  const costoCombustible = costPreview?.costoCombustible ?? 0;
  const precioPorLitro = litros > 0 ? costoCombustible / litros : 0;
  const costoViaticos = costPreview?.costoViaticos ?? 0;
  const costoPeajes = costPreview?.costoPeajes ?? 0;
  const totalEstimado = costPreview?.total ?? 0;

  function handleSelectSale(sale: any) {
    setSelectedSale(sale);
    // Sin peso en Odoo no hay compatibilidad confiable: no preseleccionar
    // vehículo por capacidad (un 0 silencioso sugeriría el más chico).
    // Con datos, fleet.ts es la única fuente de verdad: el sugerido es el
    // ajuste más apretado (el más chico que soporta la carga). Si ninguno
    // la soporta, no se preselecciona nada.
    const bestVehicle = sinDatoCarga(sale.pesoTotal)
      ? null
      : suggestedVehicle(vehicles ?? [], sale.pesoTotal ?? 0, sale.volumenTotal ?? 0);
    // Preferir una ruta cuyo origen coincida con la ciudad del almacén de la
    // venta (sugerencia; el usuario puede cambiarla). Si no hay almacén mapeado
    // o ninguna ruta coincide, comportamiento original: match por destino.
    const ciudadAlmacen = almacenCiudad(sale.almacenOrigen);
    const destinoMatch = (r: any) =>
      r.destino.toLowerCase().includes(sale.destino.toLowerCase()) ||
      sale.destino.toLowerCase().includes(r.destino.toLowerCase());
    const rutasDesdeAlmacen = ciudadAlmacen
      ? (routes ?? []).filter((r) => ciudadCoincide(r.origen, ciudadAlmacen))
      : [];
    const matchingRoute =
      rutasDesdeAlmacen.find(destinoMatch) ??
      rutasDesdeAlmacen[0] ??
      routes?.find(destinoMatch);
    setAssignment((prev) => ({
      ...prev,
      vehiculoId: bestVehicle?.id ?? 0,
      routeId: matchingRoute?.id ?? 0,
      distanciaKm: matchingRoute?.distanciaTotalKm ?? 100,
    }));
  }

  function handleRouteChange(val: string) {
    const id = parseInt(val);
    const route = routes?.find((r) => r.id === id);
    setAssignment((prev) => ({
      ...prev,
      routeId: id,
      distanciaKm: prev.distanciaManual ? prev.distanciaKm : route?.distanciaTotalKm ?? prev.distanciaKm,
    }));
  }

  function step2Valid() {
    return (
      assignment.vehiculoId > 0 &&
      assignment.choferId > 0 &&
      assignment.routeId > 0 &&
      assignment.distanciaKm > 0 &&
      assignment.fechaEstimadaSalida &&
      assignment.fechaEstimadaLlegada &&
      !vehicleConflict
    );
  }

  function handleApprove() {
    if (!selectedSale) return;
    const payload: DispatchInput = {
      ventaId: selectedSale.id,
      vehiculoId: assignment.vehiculoId,
      choferId: assignment.choferId,
      fechaEstimadaSalida: assignment.fechaEstimadaSalida,
      fechaEstimadaLlegada: assignment.fechaEstimadaLlegada,
      ruta: selectedSale.destino,
      distanciaKm: assignment.distanciaKm,
      distanciaManual: assignment.distanciaManual,
      routeId: assignment.routeId,
      totalPeajes: costoPeajes,
      ...(assignment.ayudanteId > 0 ? { ayudanteId: assignment.ayudanteId } : {}),
    };

    createDispatch.mutate(
      { data: payload },
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
        distanciaManual: false,
        fechaEstimadaSalida: defaultToday(),
        fechaEstimadaLlegada: defaultTomorrow(),
      });
    }, 300);
  }

  const isPending = createDispatch.isPending || updateDispatch.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[680px] grid-cols-[minmax(0,1fr)] max-h-[90vh] overflow-y-auto">
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
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                            selectedSale?.id === sale.id
                              ? "border-primary bg-primary"
                              : "border-border"
                          }`}
                        >
                          {selectedSale?.id === sale.id && (
                            <div className="w-2 h-2 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">
                            #{sale.id} — {sale.cliente}
                          </div>
                          <div className="text-xs text-muted-foreground truncate" title={sale.destino}>
                            {sale.destino}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatCarga(sale.pesoTotal, "kg")} · {formatCarga(sale.volumenTotal, "m³")}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 max-w-[120px] truncate block">
                        {sale.tipoMaterial ?? "—"}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* Avisos informativos (no bloqueantes) sobre la orden elegida */}
            {selectedSale?.estadoEntrega === "cancelado" && (
              <div data-testid="wizard-aviso-cancelado" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">Odoo registra esta venta como cancelada.</span>{" "}
                  Verifica con administración antes de despachar. Puedes continuar si es intencional.
                </span>
              </div>
            )}
            {selectedSale?.estadoEntrega === "entregado" && (
              <div data-testid="wizard-aviso-entregado" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Odoo ya registra esta venta como entregada. Puedes continuar si aun así necesitas el despacho.</span>
              </div>
            )}
            {selectedSale?.almacenesMultiples && (
              <div data-testid="wizard-aviso-multialmacen" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
                <Warehouse className="w-4 h-4 mt-0.5 shrink-0" />
                <span>La mercancía de esta venta sale de más de un almacén; puede necesitar más de un viaje.</span>
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
              <span><span className="font-semibold">Peso:</span> {formatCarga(selectedSale?.pesoTotal, "kg")}</span>
              <span><span className="font-semibold">Volumen:</span> {formatCarga(selectedSale?.volumenTotal, "m³")}</span>
            </div>

            {/* Almacén de origen de la venta */}
            {selectedSale?.almacenOrigen && (
              <div data-testid="wizard-almacen-origen" className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                <Warehouse className="w-4 h-4 text-primary shrink-0" />
                <span>
                  <span className="font-semibold">Almacén de origen:</span> {selectedSale.almacenOrigen}
                  {almacenCiudad(selectedSale.almacenOrigen) && (
                    <span className="text-muted-foreground"> ({almacenCiudad(selectedSale.almacenOrigen)})</span>
                  )}
                </span>
              </div>
            )}

            {/* Route */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <RouteIcon className="w-3.5 h-3.5" /> Ruta <span className="text-destructive">*</span>
              </Label>
              <Select
                value={assignment.routeId > 0 ? assignment.routeId.toString() : ""}
                onValueChange={handleRouteChange}
              >
                <SelectTrigger data-testid="wizard-select-ruta">
                  <SelectValue placeholder="Seleccionar ruta" />
                </SelectTrigger>
                <SelectContent>
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
              {(() => {
                const ciudadAlmacen = almacenCiudad(selectedSale?.almacenOrigen);
                if (!ciudadAlmacen || !selectedRoute) return null;
                if (ciudadCoincide(selectedRoute.origen, ciudadAlmacen)) return null;
                return (
                  <div data-testid="wizard-aviso-origen-distinto" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      Esta ruta sale de <span className="font-semibold">{selectedRoute.origen}</span> pero la
                      mercancía está en <span className="font-semibold">{selectedSale?.almacenOrigen} ({ciudadAlmacen})</span>.
                      Puedes continuar si es intencional.
                    </span>
                  </div>
                );
              })()}
              {selectedRoute && (selectedRoute.tolls?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground pl-1">
                  {selectedRoute.tolls?.length ?? 0} caseta(s)
                  {selectedRoute.tipo === "redondo" ? " (ida y vuelta)" : ""} ={" "}
                  <span className="font-semibold text-foreground">
                    ${costoPeajes.toFixed(2)}
                  </span>{" "}
                  en peajes
                </p>
              )}
              {selectedRoute && selectedRoute.tipo !== "sencillo" && costPreview?.tramos && costPreview.tramos.length > 0 && (
                <div className="text-xs bg-muted/30 rounded-md px-2.5 py-2 border border-border/40 space-y-1">
                  <p className="text-muted-foreground font-medium">Desglose por tramo</p>
                  {costPreview.tramos.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-muted-foreground">
                      <span className="truncate">{t.label}</span>
                      <span className="shrink-0 ml-2">{t.distanciaKm} km</span>
                    </div>
                  ))}
                </div>
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
                        {suggestedFit?.vehicle.id === v.id
                          ? ` — ⭐ SUGERIDO (${suggestedFit.maxPct.toFixed(0)}% uso)`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suggestedFit && assignment.vehiculoId === suggestedFit.vehicle.id && (
                  <Badge className="text-[10px] gap-1" data-testid="wizard-badge-sugerido">
                    ⭐ SUGERIDO · {suggestedFit.maxPct.toFixed(0)}% uso
                  </Badge>
                )}
                {ningunVehiculoCompatible && (
                  <div
                    data-testid="wizard-aviso-sin-vehiculo"
                    className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      Ningún vehículo de la flota soporta esta carga
                      ({formatCarga(selectedSale?.pesoTotal, "kg")} · {formatCarga(selectedSale?.volumenTotal, "m³")}).
                      Considera dividir el envío.
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Distancia (km)</Label>
                <Input
                  data-testid="wizard-input-distancia"
                  type="number"
                  min={1}
                  disabled={assignment.routeId > 0 && !assignment.distanciaManual}
                  value={assignment.distanciaKm || ""}
                  onChange={(e) =>
                    setAssignment((p) => ({
                      ...p,
                      distanciaKm: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
                {assignment.routeId > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                    <Checkbox
                      checked={assignment.distanciaManual}
                      onCheckedChange={(checked) =>
                        setAssignment((p) => ({
                          ...p,
                          distanciaManual: checked === true,
                          distanciaKm: checked === true ? p.distanciaKm : selectedRoute?.distanciaTotalKm ?? p.distanciaKm,
                        }))
                      }
                    />
                    Ajustar distancia manualmente
                  </label>
                )}
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

            {/* Alerta de conflicto de vehículo */}
            {vehicleConflict && (() => {
              const conflictDestino = vehicleConflict.destino ?? vehicleConflict.ruta ?? null;
              const sameDestino = conflictDestino && selectedSale?.destino &&
                (conflictDestino.toLowerCase().includes(selectedSale.destino.toLowerCase()) ||
                 selectedSale.destino.toLowerCase().includes(conflictDestino.toLowerCase()));
              return (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 overflow-hidden text-sm">
                  {/* Cabecera */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-destructive/15">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                    <p className="font-semibold text-destructive">Vehículo ocupado en ese período</p>
                  </div>

                  {/* Detalle del conflicto */}
                  <div className="px-3 pt-2.5 pb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Despacho</span>
                    <span className="font-medium">#{vehicleConflict.id}
                      {vehicleConflict.estado && (
                        <span className="ml-1.5 capitalize text-muted-foreground">({vehicleConflict.estado})</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">Destino</span>
                    <span className="font-medium">{conflictDestino ?? "—"}</span>
                    <span className="text-muted-foreground">Salida</span>
                    <span className="font-medium">{fmtDateShort(vehicleConflict.fechaEstimadaSalida)}</span>
                    <span className="text-muted-foreground">Llegada</span>
                    <span className="font-medium">{fmtDateShort(vehicleConflict.fechaEstimadaLlegada)}</span>
                    {vehicleConflict.choferNombre && <>
                      <span className="text-muted-foreground">Chofer</span>
                      <span className="font-medium">{vehicleConflict.choferNombre}</span>
                    </>}
                  </div>

                  {/* Sugerencia de mismo destino */}
                  {sameDestino && (
                    <div className="mx-3 mb-2 flex items-start gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-emerald-600 dark:text-emerald-400">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <div className="text-xs">
                        <p className="font-semibold">Mismo destino detectado</p>
                        <p className="mt-0.5 opacity-80">
                          El despacho #{vehicleConflict.id} ya va a {conflictDestino}. Podrías coordinar ambas cargas en ese viaje.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Acciones */}
                  <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => setAssignment(p => ({ ...p, vehiculoId: 0 }))}
                    >
                      <RefreshCw className="w-3 h-3" /> Cambiar vehículo
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={sameDestino ? "secondary" : "ghost"}
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => { onClose(); navigate("/despachos"); }}
                    >
                      <ExternalLink className="w-3 h-3" /> Ver despacho #{vehicleConflict.id}
                    </Button>
                  </div>
                </div>
              );
            })()}

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
                <div><span className="text-muted-foreground">Peso:</span> {formatCarga(selectedSale?.pesoTotal, "kg")}</div>
                <div><span className="text-muted-foreground">Volumen:</span> {formatCarga(selectedSale?.volumenTotal, "m³")}</div>
              </div>
              <div className="bg-muted/60 rounded-lg p-3 space-y-1 text-sm">
                <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Recursos Asignados
                </div>
                <div><span className="text-muted-foreground">Vehículo:</span> {selectedVehicle?.modelo ?? "—"}</div>
                <div><span className="text-muted-foreground">Chofer:</span> {selectedChofer?.nombre ?? "—"}</div>
                <div><span className="text-muted-foreground">Ayudante:</span> {selectedAyudante?.nombre ?? "Ninguno"}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-muted-foreground">Ruta:</span>{" "}
                  {selectedRoute
                    ? `${selectedRoute.nombre ?? ""} ${selectedRoute.origen} → ${selectedRoute.destino}`
                    : `${assignment.distanciaKm} km`}
                  {selectedRoute?.tipo && selectedRoute.tipo !== "sencillo" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {selectedRoute.tipo === "redondo" ? "Redondo" : "Multidestino"}
                    </Badge>
                  )}
                </div>
                {selectedRoute?.tipo === "redondo" && !assignment.distanciaManual && (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1 mt-1">
                    Distancia y peajes calculados automáticamente (ida y vuelta).
                  </p>
                )}
                {selectedRoute?.tipo === "multidestino" && !assignment.distanciaManual && (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1 mt-1">
                    Distancia calculada automáticamente sumando los tramos de la ruta.
                  </p>
                )}
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
                  <div className="text-[10px] text-muted-foreground">{litros.toFixed(1)} L · ${precioPorLitro.toFixed(2)}/L</div>
                </div>
                <div className="text-center p-2 bg-background rounded border border-border">
                  <div className="text-xs text-muted-foreground">Viáticos</div>
                  <div className="font-bold text-sm">${costoViaticos.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">{costPreview?.distanciaKm ?? 0} km</div>
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
              {selectedRoute && selectedRoute.tipo !== "sencillo" && costPreview?.tramos && costPreview.tramos.length > 0 && (
                <div className="mt-3 text-xs bg-background/60 rounded-md px-2.5 py-2 border border-border/40 space-y-1">
                  <p className="text-muted-foreground font-medium">Desglose por tramo</p>
                  {costPreview.tramos.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-muted-foreground">
                      <span className="truncate">{t.label}</span>
                      <span className="shrink-0 ml-2">{t.distanciaKm} km</span>
                    </div>
                  ))}
                </div>
              )}
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
