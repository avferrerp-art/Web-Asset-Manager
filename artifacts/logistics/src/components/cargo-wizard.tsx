import React, { useEffect, useState } from "react";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useListSaleItems, getListSaleItemsQueryKey,
  useListProducts, getListProductsQueryKey,
  useLinkSaleItemProduct, getListUnlinkedSaleItemsQueryKey,
  useGetTraslado, getGetTrasladoQueryKey,
  useCreateDispatchBatch, getListDispatchesQueryKey,
  getListTrasladosQueryKey,
} from "@workspace/api-client-react";
import type {
  DispatchBatchError,
  DispatchInput,
  Vehicle,
  Sale,
  TrasladoSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toDatetimeLocal } from "@/lib/datetime-local";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Package, ClipboardList, Truck,
  Check, Unlink, Search, Loader2, AlertTriangle, ArrowRight,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  initialSaleId?: number;
  initialSale?: Sale;
  initialTrasladoId?: number;
  initialTraslado?: TrasladoSummary;
  onVehicleAssigned?: (saleId: number, vehicleId: number, estimates: DispatchCargoEstimates) => void;
  onTrasladoVehicleAssigned?: (traslado: TrasladoSummary, vehicleId: number, estimates: DispatchCargoEstimates) => void;
}

const STEPS = [
  { label: "Orden", icon: ClipboardList },
  { label: "Partidas", icon: Package },
  { label: "Flota", icon: Truck },
];

function utilColor(pct: number) {
  if (pct > 100) return "bg-red-500";
  if (pct >= 85) return "bg-yellow-500";
  return "bg-green-500";
}

function utilLabel(pct: number) {
  if (pct > 100) return "text-red-600 dark:text-red-400";
  if (pct >= 85) return "text-yellow-600 dark:text-yellow-400";
  return "text-green-600 dark:text-green-400";
}

import { formatCarga, sinDatoCarga } from "@/lib/carga";
import { classifyFleet } from "@/lib/fleet";
import {
  densidadImplausible,
  planFlotaSimultanea,
  planViajesSucesivos,
  type EstrategiaReparto,
  type PlanDeReparto as FleetSplitPlan,
} from "@/lib/fleet-split";
import {
  cargoEstimateDraftValid,
  DispatchCargoEstimateEditor,
  effectiveCargoMeasure,
  parsePositiveEstimate,
  type DispatchCargoEstimateDraft,
} from "@/components/dispatch-cargo-estimate-editor";

export interface DispatchCargoEstimates {
  pesoEstimadoKg?: number;
  volumenEstimadoM3?: number;
}

