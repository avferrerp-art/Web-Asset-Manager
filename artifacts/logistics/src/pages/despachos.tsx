import React, { useState } from "react";
import {
  useListDispatches, getListDispatchesQueryKey,
  useGetDispatch, getGetDispatchQueryKey,
  useUpdateDispatch,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useListRoutes, getListRoutesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Edit2, X, Save, Loader2, Search } from "lucide-react";
import { matchesSearch } from "@/lib/search";

const ESTADO_BADGE: Record<string, React.ReactElement> = {
  "pre-despacho": <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">Pre-Despacho</Badge>,
  "aprobado":     <Badge variant="outline" className="text-blue-500 border-blue-500/50">Aprobado</Badge>,
  "en-ruta":      <Badge variant="outline" className="text-indigo-500 border-indigo-500/50">En Ruta</Badge>,
  "entregado":    <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>,
  "cancelado":    <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>,
};

const editSchema = z.object({
  vehiculoId: z.coerce.number().min(1, "Requerido"),
  choferId: z.coerce.number().min(1, "Requerido"),
  ayudanteId: z.coerce.number().optional(),
  fechaEstimadaSalida: z.string().min(1, "Requerido"),
  fechaEstimadaLlegada: z.string().min(1, "Requerido"),
  ruta: z.string().optional(),
  distanciaKm: z.coerce.number().min(0).optional(),
  distanciaManual: z.boolean().optional(),
  estado: z.string().min(1, "Requerido"),
  routeId: z.coerce.number().optional(),
});

function toDatetimeLocal(val: string | null | undefined) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm py-1.5 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

