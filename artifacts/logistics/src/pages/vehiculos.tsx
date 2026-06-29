import React, { useState } from "react";
import {
  useListVehicles, getListVehiclesQueryKey,
  useCreateVehicle, useUpdateVehicle, useDeleteVehicle
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const vehicleSchema = z.object({
  tipo: z.string().min(1, "Requerido"),
  modelo: z.string().min(1, "Requerido"),
  capacidadPeso: z.coerce.number().min(0),
  capacidadVolumen: z.coerce.number().min(0),
  tipoCombustible: z.string().min(1, "Requerido"),
  rendimientoKmLitro: z.coerce.number().min(0),
  placa: z.string().optional(),
});

export default function Vehiculos() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<any>(null);

  const { data: vehicles, isLoading } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() }
  });

  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const deleteMutation = useDeleteVehicle();

  const form = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      tipo: "propio",
      modelo: "",
      capacidadPeso: 0,
      capacidadVolumen: 0,
      tipoCombustible: "diesel",
      rendimientoKmLitro: 0,
      placa: ""
    }
  });

  const onSubmit = (values: z.infer<typeof vehicleSchema>) => {
    if (editingVehicle) {
      updateMutation.mutate({ id: editingVehicle.id, data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Vehículo actualizado correctamente" });
        }
      });
    } else {
      createMutation.mutate({ data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Vehículo creado correctamente" });
        }
      });
    }
  };

  const handleEdit = (vehicle: any) => {
    setEditingVehicle(vehicle);
    form.reset({
      tipo: vehicle.tipo,
      modelo: vehicle.modelo,
      capacidadPeso: vehicle.capacidadPeso,
      capacidadVolumen: vehicle.capacidadVolumen,
      tipoCombustible: vehicle.tipoCombustible,
      rendimientoKmLitro: vehicle.rendimientoKmLitro,
      placa: vehicle.placa || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("¿Deseas eliminar este vehículo?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          toast({ title: "Vehículo eliminado" });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vehículos</h1>
          <p className="text-muted-foreground">Gestión de flota y capacidades.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { setEditingVehicle(null); form.reset(); }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-vehicle" className="gap-2">
              <Plus className="w-4 h-4" /> Agregar Vehículo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingVehicle ? "Editar Vehículo" : "Agregar Vehículo"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="modelo" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Modelo</FormLabel>
                      <FormControl><Input data-testid="input-modelo" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="placa" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Placa</FormLabel>
                      <FormControl><Input data-testid="input-placa" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="tipo" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tipo"><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="propio">Propio</SelectItem>
                          <SelectItem value="tercero">Tercero</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="tipoCombustible" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Combustible</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-combustible"><SelectValue placeholder="Seleccionar combustible" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="gasolina">Gasolina</SelectItem>
                          <SelectItem value="diesel">Diésel</SelectItem>
                          <SelectItem value="gas">Gas</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="capacidadPeso" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cap. Peso (kg)</FormLabel>
                      <FormControl><Input data-testid="input-peso" type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="capacidadVolumen" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cap. Volumen (m³)</FormLabel>
                      <FormControl><Input data-testid="input-volumen" type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="rendimientoKmLitro" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rendimiento (km/L)</FormLabel>
                      <FormControl><Input data-testid="input-rendimiento" type="number" step="0.1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="flex justify-end pt-4">
                  <Button data-testid="button-submit-vehicle" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingVehicle ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo / Placa</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Capacidad</TableHead>
                <TableHead>Combustible / Rendimiento</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : vehicles?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Sin vehículos registrados.</TableCell></TableRow>
              ) : vehicles?.map((vehicle) => (
                <TableRow key={vehicle.id} data-testid={`row-vehicle-${vehicle.id}`}>
                  <TableCell>
                    <div className="font-medium">{vehicle.modelo}</div>
                    <div className="text-sm text-muted-foreground">{vehicle.placa || "S/N"}</div>
                  </TableCell>
                  <TableCell><span className="capitalize">{vehicle.tipo}</span></TableCell>
                  <TableCell>
                    <div className="text-sm">{vehicle.capacidadPeso} kg</div>
                    <div className="text-sm text-muted-foreground">{vehicle.capacidadVolumen} m³</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm capitalize">{vehicle.tipoCombustible}</div>
                    <div className="text-sm text-muted-foreground">{vehicle.rendimientoKmLitro} km/L</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button data-testid={`button-edit-vehicle-${vehicle.id}`} variant="ghost" size="icon" onClick={() => handleEdit(vehicle)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button data-testid={`button-delete-vehicle-${vehicle.id}`} variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(vehicle.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