export function CargoWizard({
  open,
  onClose,
  initialSaleId,
  initialSale,
  initialTrasladoId,
  initialTraslado,
  onVehicleAssigned,
  onTrasladoVehicleAssigned,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const trasladoMode = initialTrasladoId != null;

  const [step, setStep] = useState(trasladoMode ? 3 : initialSaleId ? 2 : 1);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(initialSaleId ?? null);
  const [estimateDraft, setEstimateDraft] = useState<DispatchCargoEstimateDraft>({
    peso: "",
    volumen: "",
  });
  const [planStartedAt] = useState(() => new Date());
  const [driverAssignments, setDriverAssignments] = useState<Record<EstrategiaReparto, number[]>>({
    "flota-simultanea": [],
    "viajes-sucesivos": [],
  });
  const [batchError, setBatchError] = useState<{ message: string; tramoIndex?: number; estrategia?: EstrategiaReparto } | null>(null);

  const { data: salesData, isLoading: isLoadingSales } = useListSales(
    { status: "pendiente" },
    { query: { queryKey: getListSalesQueryKey({ status: "pendiente" }), enabled: !initialSaleId && !trasladoMode } }
  );

  const selectedSale: Sale | null = initialSale ?? salesData?.find(s => s.id === selectedSaleId) ?? null;
  const {
    data: trasladoDetail,
    isLoading: isLoadingTraslado,
    error: trasladoError,
  } = useGetTraslado(initialTrasladoId ?? 0, {
    query: {
      queryKey: getGetTrasladoQueryKey(initialTrasladoId ?? 0),
      enabled: trasladoMode && open,
    },
  });
  const selectedTraslado: TrasladoSummary | null = trasladoDetail ?? initialTraslado ?? null;

  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() },
  });
  const { data: personnel } = useListPersonnel({
    query: { queryKey: getListPersonnelQueryKey(), enabled: open },
  });
  const createBatch = useCreateDispatchBatch();

  const { data: saleItems, isLoading: isLoadingItems } = useListSaleItems(
    selectedSaleId ?? 0,
    {
      query: {
        queryKey: getListSaleItemsQueryKey(selectedSaleId ?? 0),
        enabled: !!selectedSaleId && !trasladoMode,
      },
    }
  );

  const linkItem = useLinkSaleItemProduct();

  // ── Manual product linking for unlinked items ──────────────────────────
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const trimmedLinkSearch = linkSearch.trim();
  const { data: linkResults, isLoading: isSearchingLink } = useListProducts(
    { search: trimmedLinkSearch },
    {
      query: {
        queryKey: getListProductsQueryKey({ search: trimmedLinkSearch }),
        enabled: linkingItemId !== null && trimmedLinkSearch.length > 0,
      },
    }
  );

  function invalidateItems() {
    if (selectedSaleId) {
      queryClient.removeQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
      queryClient.invalidateQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
    }
    queryClient.removeQueries({ queryKey: getListSalesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
  }

  function handleLinkProduct(itemId: number, productId: number) {
    linkItem.mutate({ itemId, data: { productId } }, {
      onSuccess: () => {
        setLinkingItemId(null);
        setLinkSearch("");
        invalidateItems();
        queryClient.removeQueries({ queryKey: getListUnlinkedSaleItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUnlinkedSaleItemsQueryKey() });
        toast({ title: "Artículo vinculado", description: "La partida quedó asociada al catálogo." });
      },
      onError: () => toast({ title: "No se pudo vincular la partida", variant: "destructive" }),
    });
  }

  const pendingSales = salesData?.filter(s => s.estado === "pendiente") ?? [];

  // Odoo siempre tiene precedencia. Ventas reinterpretan cero como ausencia;
  // traslados reservan null para ausencia.
  const pesoOdoo = trasladoMode
    ? selectedTraslado?.pesoCalculadoKg ?? null
    : sinDatoCarga(selectedSale?.pesoTotal) ? null : selectedSale!.pesoTotal!;
  const volumenOdoo = trasladoMode
    ? selectedTraslado?.volumenCalculadoM3 ?? null
    : sinDatoCarga(selectedSale?.volumenTotal) ? null : selectedSale!.volumenTotal!;
  const totalPeso = effectiveCargoMeasure(pesoOdoo, estimateDraft.peso, !trasladoMode);
  const totalVol = effectiveCargoMeasure(volumenOdoo, estimateDraft.volumen, !trasladoMode);
  const sinPeso = totalPeso == null;
  const sinVolumen = totalVol == null;

  // No reset diferido aquí: los call sites pasan una `key` basada en la orden
  // (ej. `cargo-${saleId ?? "none"}`), así que React remonta el componente con
  // el estado inicial correcto en cada apertura.
  function handleClose() {
    onClose();
  }

  // fleet.ts es la única fuente de verdad: los compatibles van primero,
  // ordenados del ajuste más apretado al más holgado (el primero es el
  // SUGERIDO). Dimensión sin dato → 0 (no restringe), pero la recomendación
  // se marca incompleta con el aviso de arriba.
  const fleetClass = classifyFleet(vehicles ?? [], totalPeso ?? 0, totalVol ?? 0);
  const rankedVehicles: Array<{
    vehicle: Vehicle;
    weightPct: number;
    volPct: number;
    maxPct: number;
    canFit: boolean;
  }> = [...fleetClass.fit, ...fleetClass.unfit].map(c => ({
    vehicle: c.vehicle as Vehicle,
    weightPct: c.weightPct,
    volPct: c.volPct,
    maxPct: c.maxPct,
    canFit: c.isFit,
  }));
  const needsSplit = (vehicles ?? []).length > 0 && fleetClass.fit.length === 0;
  const splitPeso = totalPeso ?? null;
  const splitVolumen = totalVol ?? null;
  const simultaneousPlan = planFlotaSimultanea(vehicles ?? [], splitPeso, splitVolumen);
  const successivePlan = planViajesSucesivos(vehicles ?? [], splitPeso, splitVolumen);
  const drivers = (personnel ?? []).filter(person => person.rol === "chofer");
  const densityWarning = needsSplit ? densidadImplausible(splitPeso, splitVolumen) : null;

  useEffect(() => {
    if (!needsSplit || personnel == null) return;
    setDriverAssignments(current => ({
      "flota-simultanea": simultaneousPlan.tramos.map((_, index) =>
        current["flota-simultanea"][index] ?? drivers[index]?.id ?? 0),
      "viajes-sucesivos": successivePlan.tramos.map((_, index) =>
        current["viajes-sucesivos"][index] ?? drivers[0]?.id ?? 0),
    }));
  }, [needsSplit, personnel, simultaneousPlan.tramos.length, successivePlan.tramos.length]);

  const sinDatos = sinPeso && sinVolumen;
  function currentEstimates(): DispatchCargoEstimates {
    const pesoEstimadoKg = parsePositiveEstimate(estimateDraft.peso);
    const volumenEstimadoM3 = parsePositiveEstimate(estimateDraft.volumen);
    return {
      ...(pesoEstimadoKg ? { pesoEstimadoKg } : {}),
      ...(volumenEstimadoM3 ? { volumenEstimadoM3 } : {}),
    };
  }

  function tramoWindow(estrategia: EstrategiaReparto, index: number) {
    const durationMs = 24 * 60 * 60 * 1000;
    const offset = estrategia === "viajes-sucesivos" ? index * durationMs : 0;
    return {
      salida: new Date(planStartedAt.getTime() + offset),
      llegada: new Date(planStartedAt.getTime() + offset + durationMs),
    };
  }

  function formatWindow(estrategia: EstrategiaReparto, index: number) {
    const { salida, llegada } = tramoWindow(estrategia, index);
    const format = (date: Date) => date.toLocaleString("es-VE", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
    return `${format(salida)} → ${format(llegada)}`;
  }

  function refreshOperationalLists() {
    const keys = [
      getListDispatchesQueryKey(),
      getListSalesQueryKey(),
      getListTrasladosQueryKey(),
    ];
    for (const queryKey of keys) {
      queryClient.removeQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey });
    }
    if (selectedTraslado) {
      const queryKey = getGetTrasladoQueryKey(selectedTraslado.id);
      queryClient.removeQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey });
    }
  }

  function createSplitPlan(plan: FleetSplitPlan<Vehicle>) {
    const assignments = driverAssignments[plan.estrategia];
    setBatchError(null);
    const tramos: DispatchInput[] = plan.tramos.map((tramo, index) => {
      const window = tramoWindow(plan.estrategia, index);
      const base = {
        vehiculoId: tramo.vehiculo.id,
        choferId: assignments[index],
        fechaEstimadaSalida: toDatetimeLocal(window.salida),
        fechaEstimadaLlegada: toDatetimeLocal(window.llegada),
        cargaParcial: true,
        pesoEstimadoKg: tramo.pesoKg,
        volumenEstimadoM3: tramo.volumenM3,
      };
      return trasladoMode && selectedTraslado
        ? { ...base, tipo: "traslado" as const, trasladoId: selectedTraslado.id }
        : { ...base, tipo: "venta" as const, ventaId: selectedSaleId! };
    });
    createBatch.mutate({ data: { tramos } }, {
      onSuccess: () => {
        refreshOperationalLists();
        toast({
          title: "Despachos parciales creados",
          description: `Se crearon ${tramos.length} despachos de forma atómica.`,
        });
        handleClose();
      },
      onError: (error) => {
        const data = (error as { data?: DispatchBatchError | null }).data;
        const message = data?.message || (error instanceof Error ? error.message : "El servidor rechazó la operación.");
        setBatchError({ message, tramoIndex: data?.tramoIndex, estrategia: plan.estrategia });
        toast({ title: "No se pudo crear el reparto", description: message, variant: "destructive" });
      },
    });
  }

  function renderSplitPlan(plan: FleetSplitPlan<Vehicle>, title: string, description: string) {
    const insufficientDrivers = plan.estrategia === "flota-simultanea"
      && plan.tramos.length > drivers.length;
    const missingDriver = plan.tramos.some((_, index) => !driverAssignments[plan.estrategia][index]);
    return (
      <div className="rounded-lg border bg-card p-4 space-y-4" data-testid={`split-plan-${plan.estrategia}`}>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {!plan.viable ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {plan.motivoNoViable}
          </div>
        ) : (
          <>
            {insufficientDrivers && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" data-testid="warning-insufficient-drivers">
                Se necesitan {plan.tramos.length} choferes distintos y solo hay {drivers.length} disponibles.
              </div>
            )}
            <div className="space-y-3">
              {plan.tramos.map((tramo, index) => {
                const highlighted = batchError?.estrategia === plan.estrategia && batchError.tramoIndex === index;
                const usedByOtherTramo = new Set(driverAssignments[plan.estrategia].filter((_, assignmentIndex) => assignmentIndex !== index));
                return (
                  <div key={`${tramo.vehiculo.id}-${index}`} className={`rounded-md border p-3 space-y-2 ${highlighted ? "border-destructive bg-destructive/5" : ""}`} data-testid={`split-tramo-${plan.estrategia}-${index}`}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{tramo.orden}. {tramo.vehiculo.modelo} · {tramo.vehiculo.placa}</span>
                      <span className="text-xs text-muted-foreground">
                        {tramo.pesoKg == null ? "peso sin dato" : `${tramo.pesoKg} kg`} · {tramo.volumenM3 == null ? "volumen sin dato" : `${tramo.volumenM3} m³`}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatWindow(plan.estrategia, index)}</p>
                    <Select
                      value={driverAssignments[plan.estrategia][index] ? String(driverAssignments[plan.estrategia][index]) : ""}
                      onValueChange={value => setDriverAssignments(current => ({
                        ...current,
                        [plan.estrategia]: plan.estrategia === "viajes-sucesivos"
                          ? current[plan.estrategia].map(() => Number(value))
                          : current[plan.estrategia].map((id, assignmentIndex) => assignmentIndex === index ? Number(value) : id),
                      }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-driver-${plan.estrategia}-${index}`}>
                        <SelectValue placeholder="Elegir chofer" />
                      </SelectTrigger>
                      <SelectContent>
                        {drivers.map(driver => (
                          <SelectItem
                            key={driver.id}
                            value={String(driver.id)}
                            disabled={plan.estrategia === "flota-simultanea" && usedByOtherTramo.has(driver.id)}
                          >
                            {driver.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {highlighted && <p className="text-xs text-destructive">{batchError.message}</p>}
                  </div>
                );
              })}
            </div>
            <Button
              className="w-full"
              disabled={createBatch.isPending || insufficientDrivers || missingDriver}
              onClick={() => createSplitPlan(plan)}
              data-testid={`button-create-${plan.estrategia}`}
            >
              {createBatch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Crear {plan.tramos.length} despachos
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className={`${needsSplit ? "sm:max-w-[1100px]" : "sm:max-w-[740px]"} grid-cols-[minmax(0,1fr)] max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className="text-lg">
            {trasladoMode
              ? `Planificar Carga — Traslado ${selectedTraslado?.referencia || `#${initialTrasladoId}`}`
              : "Planificar Carga"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        {!trasladoMode && <div className="flex items-center gap-0 mb-4">
          {STEPS.map((s, i) => {
            const idx = i + 1;
            const done = step > idx;
            const active = step === idx;
            const Icon = s.icon;
            return (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                    done ? "bg-primary border-primary text-primary-foreground"
                    : active ? "bg-primary/20 border-primary text-primary"
                    : "bg-muted border-border text-muted-foreground"
                  }`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className={`text-[11px] font-medium ${
                    active ? "text-primary" : done ? "text-primary/70" : "text-muted-foreground"
                  }`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-[2px] flex-1 mb-5 transition-colors ${step > idx ? "bg-primary" : "bg-border"}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>}

        {/* ── STEP 1: Select sale ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecciona la orden de venta pendiente a planificar.
            </p>
            {isLoadingSales ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />)}
              </div>
            ) : pendingSales.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No hay órdenes de venta pendientes.
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {pendingSales.map(sale => (
                  <button
                    key={sale.id}
                    onClick={() => setSelectedSaleId(sale.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedSaleId === sale.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-accent/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                          selectedSaleId === sale.id ? "border-primary bg-primary" : "border-border"
                        }`}>
                          {selectedSaleId === sale.id && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">#{sale.id} — {sale.cliente}</div>
                          <div className="text-xs text-muted-foreground truncate" title={sale.destino}>
                            {sale.destino}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatCarga(sale.pesoTotal, "kg")} · {formatCarga(sale.volumenTotal, "m³")}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 max-w-[120px] truncate block">{sale.tipoMaterial ?? "—"}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button disabled={!selectedSaleId} onClick={() => setStep(2)} className="gap-1">
                Siguiente <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Partidas (solo lectura + vincular al catálogo) ──────── */}
        {step === 2 && (
          <div className="space-y-4">
            {selectedSale && (
              <div className="bg-muted/60 rounded-md px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-semibold">Cliente:</span> {selectedSale.cliente}</span>
                <span><span className="font-semibold">Destino:</span> {selectedSale.destino}</span>
                <span><span className="font-semibold">Peso (Odoo):</span> {formatCarga(selectedSale.pesoTotal, "kg")}</span>
                <span><span className="font-semibold">Volumen (Odoo):</span> {formatCarga(selectedSale.volumenTotal, "m³")}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Partidas de la orden</h3>
              <span className="text-xs text-muted-foreground">
                El peso y volumen provienen de Odoo; aquí solo puedes vincular partidas al catálogo.
              </span>
            </div>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingItems ? (
                    <TableRow><TableCell colSpan={2} className="h-12 text-center text-sm text-muted-foreground">Cargando...</TableCell></TableRow>
                  ) : (saleItems ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-16 text-center text-sm text-muted-foreground">
                        Esta orden no tiene partidas registradas.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (saleItems ?? []).map(item => (
                      <React.Fragment key={item.id}>
                        <TableRow className="text-xs">
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{item.descripcion}</span>
                              {item.productId == null && (
                                <Badge
                                  variant="outline"
                                  className="text-purple-500 border-purple-500/50 bg-purple-500/10 text-[10px] gap-1 cursor-pointer"
                                  data-testid={`badge-item-sin-vincular-${item.id}`}
                                  onClick={() => {
                                    setLinkingItemId(linkingItemId === item.id ? null : item.id);
                                    setLinkSearch("");
                                  }}
                                >
                                  <Unlink className="w-3 h-3" /> Sin vincular
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{item.cantidad}</TableCell>
                        </TableRow>
                        {item.productId == null && linkingItemId === item.id && (
                          <TableRow className="bg-purple-500/5">
                            <TableCell colSpan={2} className="py-2">
                              <div className="space-y-2">
                                <div className="relative">
                                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    autoFocus
                                    data-testid={`input-link-search-${item.id}`}
                                    className="h-8 text-xs pl-8"
                                    placeholder="Buscar artículo por nombre o referencia..."
                                    value={linkSearch}
                                    onChange={e => setLinkSearch(e.target.value)}
                                  />
                                </div>
                                {trimmedLinkSearch.length > 0 && (
                                  <div className="max-h-44 overflow-y-auto rounded border divide-y">
                                    {isSearchingLink ? (
                                      <div className="p-2 text-xs text-muted-foreground flex items-center gap-2">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Buscando...
                                      </div>
                                    ) : (linkResults ?? []).length === 0 ? (
                                      <div className="p-2 text-xs text-muted-foreground">Sin resultados.</div>
                                    ) : (linkResults ?? []).slice(0, 20).map(p => (
                                      <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-xs">
                                        <div className="min-w-0">
                                          <div className="font-medium truncate">{p.nombre}</div>
                                          <div className="text-muted-foreground">
                                            {p.odooRef ?? "sin ref."}
                                            {p.pesoOdoo !== null ? ` · ${p.pesoOdoo} kg (Odoo)` : " · sin peso en Odoo"}
                                          </div>
                                        </div>
                                        <Button
                                          size="sm"
                                          className="h-7 text-xs shrink-0"
                                          data-testid={`button-link-${item.id}-${p.id}`}
                                          disabled={linkItem.isPending}
                                          onClick={() => handleLinkProduct(item.id, p.id)}
                                        >
                                          Asignar
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <DispatchCargoEstimateEditor
              pesoOdooKg={pesoOdoo}
              volumenOdooM3={volumenOdoo}
              draft={estimateDraft}
              onChange={setEstimateDraft}
              zeroMeansMissing
            />

            {/* Medidas efectivas para compatibilidad */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-md px-4 py-2.5 border border-border/50">
                <div className="text-xs text-muted-foreground">Peso efectivo</div>
                <div className="text-lg font-bold" data-testid="text-wizard-peso">
                  {totalPeso != null
                    ? <>{totalPeso} <span className="text-sm font-normal text-muted-foreground">kg</span></>
                    : <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">sin dato en Odoo</span>}
                </div>
              </div>
              <div className="bg-muted/50 rounded-md px-4 py-2.5 border border-border/50">
                <div className="text-xs text-muted-foreground">Volumen efectivo</div>
                <div className="text-lg font-bold" data-testid="text-wizard-volumen">
                  {totalVol != null
                    ? <>{totalVol} <span className="text-sm font-normal text-muted-foreground">m³</span></>
                    : <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">sin dato en Odoo</span>}
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              {!initialSaleId && (
                <Button variant="outline" onClick={() => setStep(1)} className="gap-1">
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </Button>
              )}
              <div className="flex-1" />
              <Button
                disabled={sinDatos || !cargoEstimateDraftValid(estimateDraft)}
                onClick={() => setStep(3)}
                className="gap-1"
                data-testid="button-wizard-flota"
              >
                Ver Compatibilidad <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {sinDatos && (
              <div className="flex items-start gap-2 text-xs bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2" data-testid="warning-wizard-sin-datos">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                Esta venta no tiene peso ni volumen en Odoo. Agrega al menos una
                estimación del despacho para poder comparar vehículos.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Fleet compatibility ─────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {trasladoMode && selectedTraslado && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4" data-testid="traslado-cargo-summary">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{selectedTraslado.referencia || `#${selectedTraslado.id}`}</span>
                  {selectedTraslado.cruzaPlaza && (
                    <Badge variant="outline" className="border-purple-500/50 bg-purple-500/10 text-purple-600 dark:text-purple-400">
                      Cruza Plaza
                    </Badge>
                  )}
                  {isLoadingTraslado && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Actualizando datos…
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Origen</p>
                    <p className="font-medium">{selectedTraslado.almacenOrigen?.nombre ?? "sin dato"}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Destino</p>
                    <p className="font-medium">{selectedTraslado.almacenDestino?.nombre ?? "sin dato"}</p>
                  </div>
                </div>
                <DispatchCargoEstimateEditor
                  pesoOdooKg={pesoOdoo}
                  volumenOdooM3={volumenOdoo}
                  draft={estimateDraft}
                  onChange={setEstimateDraft}
                  compact
                />
                {trasladoError && (
                  <p className="text-xs text-destructive">
                    {trasladoError instanceof Error ? trasladoError.message : "No se pudo actualizar el traslado."}
                  </p>
                )}
              </div>
            )}
            {trasladoMode && (sinPeso || sinVolumen) && (
              <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/40 rounded-md px-3 py-2" data-testid="warning-wizard-traslado-incompleto">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Dato faltante:</strong> este traslado no tiene {sinPeso && sinVolumen ? "peso ni volumen" : sinPeso ? "peso" : "volumen"} disponible.
                  La planificación puede continuar y la compatibilidad considera solamente las medidas conocidas.
                </span>
              </div>
            )}
            {!trasladoMode && (sinPeso || sinVolumen) && !sinDatos && (
              <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/40 rounded-md px-3 py-2" data-testid="warning-wizard-incompleta">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Recomendación incompleta:</strong> la venta no tiene {sinVolumen ? "volumen" : "peso"} en Odoo,
                  así que la compatibilidad considera solo {sinVolumen ? "el peso" : "el volumen"}. Verifica que la carga
                  quepa físicamente antes de despachar.
                </span>
              </div>
            )}
            {densityWarning && (
              <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/40 rounded-md px-3 py-2" data-testid="warning-density">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <span><strong>Revise las medidas:</strong> {densityWarning}. Densidad implícita: {(totalPeso! / totalVol!).toFixed(1)} kg/m³.</span>
              </div>
            )}
            {batchError && batchError.tramoIndex == null && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {batchError.message}
              </div>
            )}
            {(vehicles ?? []).length === 0 ? (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No hay vehículos registrados en la flota.
              </div>
            ) : needsSplit ? (
              <div className="grid gap-4 md:grid-cols-2" data-testid="split-plan-comparison">
                {renderSplitPlan(simultaneousPlan, "Flota simultánea", "Varios vehículos salen dentro de la misma ventana.")}
                {renderSplitPlan(successivePlan, "Viajes sucesivos", "Un vehículo repite salidas en ventanas consecutivas.")}
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {rankedVehicles.map(({ vehicle, weightPct, volPct, canFit }, idx) => {
                  const wPct = Number.isFinite(weightPct) ? weightPct : 100;
                  const vPct = Number.isFinite(volPct) ? volPct : 100;
                  return (
                    <div
                      key={vehicle.id}
                      className={`rounded-lg border p-4 space-y-3 ${
                        canFit && idx === 0 ? "border-primary bg-primary/5" : "border-border bg-card"
                      } ${!canFit ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm truncate">{vehicle.modelo}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{vehicle.placa}</span>
                          {canFit && idx === 0 && (
                            <Badge className="text-[10px] shrink-0" data-testid="cargo-badge-sugerido">
                              ⭐ SUGERIDO · {rankedVehicles[0].maxPct.toFixed(0)}% uso
                            </Badge>
                          )}
                        </div>
                        {canFit && ((onVehicleAssigned && selectedSaleId) || (onTrasladoVehicleAssigned && selectedTraslado)) && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 shrink-0"
                            onClick={() => {
                              if (trasladoMode && selectedTraslado && onTrasladoVehicleAssigned) {
                                onTrasladoVehicleAssigned(selectedTraslado, vehicle.id, currentEstimates());
                              } else if (selectedSaleId && onVehicleAssigned) {
                                onVehicleAssigned(selectedSaleId, vehicle.id, currentEstimates());
                              }
                              handleClose();
                            }}
                          >
                            <Check className="w-3 h-3" /> Asignar este vehículo
                          </Button>
                        )}
                      </div>

                      {/* Weight bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Peso: {sinPeso ? `sin dato${trasladoMode ? "" : " en Odoo"} — no considerado` : `${totalPeso!.toFixed(1)} / ${vehicle.capacidadPeso} kg${pesoOdoo == null ? " (estimado)" : " (Odoo)"}`}
                          </span>
                          {!sinPeso && <span className={`font-semibold ${utilLabel(weightPct)}`}>{weightPct.toFixed(0)}%</span>}
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${sinPeso ? "bg-muted-foreground/30" : utilColor(weightPct)}`}
                            style={{ width: `${sinPeso ? 0 : Math.min(wPct, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Volume bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Volumen: {sinVolumen ? `sin dato${trasladoMode ? "" : " en Odoo"} — no considerado` : `${totalVol!.toFixed(4)} / ${vehicle.capacidadVolumen} m³${volumenOdoo == null ? " (estimado)" : " (Odoo)"}`}
                          </span>
                          {!sinVolumen && <span className={`font-semibold ${utilLabel(volPct)}`}>{volPct.toFixed(0)}%</span>}
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${sinVolumen ? "bg-muted-foreground/30" : utilColor(volPct)}`}
                            style={{ width: `${sinVolumen ? 0 : Math.min(vPct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between pt-2">
              {!trasladoMode && (
                <Button variant="outline" onClick={() => setStep(2)} className="gap-1">
                  <ChevronLeft className="w-4 h-4" /> Ver Partidas
                </Button>
              )}
              <Button variant="ghost" onClick={handleClose}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
