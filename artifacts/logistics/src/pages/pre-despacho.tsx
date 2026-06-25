import React, { useState } from "react";
import { 
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListPersonnel, getListPersonnelQueryKey,
  useCreateDispatch
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CalendarIcon, MapPin, Truck } from "lucide-react";

const dispatchSchema = z.object({
  vehiculoId: z.coerce.number().min(1, "Required"),
  choferId: z.coerce.number().min(1, "Required"),
  ayudanteId: z.coerce.number().optional(),
  fechaEstimadaSalida: z.string().min(1, "Required"),
  fechaEstimadaLlegada: z.string().min(1, "Required"),
  ruta: z.string().optional(),
  distanciaKm: z.coerce.number().min(1, "Required")
});

export default function PreDespacho() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [selectedSale, setSelectedSale] = useState<any>(null);

  // Fetch only pending sales
  const { data: sales, isLoading: isLoadingSales } = useListSales({
    query: { queryKey: getListSalesQueryKey({ status: 'pendiente' }) }
  });

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

  const onSubmit = (values: z.infer<typeof dispatchSchema>) => {
    if (!selectedSale) return;
    
    createDispatchMutation.mutate({
      data: {
        ...values,
        ventaId: selectedSale.id
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        setSelectedSale(null);
        toast({ title: "Dispatch created and approved successfully!" });
      }
    });
  };

  const handleSelectSale = (sale: any) => {
    setSelectedSale(sale);
    // Find best vehicle recommendation (simple logic for now)
    const bestVehicle = vehicles?.find(v => v.capacidadPeso >= sale.pesoTotal && v.capacidadVolumen >= sale.volumenTotal);
    
    // Set default dates (today and tomorrow)
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    form.reset({
      vehiculoId: bestVehicle ? bestVehicle.id : (vehicles && vehicles.length > 0 ? vehicles[0].id : 0),
      choferId: 0,
      fechaEstimadaSalida: today.toISOString().slice(0, 16),
      fechaEstimadaLlegada: tomorrow.toISOString().slice(0, 16),
      ruta: sale.destino,
      distanciaKm: 100 // placeholder
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Pre-Despacho</h1>
          <p className="text-muted-foreground">Authorize pending shipments and assign resources.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Sales Orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingSales ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : sales?.filter(s => s.estado === 'pendiente').length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No pending sales.</TableCell></TableRow>
              ) : sales?.filter(s => s.estado === 'pendiente').map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-medium">#{sale.id}</TableCell>
                  <TableCell>{sale.cliente}</TableCell>
                  <TableCell>{sale.destino}</TableCell>
                  <TableCell>{sale.pesoTotal} kg</TableCell>
                  <TableCell>{sale.volumenTotal} m³</TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => handleSelectSale(sale)}>Process</Button>
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
            <DialogTitle>Configure Dispatch for Order #{selectedSale?.id}</DialogTitle>
          </DialogHeader>
          
          {selectedSale && (
            <div className="bg-muted p-3 rounded-md mb-4 flex gap-4 text-sm">
              <div><span className="font-semibold">Client:</span> {selectedSale.cliente}</div>
              <div><span className="font-semibold">Dest:</span> {selectedSale.destino}</div>
              <div><span className="font-semibold">Weight:</span> {selectedSale.pesoTotal}kg</div>
              <div><span className="font-semibold">Volume:</span> {selectedSale.volumenTotal}m³</div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vehiculoId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle</FormLabel>
                      <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {vehicles?.map(v => (
                            <SelectItem key={v.id} value={v.id.toString()}>
                              {v.modelo} ({v.capacidadPeso}kg, {v.capacidadVolumen}m³) {v.tipo === 'tercero' ? '[Tercero]' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="distanciaKm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Distance (km)</FormLabel>
                      <FormControl><Input type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="choferId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Driver</FormLabel>
                      <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {personnel?.filter(p => p.rol === 'chofer').map(p => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ayudanteId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assistant (Optional)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString() || ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select assistant" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0">None</SelectItem>
                          {personnel?.filter(p => p.rol === 'ayudante').map(p => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="fechaEstimadaSalida"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ETD (Departure)</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fechaEstimadaLlegada"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ETA (Arrival)</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="bg-primary/10 border border-primary/20 p-4 rounded-md mt-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2"><Truck className="w-4 h-4"/> Dispatch Cost Estimate</h4>
                <p className="text-xs text-muted-foreground mb-4">Select vehicle and distance to see live estimates.</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-2 bg-background rounded border border-border">
                    <div className="text-xs text-muted-foreground">Fuel</div>
                    <div className="font-bold">Calculated on save</div>
                  </div>
                  <div className="text-center p-2 bg-background rounded border border-border">
                    <div className="text-xs text-muted-foreground">Per-Diem</div>
                    <div className="font-bold">Calculated on save</div>
                  </div>
                  <div className="text-center p-2 bg-background rounded border border-border">
                    <div className="text-xs text-muted-foreground">Tolls</div>
                    <div className="font-bold">Calculated on save</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button type="submit" size="lg" className="w-full">Aprobar Despacho</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
