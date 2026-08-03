import React, { useEffect, useState } from "react";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useListRoutes, getListRoutesQueryKey,
  useListDispatches,
  useCreateDispatch, getListDispatchesQueryKey,
  useEstimateDispatchCostsPreview,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Route as RouteIcon, Plus, AlertTriangle, MapPin, RefreshCw, ExternalLink, PackageSearch, Search } from "lucide-react";
import { matchesSearch } from "@/lib/search";
import { useLocation } from "wouter";
import { NuevoDespachoWizard } from "@/components/nuevo-despacho-wizard";
import { CargoWizard } from "@/components/cargo-wizard";
import { OdooSyncCard, OdooBadge } from "@/components/odoo-sync-card";

const dispatchSchema = z.object({
  vehiculoId: z.coerce.number().min(1, "Requerido"),
  choferId: z.coerce.number().min(1, "Requerido"),
  ayudanteId: z.coerce.number().optional(),
  fechaEstimadaSalida: z.string().min(1, "Requerido"),
  fechaEstimadaLlegada: z.string().min(1, "Requerido"),
  ruta: z.string().optional(),
  distanciaKm: z.coerce.number().min(1, "Requerido"),
  distanciaManual: z.boolean().optional(),
  routeId: z.coerce.number().optional(),
});

function fmtDateShort(s: string) {
  return new Date(s).toLocaleDateString("es-VE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function PreDespacho() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [cargoWizardOpen, setCargoWizardOpen] = useState(false);
  const [cargoWizardSaleId, setCargoWizardSaleId] = useState<number | undefined>();
  const [cargoWizardSale, setCargoWizardSale] = useState<any>(null);
  const [search, setSearch] = useState("");

  const { data: sales, isLoading: isLoadingSales } = useListSales(
    { status: "pendiente" },
    { query: { queryKey: getListSalesQueryKey({ status: "pendiente" }), refetchInterval: 30_000 } }
  );

  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() }
  });

  const { data: personnel } = useListPersonnel({
    query: { queryKey: getListPersonnelQueryKey() }
  });

  const { data: routes } = useListRoutes({
    query: { queryKey: getListRoutesQueryKey() }
  });

  const { data: allDispatches } = useListDispatches(undefined, {
    query: { queryKey: getListDispatchesQueryKey() }
  });

  const createDispatchMutation = useCreateDispatch();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pendingDispatch");
      if (raw) {
        sessionStorage.removeItem("pendingDispatch");
        const { saleId, vehicleId } = JSON.parse(raw) as { saleId: number; vehicleId: number };
        const sale = sales?.find(s => s.id === saleId);
        if (sale) handleSelectSale(sale, vehicleId);
      }
    } catch {}
  }, [sales]);

  const form = useForm<z.infer<typeof dispatchSchema>>({
    resolver: zodResolver(dispatchSchema),
    defaultValues: {
      vehiculoId: 0,
      choferId: 0,
      fechaEstimadaSalida: "",
      fechaEstimadaLlegada: "",
      ruta: "",
      distanciaKm: 0,
      distanciaManual: false,
      routeId: undefined,
    }
  });

  const watchedVehicleId = form.watch("vehiculoId");
  const watchedChoferId = form.watch("choferId");
  const watchedAyudanteId = form.watch("ayudanteId");
  const watchedDistancia = form.watch("distanciaKm");
  const watchedDistanciaManual = form.watch("distanciaManual");
  const watchedSalida = form.watch("fechaEstimadaSalida");
  const watchedLlegada = form.watch("fechaEstimadaLlegada");
  const watchedRouteId = form.watch("routeId");

  const selectedVehicle = vehicles?.find(v => v.id === Number(watchedVehicleId));
  const selectedChofer = personnel?.find(p => p.id === Number(watchedChoferId));
  const selectedAyudante = personnel?.find(p => p.id === Number(watchedAyudanteId));
  const selectedRoute = routes?.find(r => r.id === Number(watchedRouteId));

  const dias = watchedSalida && watchedLlegada
    ? Math.max(1, Math.ceil((new Date(watchedLlegada).getTime() - new Date(watchedSalida).getTime()) / (1000 * 60 * 60 * 24)))
    : 1;

  const estimateCosts = useEstimateDispatchCostsPreview();
  const [costPreview, setCostPreview] = useState<{
    costoCombustible: number;
    costoViaticos: number;
    costoPeajes: number;
    total: number;
    litrosEstimados: number;
    tramos?: { label: string; distanciaKm: number }[];
  } | null>(null);

  useEffect(() => {
    const vehiculoId = Number(watchedVehicleId);
    const choferId = Number(watchedChoferId);
    const distanciaKm = Number(watchedDistancia);
    if (!vehiculoId || !choferId || !distanciaKm || !watchedSalida || !watchedLlegada) {
      setCostPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      estimateCosts.mutate(
        {
          data: {
            vehiculoId,
            choferId,
            ayudanteId: watchedAyudanteId ? Number(watchedAyudanteId) : undefined,
            fechaEstimadaSalida: watchedSalida,
            fechaEstimadaLlegada: watchedLlegada,
            distanciaKm,
            routeId: watchedRouteId ? Number(watchedRouteId) : undefined,
          },
        },
        { onSuccess: (data) => setCostPreview(data) }
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [watchedVehicleId, watchedChoferId, watchedAyudanteId, watchedDistancia, watchedDistanciaManual, watchedRouteId, watchedSalida, watchedLlegada]);

  const litros = costPreview?.litrosEstimados ?? 0;
  const costoCombustible = costPreview?.costoCombustible ?? 0;
  const precioPorLitro = litros > 0 ? costoCombustible / litros : 0;
  const costoViaticos = costPreview?.costoViaticos ?? 0;
  const costoPeajes = costPreview ? costPreview.costoPeajes : null;
  const totalEstimado = costPreview?.total ?? 0;

  const BUSY_STATES = ["pre-despacho", "aprobado", "en-ruta"];
  const vehicleConflict = (() => {
    if (!watchedVehicleId || !watchedSalida || !watchedLlegada || !allDispatches) return null;
    const newStart = new Date(watchedSalida).getTime();
    const newEnd = new Date(watchedLlegada).getTime();
    return allDispatches.find(d =>
      d.vehiculoId === Number(watchedVehicleId) &&
      BUSY_STATES.includes(d.estado) &&
      newStart < new Date(d.fechaEstimadaLlegada).getTime() &&
      newEnd > new Date(d.fechaEstimadaSalida).getTime()
    ) ?? null;
  })();

  const onSubmit = (values: z.infer<typeof dispatchSchema>) => {
    if (!selectedSale) return;
    const payload: Record<string, unknown> = { ...values, ventaId: selectedSale.id };
    if (!payload.ayudanteId || payload.ayudanteId === 0) delete payload.ayudanteId;
    if (!payload.routeId || payload.routeId === 0) {
      delete payload.routeId;
    } else if (costoPeajes != null) {
      payload.totalPeajes = costoPeajes;
    }
    if (payload.distanciaManual === undefined) delete payload.distanciaManual;
    createDispatchMutation.mutate({ data: payload as unknown as Parameters<typeof createDispatchMutation.mutate>[0]["data"] }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDispatchesQueryKey() });
        setSelectedSale(null);
        toast({ title: "¡Despacho creado y aprobado correctamente!" });
      }
    });
  };

  const handleSelectSale = (sale: any, overrideVehicleId?: number) => {
    setSelectedSale(sale);
    const bestVehicle = overrideVehicleId
      ? vehicles?.find(v => v.id === overrideVehicleId)
      : vehicles?.find(v => v.capacidadPeso >= sale.pesoTotal && v.capacidadVolumen >= sale.volumenTotal);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const matchingRoute = routes?.find(r =>
      r.destino.toLowerCase().includes(sale.destino.toLowerCase()) ||
      sale.destino.toLowerCase().includes(r.destino.toLowerCase())
    );

    form.reset({
      vehiculoId: bestVehicle ? bestVehicle.id : (vehicles?.[0]?.id ?? 0),
      choferId: 0,
      fechaEstimadaSalida: today.toISOString().slice(0, 16),
      fechaEstimadaLlegada: tomorrow.toISOString().slice(0, 16),
      ruta: sale.destino,
      distanciaKm: matchingRoute?.distanciaTotalKm ?? 100,
      routeId: matchingRoute?.id ?? undefined,
    });
  };

  // Ventas con despacho ya creado (en cualquier estado activo) no deben aparecer aquí,
  // incluso si su estado quedara en "pendiente" por alguna inconsistencia.
  const salesWithDispatch = new Set(
    (allDispatches ?? [])
      .filter(d => d.estado !== "cancelado")
      .map(d => d.ventaId)
  );
  const allPendingSales = (sales ?? []).filter(
    s => s.estado === "pendiente" && !salesWithDispatch.has(s.id)
  );
  const pendingSales = search.trim()
    ? allPendingSales.filter(s =>
        matchesSearch(search, [s.cliente, s.destino, s.odooRef, s.id, `#${s.id}`]))
    : allPendingSales;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Pre-Despacho</h1>
          <p className="text-muted-foreground" data-testid="text-predespacho-subtitle">
            Asigna vehículo, chofer y ruta a los pedidos pendientes para convertirlos en despachos.
          </p>
        </div>
        <Button
          data-testid="button-nuevo-despacho-predespacho"
          onClick={() => setWizardOpen(true)}
          className="gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> Nuevo Despacho
        </Button>
      </div>
      <NuevoDespachoWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <CargoWizard
        open={cargoWizardOpen}
        onClose={() => { setCargoWizardOpen(false); setCargoWizardSaleId(undefined); setCargoWizardSale(null); }}
        initialSaleId={cargoWizardSaleId}
        initialSale={cargoWizardSale}
        onVehicleAssigned={(saleId, vehicleId) => {
          const sale = cargoWizardSale ?? sales?.find(s => s.id === saleId);
          if (sale) handleSelectSale(sale, vehicleId);
        }}
      />

      <OdooSyncCard />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Órdenes de Venta por Planificar</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Cada fila es un pedido esperando acción: planifica la carga o procésalo para crear su despacho.
              </p>
            </div>
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente, destino, referencia o #orden..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
                data-testid="input-search-predespacho"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>Volumen</TableHead>
                <TableHead className="w-[220px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingSales ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : pendingSales.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center">
                  {search.trim() ? (
                    <span className="text-muted-foreground">Sin resultados para "{search.trim()}"</span>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-2" data-testid="empty-state-predespacho">
                      <PackageSearch className="w-8 h-8 text-muted-foreground/50" />
                      <p className="font-medium text-foreground">No hay pedidos pendientes de planificar</p>
                      <p className="text-sm text-muted-foreground max-w-md">
                        Todas las órdenes de venta pendientes ya tienen despacho creado. Las nuevas ventas en estado "Pendiente" aparecerán aquí automáticamente.
                      </p>
                    </div>
                  )}
                </TableCell></TableRow>
              ) : pendingSales.map((sale) => (
                <TableRow key={sale.id} data-testid={`row-pending-sale-${sale.id}`}>
                  <TableCell className="font-medium">
                    #{sale.id}
                    <OdooBadge odooRef={sale.odooRef} />
                  </TableCell>
                  <TableCell>{sale.cliente}</TableCell>
                  <TableCell>{sale.destino}</TableCell>
                  <TableCell>{sale.pesoTotal} kg</TableCell>
                  <TableCell>{sale.volumenTotal} m³</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        data-testid={`button-cargo-plan-${sale.id}`}
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => { setCargoWizardSaleId(sale.id); setCargoWizardSale(sale); setCargoWizardOpen(true); }}
                      >
                        <PackageSearch className="w-3.5 h-3.5" /> Planificar
                      </Button>
                      <Button
                        data-testid={`button-process-sale-${sale.id}`}
                        size="sm"
                        className="gap-1 font-semibold shadow-sm"
                        onClick={() => handleSelectSale(sale)}
                      >
                        <Truck className="w-3.5 h-3.5" /> Crear Despacho
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSale} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar Despacho — Orden #{selectedSale?.id}</DialogTitle>
          </DialogHeader>

          {selectedSale && (
            <div className="bg-muted p-3 rounded-md flex gap-4 text-sm flex-wrap">
              <div><span className="font-semibold">Cliente:</span> {selectedSale.cliente}</div>
              <div><span className="font-semibold">Destino:</span> {selectedSale.destino}</div>
              <div><span className="font-semibold">Peso:</span> {selectedSale.pesoTotal} kg</div>
              <div><span className="font-semibold">Volumen:</span> {selectedSale.volumenTotal} m³</div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* Ruta predefinida */}
              <FormField control={form.control} name="routeId" render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <RouteIcon className="w-3.5 h-3.5" />
                    Ruta predefinida <span className="text-muted-foreground font-normal">(opcional)</span>
                  </FormLabel>
                  <Select
                    onValueChange={(v) => {
                      const id = v === "0" ? undefined : parseInt(v);
                      field.onChange(id);
                      if (id && !form.getValues("distanciaManual")) {
                        const route = routes?.find(r => r.id === id);
                        if (route?.distanciaTotalKm) {
                          form.setValue("distanciaKm", route.distanciaTotalKm);
                        }
                      }
                    }}
                    value={field.value?.toString() ?? "0"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-ruta">
                        <SelectValue placeholder="Sin ruta asignada" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="0">Sin ruta asignada</SelectItem>
                      {routes?.map(r => (
                        <SelectItem key={r.id} value={r.id.toString()}>
                          {r.nombre ? `${r.nombre} — ` : ""}{r.origen} → {r.destino}
                          {r.tolls?.length ? ` (${r.tolls.length} caseta${r.tolls.length !== 1 ? "s" : ""})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="vehiculoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehículo</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger data-testid="select-vehiculo"><SelectValue placeholder="Seleccionar vehículo" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {vehicles?.map(v => (
                          <SelectItem key={v.id} value={v.id.toString()}>
                            {v.modelo} — {v.capacidadPeso}kg / {v.capacidadVolumen}m³ {v.tipo === "tercero" ? "[Tercero]" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="distanciaKm" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Distancia Estimada (km)</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-distancia"
                        type="number"
                        {...field}
                        disabled={!!selectedRoute && !watchedDistanciaManual}
                      />
                    </FormControl>
                    {selectedRoute && (
                      <FormField control={form.control} name="distanciaManual" render={({ field: manualField }) => (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                          <Checkbox
                            checked={manualField.value ?? false}
                            onCheckedChange={(checked) => {
                              manualField.onChange(checked === true);
                              if (checked !== true && selectedRoute.distanciaTotalKm != null) {
                                form.setValue("distanciaKm", selectedRoute.distanciaTotalKm);
                              }
                            }}
                          />
                          Ajustar manualmente
                        </label>
                      )} />
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="choferId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chofer</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger data-testid="select-chofer"><SelectValue placeholder="Seleccionar chofer" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {personnel?.filter(p => p.rol === "chofer").map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ayudanteId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ayudante (Opcional)</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString() || "0"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-ayudante"><SelectValue placeholder="Seleccionar ayudante" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="0">Ninguno</SelectItem>
                        {personnel?.filter(p => p.rol === "ayudante").map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="fechaEstimadaSalida" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de Salida</FormLabel>
                    <FormControl><Input data-testid="input-salida" type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="fechaEstimadaLlegada" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de Llegada</FormLabel>
                    <FormControl><Input data-testid="input-llegada" type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
                        onClick={() => form.setValue("vehiculoId", 0)}
                      >
                        <RefreshCw className="w-3 h-3" /> Cambiar vehículo
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={sameDestino ? "secondary" : "ghost"}
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => navigate("/despachos")}
                      >
                        <ExternalLink className="w-3 h-3" /> Ver despacho #{vehicleConflict.id}
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* Detalle de casetas cuando hay ruta seleccionada */}
              {selectedRoute && costoPeajes != null && (
                <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-md px-3 py-2 border border-border/50">
                  <RouteIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Peajes calculados:</span>
                  <span className="font-semibold" data-testid="toll-cost-display">${costoPeajes.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground">
                    (suma de {selectedRoute.tolls?.length ?? 0} caseta{(selectedRoute.tolls?.length ?? 0) !== 1 ? "s" : ""} de la ruta
                    {selectedRoute.tipo === "redondo" ? ", ida y vuelta" : ""})
                  </span>
                </div>
              )}

              {/* Desglose por tramo en rutas multidestino/redondo */}
              {selectedRoute && selectedRoute.tipo !== "sencillo" && costPreview?.tramos && costPreview.tramos.length > 0 && (
                <div className="text-xs bg-muted/30 rounded-md px-3 py-2 border border-border/40 space-y-1">
                  <p className="text-muted-foreground font-medium">Desglose por tramo</p>
                  {costPreview.tramos.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-muted-foreground">
                      <span className="truncate">{t.label}</span>
                      <span className="shrink-0 ml-2">{t.distanciaKm} km</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-primary/10 border border-primary/20 p-4 rounded-md">
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                  <Truck className="w-4 h-4" /> Estimación de Costos
                </h4>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center p-2 bg-background rounded border border-border">
                    <div className="text-xs text-muted-foreground">Combustible</div>
                    <div className="font-bold text-sm">${costoCombustible.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">{litros.toFixed(1)} L · ${precioPorLitro.toFixed(2)}/L</div>
                  </div>
                  <div className="text-center p-2 bg-background rounded border border-border">
                    <div className="text-xs text-muted-foreground">Viáticos</div>
                    <div className="font-bold text-sm">${costoViaticos.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">{dias} día(s)</div>
                  </div>
                  <div className="text-center p-2 bg-background rounded border border-border">
                    <div className="text-xs text-muted-foreground">Peajes</div>
                    {costoPeajes != null ? (
                      <>
                        <div className="font-bold text-sm" data-testid="toll-cost-summary">${costoPeajes.toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">{selectedRoute?.tolls?.length ?? 0} caseta(s)</div>
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

              <div className="flex justify-end pt-2">
                <Button data-testid="button-approve-dispatch" type="submit" size="lg" className="w-full" disabled={createDispatchMutation.isPending || !!vehicleConflict}>
                  {createDispatchMutation.isPending ? "Procesando..." : "Aprobar Despacho"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
