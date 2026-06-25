import React, { useState } from "react";
import { 
  useListVehicles, getListVehiclesQueryKey,
  useCreateVehicle, useUpdateVehicle, useDeleteVehicle
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  tipo: z.string().min(1, "Required"),
  modelo: z.string().min(1, "Required"),
  capacidadPeso: z.coerce.number().min(0),
  capacidadVolumen: z.coerce.number().min(0),
  tipoCombustible: z.string().min(1, "Required"),
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
          toast({ title: "Vehicle updated successfully" });
        }
      });
    } else {
      createMutation.mutate({ data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Vehicle created successfully" });
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
    if (confirm("Are you sure you want to delete this vehicle?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          toast({ title: "Vehicle deleted" });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vehicles</h1>
          <p className="text-muted-foreground">Manage fleet vehicles and capacities.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingVehicle(null);
            form.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> Add Vehicle
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingVehicle ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="modelo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Model</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="placa"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Plate</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tipo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="propio">Own (Propio)</SelectItem>
                            <SelectItem value="tercero">Subcontracted (Tercero)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tipoCombustible"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fuel Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select fuel" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="gasolina">Gasoline</SelectItem>
                            <SelectItem value="diesel">Diesel</SelectItem>
                            <SelectItem value="gas">Gas</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="capacidadPeso"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight Cap. (kg)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="capacidadVolumen"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Volume Cap. (m³)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="rendimientoKmLitro"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Efficiency (km/L)</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit">{editingVehicle ? "Update" : "Create"}</Button>
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
                <TableHead>Model / Plate</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Fuel / Efficiency</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : vehicles?.map((vehicle) => (
                <TableRow key={vehicle.id}>
                  <TableCell>
                    <div className="font-medium">{vehicle.modelo}</div>
                    <div className="text-sm text-muted-foreground">{vehicle.placa || "N/A"}</div>
                  </TableCell>
                  <TableCell>
                    <span className="capitalize">{vehicle.tipo}</span>
                  </TableCell>
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
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(vehicle)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(vehicle.id)}>
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
