import React, { useState } from "react";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useCreateDispatch, getListDispatchesQueryKey
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck } from "lucide-react";

const dispatchSchema = z.object({
  vehiculoId: z.coerce.number().min(1, "Requerido"),
  choferId: z.coerce.number().min(1, "Requerido"),
  ayudanteId: z.coerce.number().optional(),
  fechaEstimadaSalida: z.string().min(1, "Requerido"),
  fechaEstimadaLlegada: z.string().min(1, "Requerido"),
  ruta: z.string().optional(),
  distanciaKm: z.coerce.number().min(1, "Requerido")
});

export default function PreDespacho() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedSale, setSelectedSale] = useState<any>(null);

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

  const createDispatchMutation = useCreateDispatch();

  const form = useForm<z.infer<typeof dispatchSchema>>({
    resolver: zodResolver(dispatchSchema),
    defaultValues: {
      vehiculoId: 0,
      choferId: 0,
      fechaEstimadaSalida: "",
      fechaEstimadaLlegada: "",
      ruta: "",
      distanciaKm: 0
    }
  });

  const watchedVehicleId = form.watch("vehiculoId");
  const watchedChoferId = form.watch("choferId");
  const watchedAyudanteId = form.watch("ayudanteId");
  const watchedDistancia = form.watch("distanciaKm");
  const watchedSalida = form.watch("fechaEstimadaSalida");
  const watchedLlegada = form.watch("fechaEstimadaLlegada");

  const selectedVehicle = vehicles?.find(v => v.id === Number(watchedVehicleId));
  const selectedChofer = personnel?.find(p => p.id === Number(watchedChoferId));
  const selectedAyudante = personnel?.find(p => p.id === Number(watchedAyudanteId));

  const dias = watchedSalida && watchedLlegada
    ? Math.max(1, Math.ceil((new Date(watchedLlegada).getTime() - new Date(watchedSalida).getTime()) / (1000 * 60 * 60 * 24)))
    : 1;

  const litros = selectedVehicle && watchedDistancia
    ? Number(watchedDistancia) / selectedVehicle.rendimientoKmLitro
    : 0;
  const costoCombustible = litros * 1.5;
  const costoViaticos = dias * ((selectedChofer?.tarifaViaticos ?? 0) + (selectedAyudante?.tarifaViaticos ?? 0));
  const totalEstimado = costoCombustible + costoViaticos;

  const onSubmit = (values: z.infer<typeof dispatchSchema>) => {
    if (!selectedSale) return;
    const payload = { ...values, ventaId: selectedSale.id };
    if (!payload.ayudanteId || payload.ayudanteId === 0) {
      delete (payload as any).ayudanteId;
    }
    createDispatchMutation.mutate({ data: payload }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDispatchesQueryKey() });
        setSelectedSale(null);
        toast({ title: "¡Despacho creado y aprobado correctamente!" });
      }
    });
  };

  const handleSelectSale = (sale: any) => {
    setSelectedSale(sale);
    const bestVehicle = vehicles?.find(v => v.capacidadPeso >= sale.pesoTotal && v.capacidadVolumen >= sale.volumenTotal);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    form.reset({
      vehiculoId: bestVehicle ? bestVehicle.id : (vehicles?.[0]?.id ?? 0),
      choferId: 0,
      fechaEstimadaSalida: today.toISOString().slice(0, 16),
      fechaEstimadaLlegada: tomorrow.toISOString().slice(0, 16),
      ruta: sale.destino,
      distanciaKm: 100
    });
  };

  const pendingSales = sales?.filter(s => s.estado === "pendiente") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Pre-Despacho</h1>
        <p className="text-muted-foreground">Autorizar envíos pendientes y asignar recursos.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Órdenes de Venta Pendientes</CardTitle>
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
                <TableHead className="w-[130px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingSales ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : pendingSales.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Sin ventas pendientes.</TableCell></TableRow>
              ) : pendingSales.map((sale) => (
                <TableRow key={sale.id} data-testid={`row-pending-sale-${sale.id}`}>
                  <TableCell className="font-medium">#{sale.id}</TableCell>
                  <TableCell>{sale.cliente}</TableCell>
                  <TableCell>{sale.destino}</TableCell>
                  <TableCell>{sale.pesoTotal} kg</TableCell>
                  <TableCell>{sale.volumenTotal} m³</TableCell>
                  <TableCell>
                    <Button data-testid={`button-process-sale-${sale.id}`} size="sm" onClick={() => handleSelectSale(sale)}>
                      Procesar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSale} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent className="sm:max-w-[700px]">
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
                    <FormControl><Input data-testid="input-distancia" type="number" {...field} /></FormControl>
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

              <div className="bg-primary/10 border border-primary/20 p-4 rounded-md">
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                  <Truck className="w-4 h-4" /> Estimación de Costos
                </h4>
                <div className="grid grid-cols-4 gap-3">
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
                    <div className="font-bold text-sm text-muted-foreground">Al guardar</div>
                  </div>
                  <div className="text-center p-2 bg-primary/20 rounded border border-primary/30">
                    <div className="text-xs text-muted-foreground">Total Est.</div>
                    <div className="font-bold text-sm text-primary">${totalEstimado.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button data-testid="button-approve-dispatch" type="submit" size="lg" className="w-full" disabled={createDispatchMutation.isPending}>
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