function DispatchSheet({ dispatchId, onClose }: { dispatchId: number; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const { data: dispatch, isLoading } = useGetDispatch(dispatchId, {
    query: { queryKey: getGetDispatchQueryKey(dispatchId) }
  });

  const { data: vehicles } = useListVehicles({ query: { queryKey: getListVehiclesQueryKey() } });
  const { data: personnel } = useListPersonnel({ query: { queryKey: getListPersonnelQueryKey() } });
  const { data: routes } = useListRoutes({ query: { queryKey: getListRoutesQueryKey() } });

  const updateMutation = useUpdateDispatch();

  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      vehiculoId: 0,
      choferId: 0,
      ayudanteId: 0,
      fechaEstimadaSalida: "",
      fechaEstimadaLlegada: "",
      ruta: "",
      distanciaKm: 0,
      estado: "pre-despacho",
      routeId: undefined,
    }
  });

  const watchedVehicleId = form.watch("vehiculoId");
  const watchedRouteId = form.watch("routeId");

  const watchedDistanciaManual = form.watch("distanciaManual");

  const selectedVehicle = vehicles?.find(v => v.id === watchedVehicleId);
  const selectedRoute = routes?.find(r => r.id === watchedRouteId);
  const calculatedTotalPeajes =
    selectedRoute != null ? selectedRoute.costoPeajesTotal ?? 0 : null;

  const startEditing = () => {
    if (!dispatch) return;
    form.reset({
      vehiculoId: dispatch.vehiculoId,
      choferId: dispatch.choferId,
      ayudanteId: dispatch.ayudanteId ?? 0,
      fechaEstimadaSalida: toDatetimeLocal(dispatch.fechaEstimadaSalida),
      fechaEstimadaLlegada: toDatetimeLocal(dispatch.fechaEstimadaLlegada),
      ruta: dispatch.ruta ?? "",
      distanciaKm: dispatch.distanciaKm ?? 0,
      distanciaManual: dispatch.distanciaManual ?? false,
      estado: dispatch.estado,
      routeId: dispatch.routeId ?? undefined,
    });
    setIsEditing(true);
  };

  React.useEffect(() => {
    if (!isEditing || watchedDistanciaManual) return;
    if (selectedRoute?.distanciaTotalKm != null) {
      form.setValue("distanciaKm", selectedRoute.distanciaTotalKm, { shouldDirty: true });
    }
  }, [selectedRoute, isEditing, watchedDistanciaManual]);

  const onSubmit = (values: z.infer<typeof editSchema>) => {
    const payload: Record<string, unknown> = { ...values };
    if (!payload.ayudanteId || payload.ayudanteId === 0) delete payload.ayudanteId;
    if (!payload.routeId || payload.routeId === 0) delete payload.routeId;
    if (payload.distanciaManual === undefined) delete payload.distanciaManual;
    if (calculatedTotalPeajes != null) payload.totalPeajes = calculatedTotalPeajes;
    updateMutation.mutate(
      { id: dispatchId, data: payload as Parameters<typeof updateMutation.mutate>[0]["data"] },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDispatchesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDispatchQueryKey(dispatchId) });
          setIsEditing(false);
          toast({ title: "Despacho actualizado correctamente" });
        }
      }
    );
  };

  return (
    <SheetContent className="sm:max-w-[480px] overflow-y-auto">
      <SheetHeader className="pb-4">
        <div className="flex items-center justify-between">
          <SheetTitle>Despacho #{dispatchId}</SheetTitle>
          <div className="flex gap-2">
            {!isEditing && (
              <Button size="sm" variant="outline" onClick={startEditing} disabled={isLoading}>
                <Edit2 className="w-3.5 h-3.5 mr-1" /> Editar
              </Button>
            )}
          </div>
        </div>
      </SheetHeader>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !dispatch ? (
        <p className="text-muted-foreground text-sm">No se pudo cargar el despacho.</p>
      ) : isEditing ? (
        /* ── EDIT MODE ── */
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <FormField control={form.control} name="estado" render={({ field }) => (
              <FormItem>
                <FormLabel>Estado</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="pre-despacho">Pre-Despacho</SelectItem>
                    <SelectItem value="aprobado">Aprobado</SelectItem>
                    <SelectItem value="en-ruta">En Ruta</SelectItem>
                    <SelectItem value="entregado">Entregado</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="vehiculoId" render={({ field }) => (
              <FormItem>
                <FormLabel>Vehículo</FormLabel>
                <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Seleccionar vehículo" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {vehicles?.map(v => (
                      <SelectItem key={v.id} value={v.id.toString()}>
                        {v.modelo} — {v.capacidadPeso}kg{v.tipo === "tercero" ? " [Tercero]" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="choferId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Chofer</FormLabel>
                  <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Chofer" /></SelectTrigger>
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
                  <FormLabel>Ayudante</FormLabel>
                  <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString() ?? "0"}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Ayudante" /></SelectTrigger>
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

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="fechaEstimadaSalida" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha Salida</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="fechaEstimadaLlegada" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha Llegada</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="ruta" render={({ field }) => (
              <FormItem>
                <FormLabel>Ruta</FormLabel>
                <FormControl><Input placeholder="Descripción de la ruta" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="distanciaKm" render={({ field }) => (
              <FormItem>
                <FormLabel>Distancia (km)</FormLabel>
                <FormControl><Input type="number" {...field} disabled={!!selectedRoute && !watchedDistanciaManual} /></FormControl>
                {selectedRoute && !watchedDistanciaManual && (
                  <p className="text-xs text-muted-foreground">Calculada automáticamente desde la ruta seleccionada.</p>
                )}
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="distanciaManual" render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="!mt-0 font-normal">Ajustar distancia manualmente</FormLabel>
              </FormItem>
            )} />

            <FormField control={form.control} name="routeId" render={({ field }) => (
              <FormItem>
                <FormLabel>Ruta predefinida <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                <Select
                  onValueChange={(v) => field.onChange(v === "0" ? undefined : parseInt(v))}
                  value={field.value?.toString() ?? "0"}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Sin ruta asignada" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="0">Sin ruta asignada</SelectItem>
                    {routes?.map(r => (
                      <SelectItem key={r.id} value={r.id.toString()}>
                        {r.nombre} — {r.origen} → {r.destino}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {calculatedTotalPeajes != null && (
              <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-md px-3 py-2 border border-border/50">
                <span className="text-muted-foreground">Peajes calculados:</span>
                <span className="font-semibold text-foreground">
                  ${calculatedTotalPeajes.toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">
                  (suma de {selectedRoute?.tolls.length} caseta{selectedRoute?.tolls.length !== 1 ? "s" : ""} de la ruta
                  {selectedRoute?.tipo === "redondo" ? ", ida y vuelta" : ""})
                </span>
              </div>
            )}
            {selectedRoute && selectedRoute.tipo !== "sencillo" && selectedRoute.tramos && selectedRoute.tramos.length > 0 && (
              <div className="text-xs bg-muted/30 rounded-md px-3 py-2 border border-border/40 space-y-1">
                <p className="text-muted-foreground font-medium">Desglose por tramo</p>
                {selectedRoute.tramos.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-muted-foreground">
                    <span className="truncate">{t.label}</span>
                    <span className="shrink-0 ml-2">{t.distanciaKm} km</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                Guardar Cambios
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsEditing(false)} disabled={updateMutation.isPending}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        /* ── VIEW MODE ── */
        <div className="space-y-1 pt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-3">Información general</p>
          <DetailRow label="Estado" value={ESTADO_BADGE[dispatch.estado] ?? <Badge>{dispatch.estado}</Badge>} />
          <DetailRow label="Cliente" value={dispatch.clienteNombre} />
          <DetailRow label="Destino" value={dispatch.destino} />
          <DetailRow label="Ruta" value={dispatch.ruta} />
          <DetailRow
            label="Distancia"
            value={dispatch.distanciaKm ? `${dispatch.distanciaKm} km${dispatch.distanciaManual ? " (manual)" : ""}` : null}
          />
          {dispatch.routeId && (
            <DetailRow
              label="Ruta predefinida"
              value={routes?.find(r => r.id === dispatch.routeId)?.nombre ?? `Ruta #${dispatch.routeId}`}
            />
          )}
          {dispatch.totalPeajes != null && (
            <DetailRow label="Total peajes" value={`$${Number(dispatch.totalPeajes).toFixed(2)}`} />
          )}

          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mt-5 mb-3 pt-3 border-t border-border">Recursos asignados</p>
          <DetailRow label="Vehículo" value={dispatch.vehiculoModelo} />
          <DetailRow label="Chofer" value={dispatch.choferNombre} />
          <DetailRow label="Ayudante" value={dispatch.ayudanteNombre} />

          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mt-5 mb-3 pt-3 border-t border-border">Fechas</p>
          <DetailRow label="Salida estimada" value={new Date(dispatch.fechaEstimadaSalida).toLocaleString("es-MX")} />
          <DetailRow label="Llegada estimada" value={new Date(dispatch.fechaEstimadaLlegada).toLocaleString("es-MX")} />
          <DetailRow label="Creado el" value={new Date(dispatch.createdAt).toLocaleDateString("es-MX")} />

          {dispatch.costs && (
            <>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mt-5 mb-3 pt-3 border-t border-border">Costos</p>
              <DetailRow label="Combustible" value={dispatch.costs.costoCombustible != null ? `$${Number(dispatch.costs.costoCombustible).toFixed(2)}` : null} />
              <DetailRow label="Viáticos" value={dispatch.costs.costoViaticos != null ? `$${Number(dispatch.costs.costoViaticos).toFixed(2)}` : null} />
              <DetailRow label="Peajes" value={dispatch.costs.costoPeajes != null ? `$${Number(dispatch.costs.costoPeajes).toFixed(2)}` : null} />
              <DetailRow label="Total" value={dispatch.costs.total != null ? `$${Number(dispatch.costs.total).toFixed(2)}` : null} />
            </>
          )}

          {dispatch.routePoints && dispatch.routePoints.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mt-5 mb-3 pt-3 border-t border-border">Puntos de ruta</p>
              {dispatch.routePoints.map((pt, i) => (
                <DetailRow key={pt.id} label={`Parada ${i + 1}`} value={pt.ubicacion} />
              ))}
            </>
          )}
        </div>
      )}
    </SheetContent>
  );
}

export default function Despachos() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: dispatches, isLoading } = useListDispatches(undefined, {
    query: { queryKey: getListDispatchesQueryKey(), refetchInterval: 30_000 }
  });

  const { data: vehiclesList } = useListVehicles({ query: { queryKey: getListVehiclesQueryKey() } });

  const filteredDispatches = search.trim()
    ? (dispatches ?? []).filter(d => {
        const vehicle = vehiclesList?.find(v => v.id === d.vehiculoId);
        return matchesSearch(search, [
          d.clienteNombre, d.destino, d.choferNombre,
          d.vehiculoModelo, vehicle?.placa, d.id, `#${d.id}`,
        ]);
      })
    : (dispatches ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Despachos</h1>
        <p className="text-muted-foreground">Historial y estado actual de todos los despachos.</p>
      </div>

      <div className="relative flex-1 min-w-[220px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, destino, chofer o vehículo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
          data-testid="input-search-dispatches"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Vehículo</TableHead>
                <TableHead>Chofer / Ayudante</TableHead>
                <TableHead>Cliente / Destino</TableHead>
                <TableHead>Fechas</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : filteredDispatches.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {search.trim() ? `Sin resultados para "${search.trim()}"` : "Sin despachos registrados."}
                </TableCell></TableRow>
              ) : filteredDispatches.map((dispatch) => (
                <TableRow
                  key={dispatch.id}
                  data-testid={`row-dispatch-${dispatch.id}`}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedId(dispatch.id)}
                >
                  <TableCell className="font-medium">#{dispatch.id}</TableCell>
                  <TableCell>{dispatch.vehiculoModelo}</TableCell>
                  <TableCell>
                    <div className="text-sm">{dispatch.choferNombre}</div>
                    <div className="text-xs text-muted-foreground">{dispatch.ayudanteNombre || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{dispatch.clienteNombre}</div>
                    <div className="text-xs text-muted-foreground">{dispatch.destino}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">Salida: {new Date(dispatch.fechaEstimadaSalida).toLocaleDateString("es-MX")}</div>
                    <div className="text-xs text-muted-foreground">Llegada: {new Date(dispatch.fechaEstimadaLlegada).toLocaleDateString("es-MX")}</div>
                  </TableCell>
                  <TableCell>{ESTADO_BADGE[dispatch.estado] ?? <Badge>{dispatch.estado}</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={selectedId !== null} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        {selectedId !== null && (
          <DispatchSheet dispatchId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </Sheet>
    </div>
  );
}
